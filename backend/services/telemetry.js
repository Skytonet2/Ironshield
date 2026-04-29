// backend/services/telemetry.js
//
// Tiny aggregate counter store. Lets us answer "is anyone using
// this?" without grep'ing logs. Backed by the event_counters table
// (see schema.sql). Labels are connector names / kit slugs etc. —
// NEVER user wallets. This is operator-facing summary telemetry, not
// per-user analytics.
//
// Failures must NEVER bubble — telemetry breakage shouldn't take down
// a request path. All public functions swallow and log via the
// structured logger.

const db = require("../db/client");
const logger = require("./logger");

/** Atomic increment of a counter. Awaitable but designed to be
 *  fire-and-forget — see bumpFireAndForget for that pattern. */
async function bump(event, label = "", n = 1) {
  if (typeof event !== "string" || !event) return;
  const safeLabel = String(label || "").slice(0, 120);
  try {
    await db.query(
      `INSERT INTO event_counters (event_name, label, count, first_seen, last_seen)
         VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (event_name, label) DO UPDATE
         SET count = event_counters.count + EXCLUDED.count,
             last_seen = NOW()`,
      [event, safeLabel, Math.max(1, Number(n) || 1)],
    );
  } catch (e) {
    logger.warn({ err: e.message, event, label: safeLabel }, "telemetry.bump failed");
  }
}

/** Fire-and-forget wrapper — never returns a rejected promise. Use
 *  this on the request path so telemetry can't slow or break the
 *  caller. */
function bumpFireAndForget(event, label = "", n = 1) {
  bump(event, label, n).catch(() => {});
}

/** List counters, newest activity first. Admin-only via the calling
 *  route's middleware. */
async function list({ limit = 200 } = {}) {
  const n = Number(limit);
  // Number.isFinite gates NaN + Infinity. Use ?? so 0 stays 0 (then
  // clamps to 1), while undefined/NaN fall through to the default.
  const lim = Math.min(1000, Math.max(1, Number.isFinite(n) ? n : 200));
  const { rows } = await db.query(
    `SELECT event_name, label, count, first_seen, last_seen
       FROM event_counters
       ORDER BY last_seen DESC
       LIMIT $1`,
    [lim],
  );
  return rows;
}

module.exports = { bump, bumpFireAndForget, list };
