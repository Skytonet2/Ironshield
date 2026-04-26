// backend/services/agents/automationWorker.js
//
// In-process scheduler for schedule-type automation rules. Single
// setInterval polling DB every TICK_MS, picks up due rules, executes
// each through the shared executor, and rotates next_run_at.
//
// One tick processes a small batch (default 25) so a backlog drains
// gracefully across ticks without blocking. Errors per rule are
// captured by the executor and never bubble — the worker can't
// crash on a misconfigured user rule.

const automationStore   = require("./automationStore");
const automationExecutor = require("./automationExecutor");
const eventBus           = require("../eventBus");

const TICK_MS = Number(process.env.AUTOMATION_TICK_MS || 30_000);
const BATCH   = Number(process.env.AUTOMATION_BATCH    || 25);

let timer = null;
let busOff = null;

/** Shallow-equality match on filter object. Each key in filter must
 *  appear with the same value in payload. Used by the event router so
 *  e.g. `{ token: "NEAR" }` filters in only NEAR price alerts.
 *  Missing/empty filter matches everything. Deeply nested matchers
 *  and operator DSLs are intentionally out of scope for v1 — the
 *  filter is meant to be a small allowlist, not a query language. */
function matchFilter(filter, payload) {
  if (!filter || typeof filter !== "object") return true;
  for (const k of Object.keys(filter)) {
    if (payload?.[k] !== filter[k]) return false;
  }
  return true;
}

/** Day 12.2: route every emitted event through the DB to find
 *  matching enabled automations and fire each. Single subscriber
 *  pattern — one DB query per event, fine for the low-volume internal
 *  channels (proposal.executed, dm.received, price.alert). Per-rule
 *  errors stay isolated, same as schedule path. */
async function routeEvent({ channel, payload }) {
  let rules;
  try { rules = await automationStore.findByEventChannel(channel); }
  catch (err) {
    console.warn(`[automation event] findByEventChannel(${channel}) failed:`, err.message);
    return;
  }
  for (const rule of rules) {
    if (!matchFilter(rule.trigger?.filter, payload)) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      await automationExecutor.run({ automation: rule, source: "event", payload });
    } catch (err) {
      console.warn(`[automation event] rule ${rule.id} on ${channel} crashed: ${err.message}`);
    }
  }
}

async function tick() {
  let due;
  try { due = await automationStore.due(BATCH); }
  catch (err) {
    console.warn("[automation worker] due() failed:", err.message);
    return;
  }
  if (!due.length) return;
  for (const rule of due) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await automationExecutor.run({ automation: rule, source: "schedule" });
    } catch (err) {
      console.warn(`[automation worker] rule ${rule.id} crashed: ${err.message}`);
    }
  }
}

function start() {
  if (timer) return;
  // Defer the first tick so server boot doesn't race the DB pool.
  setTimeout(() => { tick().catch(() => {}); }, 5_000);
  timer = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
  // Day 12.2 event router. Subscribes to the bus's wildcard so every
  // internal emit gets a chance to fire matching event-trigger rules.
  busOff = eventBus.on("*", routeEvent);
  console.log(`[automation worker] started (tick=${TICK_MS}ms, batch=${BATCH}, event-router=on)`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  if (busOff) { busOff(); busOff = null; }
}

module.exports = { start, stop, tick };
