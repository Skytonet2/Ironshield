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

const TICK_MS = Number(process.env.AUTOMATION_TICK_MS || 30_000);
const BATCH   = Number(process.env.AUTOMATION_BATCH    || 25);

let timer = null;

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
  console.log(`[automation worker] started (tick=${TICK_MS}ms, batch=${BATCH})`);
}

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, tick };
