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
const agentConnector     = require("../agentConnector");
const db                 = require("../../db/client");

const TICK_MS = Number(process.env.AUTOMATION_TICK_MS || 30_000);
const BATCH   = Number(process.env.AUTOMATION_BATCH    || 25);
// v1.1.8 — AI tick interval. Separate from the schedule tick because
// AI evaluations are heavier (one LLM call per item per rule); 60s
// keeps cost bounded for automations that target the firehose.
const AI_TICK_MS = Number(process.env.AUTOMATION_AI_TICK_MS || 60_000);
// Per-tick max items to evaluate per rule. Rules behind on the
// cursor catch up across ticks rather than burning the wallet's
// daily AI budget in one shot.
const AI_BATCH_PER_RULE = Number(process.env.AUTOMATION_AI_BATCH || 10);

let timer = null;
let aiTimer = null;
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

/** v1.1.8 — Day 12.3 AI tick.
 *  Walks each enabled trigger.type='ai' rule, fetches feed_posts
 *  newer than the rule's ai_last_id, classifies each item via the
 *  LLM, fires the action on match, and advances the cursor. One
 *  LLM call per (rule, item). Rules behind the cursor catch up
 *  across ticks (AI_BATCH_PER_RULE caps per-tick work).
 *
 *  Spec defaults to source: "recent_posts" (the global feed). Other
 *  sources are left for v1.2 — adding xfeed means writing a parallel
 *  SELECT and reusing the cursor.
 */
async function aiTick() {
  let rules;
  try { rules = await automationStore.findAiTriggers(); }
  catch (err) {
    console.warn("[automation ai] findAiTriggers failed:", err.message);
    return;
  }
  if (!rules.length) return;

  for (const rule of rules) {
    const source = String(rule.trigger?.source || "recent_posts");
    if (source !== "recent_posts") {
      // Don't churn forever on an unknown source; advance the cursor
      // past the head once so the rule doesn't re-evaluate every tick.
      try {
        const head = await db.query("SELECT MAX(id) AS m FROM feed_posts");
        const m = Number(head.rows[0]?.m || 0);
        if (m > rule.ai_last_id) await automationStore.advanceAiCursor(rule.id, m);
      } catch { /* swallow — next tick retries */ }
      continue;
    }

    let items;
    try {
      // First-time activation: ai_last_id=0 would otherwise drag the
      // entire archive through the LLM. Clamp to "items in the last
      // hour" so a fresh enable processes a reasonable lookback rather
      // than the firehose since launch.
      const baseSeed = rule.ai_last_id > 0
        ? rule.ai_last_id
        : Math.max(0, await firstPostIdSinceHourAgo());
      const r = await db.query(
        `SELECT id, content, author_id, created_at
           FROM feed_posts
          WHERE id > $1
          ORDER BY id ASC
          LIMIT $2`,
        [baseSeed, AI_BATCH_PER_RULE]
      );
      items = r.rows;
    } catch (err) {
      console.warn(`[automation ai] rule ${rule.id} fetch items failed:`, err.message);
      continue;
    }
    if (!items.length) continue;

    const predicate = String(rule.trigger?.prompt || "").trim();
    if (!predicate) {
      // Mis-shaped rule — advance past the head so we don't loop on it.
      const head = items[items.length - 1].id;
      await automationStore.advanceAiCursor(rule.id, head).catch(() => {});
      continue;
    }

    let advancedTo = rule.ai_last_id;
    let budgetExhausted = false;
    for (const item of items) {
      if (budgetExhausted) break;
      let verdict;
      try {
        // eslint-disable-next-line no-await-in-loop
        verdict = await agentConnector.classify(predicate, item, rule.owner);
      } catch (err) {
        if (err.code === "ai-budget-exceeded") {
          budgetExhausted = true;
          console.log(`[automation ai] rule ${rule.id} skipped — budget exhausted for ${rule.owner}`);
          break;
        }
        console.warn(`[automation ai] rule ${rule.id} classify failed on item ${item.id}:`, err.message);
        // Advance past this item so we don't re-evaluate forever.
        advancedTo = item.id;
        continue;
      }
      advancedTo = item.id;
      if (verdict.match) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await automationExecutor.run({
            automation: rule, source: "ai",
            payload: { item, reason: verdict.reason },
          });
        } catch (err) {
          console.warn(`[automation ai] rule ${rule.id} action failed on item ${item.id}:`, err.message);
        }
      }
    }
    if (advancedTo > rule.ai_last_id) {
      await automationStore.advanceAiCursor(rule.id, advancedTo).catch(() => {});
    }
  }
}

/** Smallest feed_posts.id created in the last hour, or 0 when empty.
 *  Used to clamp first-time AI rule activation to a sane lookback. */
async function firstPostIdSinceHourAgo() {
  try {
    const r = await db.query(
      "SELECT MIN(id) AS m FROM feed_posts WHERE created_at > NOW() - INTERVAL '1 hour'"
    );
    return Number(r.rows[0]?.m || 0);
  } catch { return 0; }
}

function start() {
  if (timer) return;
  // Defer the first tick so server boot doesn't race the DB pool.
  setTimeout(() => { tick().catch(() => {}); }, 5_000);
  timer = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
  // Day 12.2 event router. Subscribes to the bus's wildcard so every
  // internal emit gets a chance to fire matching event-trigger rules.
  busOff = eventBus.on("*", routeEvent);
  // v1.1.8 — AI tick. Offset from boot + from the schedule tick so
  // we don't punch the DB pool with three sources at once.
  setTimeout(() => { aiTick().catch(() => {}); }, 8_000);
  aiTimer = setInterval(() => { aiTick().catch(() => {}); }, AI_TICK_MS);
  console.log(`[automation worker] started (tick=${TICK_MS}ms, batch=${BATCH}, ai-tick=${AI_TICK_MS}ms, event-router=on)`);
}

function stop() {
  if (timer) clearInterval(timer);
  if (aiTimer) clearInterval(aiTimer);
  timer = null; aiTimer = null;
  if (busOff) { busOff(); busOff = null; }
}

module.exports = { start, stop, tick, aiTick };
