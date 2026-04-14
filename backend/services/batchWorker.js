// backend/services/batchWorker.js
// Drains feed_batch_queue every 60s. In production this submits a single
// FunctionCall transaction per user via their delegate access key. For now
// it groups by user and stamps a synthetic tx_hash so the off-chain UX is
// gasless and identical.
const db = require("../db/client");
const crypto = require("crypto");

const INTERVAL_MS = 60_000;
let timer = null;

async function drain() {
  try {
    const r = await db.query(
      `SELECT id, user_id, action_type, payload, created_at
         FROM feed_batch_queue
        WHERE processed_at IS NULL
        ORDER BY created_at ASC
        LIMIT 1000`);
    if (!r.rows.length) return;

    const byUser = new Map();
    for (const row of r.rows) {
      if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
      byUser.get(row.user_id).push(row);
    }

    for (const [userId, items] of byUser.entries()) {
      // ---- on-chain submission goes here ----
      // const txHash = await submitBatchedActions(userId, items.map(i => i.payload));
      // For now, synthesize a tx hash so DB rows close cleanly.
      const txHash = "off:" + crypto.createHash("sha256")
        .update(`${userId}:${items.map(i => i.id).join(",")}:${Date.now()}`)
        .digest("hex").slice(0, 32);

      const ids = items.map(i => i.id);
      await db.query(
        "UPDATE feed_batch_queue SET processed_at = NOW(), tx_hash = $1 WHERE id = ANY($2)",
        [txHash, ids]);
      console.log(`[batch] user=${userId} actions=${items.length} tx=${txHash}`);
    }
  } catch (err) {
    console.error("[batch] drain error:", err.message);
  }
}

function start() {
  if (timer) return;
  timer = setInterval(drain, INTERVAL_MS);
  console.log(`[batch] worker started (every ${INTERVAL_MS / 1000}s)`);
}
function stop() { if (timer) clearInterval(timer); timer = null; }

async function enqueue(userId, actionType, payload) {
  await db.query(
    "INSERT INTO feed_batch_queue (user_id, action_type, payload) VALUES ($1, $2, $3)",
    [userId, actionType, payload]);
}

module.exports = { start, stop, drain, enqueue };
