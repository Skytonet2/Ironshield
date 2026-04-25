// backend/services/agents/automationStore.js
//
// Persistence for automation rules. Cron parsing happens here so the
// route handlers don't need to import `cron-parser` directly. We
// pre-compute `next_run_at` whenever a rule is created or updated so
// the worker's `due()` query stays a cheap index range scan.

const db = require("../../db/client");

let cronParser = null;
function parser() {
  if (cronParser) return cronParser;
  try { cronParser = require("cron-parser"); }
  catch { cronParser = false; } // dependency optional — schedule rules degrade gracefully
  return cronParser;
}

/** Compute the next firing time for a schedule trigger. Returns null
 *  for non-schedule triggers OR when cron-parser isn't installed.
 */
function nextRunAt(rule) {
  if (rule?.trigger?.type !== "schedule") return null;
  const cp = parser();
  if (!cp) return null;
  try {
    const it = cp.parseExpression(rule.trigger.cron, { tz: "UTC" });
    return it.next().toDate();
  } catch {
    return null;
  }
}

function publicRow(row) {
  if (!row) return null;
  return {
    ...row,
    trigger: typeof row.trigger === "string" ? JSON.parse(row.trigger) : row.trigger,
    action:  typeof row.action  === "string" ? JSON.parse(row.action)  : row.action,
  };
}

async function create({ owner, agent_account, name, description, trigger, action, enabled }) {
  if (!owner || !agent_account || !name || !trigger || !action) {
    throw new Error("owner, agent_account, name, trigger, action required");
  }
  const next = nextRunAt({ trigger });
  const { rows } = await db.query(
    `INSERT INTO agent_automations
       (owner, agent_account, name, description, trigger, action, enabled, next_run_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [owner, agent_account, name, description || "",
     JSON.stringify(trigger), JSON.stringify(action),
     enabled !== false, next]
  );
  return publicRow(rows[0]);
}

async function update(id, owner, patch) {
  // Owner gate — the route handler enforces this too but the DB layer
  // double-checks so a bug in the API can't accidentally cross-update.
  const cols = [];
  const params = [id, owner];
  let i = 2;
  const set = (col, val) => { cols.push(`${col} = $${++i}`); params.push(val); };

  if (patch.name        !== undefined) set("name", patch.name);
  if (patch.description !== undefined) set("description", patch.description);
  if (patch.enabled     !== undefined) set("enabled", patch.enabled);
  if (patch.trigger     !== undefined) {
    set("trigger", JSON.stringify(patch.trigger));
    set("next_run_at", nextRunAt({ trigger: patch.trigger }));
  }
  if (patch.action      !== undefined) set("action",  JSON.stringify(patch.action));

  cols.push(`updated_at = NOW()`);
  if (cols.length === 1) return findOne(id, owner); // no-op patch

  const sql = `UPDATE agent_automations SET ${cols.join(", ")}
                 WHERE id = $1 AND owner = $2 RETURNING *`;
  const { rows } = await db.query(sql, params);
  return publicRow(rows[0] || null);
}

async function findOne(id, owner) {
  const { rows } = await db.query(
    `SELECT * FROM agent_automations WHERE id = $1 AND owner = $2 LIMIT 1`,
    [id, owner]
  );
  return publicRow(rows[0] || null);
}

async function findById(id) {
  const { rows } = await db.query(
    `SELECT * FROM agent_automations WHERE id = $1 LIMIT 1`,
    [id]
  );
  return publicRow(rows[0] || null);
}

async function listForAccount(agent_account) {
  const { rows } = await db.query(
    `SELECT * FROM agent_automations
        WHERE agent_account = $1
        ORDER BY created_at DESC`,
    [agent_account]
  );
  return rows.map(publicRow);
}

async function remove(id, owner) {
  const { rowCount } = await db.query(
    `DELETE FROM agent_automations WHERE id = $1 AND owner = $2`,
    [id, owner]
  );
  return rowCount > 0;
}

/** Schedule rules whose next_run_at is in the past. Worker batches. */
async function due(limit = 25) {
  const { rows } = await db.query(
    `SELECT * FROM agent_automations
        WHERE enabled = TRUE
          AND next_run_at IS NOT NULL
          AND next_run_at <= NOW()
        ORDER BY next_run_at ASC
        LIMIT $1`,
    [limit]
  );
  return rows.map(publicRow);
}

async function recordRun({ automation_id, source, status, output, error }) {
  await db.query(
    `INSERT INTO agent_automation_runs
       (automation_id, source, status, output, error) VALUES ($1, $2, $3, $4, $5)`,
    [automation_id, source, status, (output || "").slice(0, 8_000), (error || "").slice(0, 2_000)]
  );
  // Mirror the latest result onto the parent row so the UI doesn't have
  // to JOIN the runs table for the dashboard.
  await db.query(
    `UPDATE agent_automations
        SET last_run_at = NOW(),
            last_run_status = $2,
            last_run_output = $3,
            run_count = run_count + 1
      WHERE id = $1`,
    [automation_id, status, (output || error || "").slice(0, 1_000)]
  );
}

async function listRuns(automation_id, limit = 25) {
  const { rows } = await db.query(
    `SELECT * FROM agent_automation_runs
        WHERE automation_id = $1
        ORDER BY fired_at DESC
        LIMIT $2`,
    [automation_id, limit]
  );
  return rows;
}

async function rotateSchedule(automation) {
  const next = nextRunAt(automation);
  await db.query(
    `UPDATE agent_automations SET next_run_at = $2, updated_at = NOW() WHERE id = $1`,
    [automation.id, next]
  );
  return next;
}

module.exports = {
  create, update, findOne, findById, listForAccount, remove,
  due, recordRun, listRuns, rotateSchedule, nextRunAt,
};
