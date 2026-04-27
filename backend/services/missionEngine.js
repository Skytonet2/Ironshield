// backend/services/missionEngine.js
//
// Off-chain mission engine. The contract holds the source-of-truth
// lifecycle + escrow (mission_engine.rs); this module owns the verbose
// payload — inputs JSON, audit log, escalation linkage, mirrored state
// — that the contract intentionally doesn't carry.
//
// Two modes of update flow into Postgres:
//
//   1. Indexer-driven (preferred). The orchestrator polls the contract
//      for mission_created / claimed / submitted / approved / rejected /
//      expired / aborted events and calls `mirrorEvent(...)` to update
//      the off-chain row. This makes the on-chain state authoritative.
//
//   2. Direct-write (frontend bootstrap). When a poster submits the
//      create_mission tx, the frontend optionally calls `recordCreated`
//      with the inputs payload and tx hash so the off-chain side is
//      populated even before the indexer catches up. Idempotent on
//      on_chain_id.
//
// Audit log entries are hash-chained: each row's payload_hash =
// sha256(stable_json(payload)) and prev_hash = the previous row's
// payload_hash for the same mission. The chain root (last
// payload_hash) is what the claimant submits on-chain via
// submit_mission_work — making the off-chain log tamper-evident.

const crypto = require("node:crypto");
const db = require("../db/client");

const STATUS_OPEN      = "open";
const STATUS_CLAIMED   = "claimed";
const STATUS_SUBMITTED = "submitted";
const STATUS_APPROVED  = "approved";
const STATUS_REJECTED  = "rejected";
const STATUS_EXPIRED   = "expired";
const STATUS_ABORTED   = "aborted";

const TERMINAL_STATUSES = new Set([STATUS_APPROVED, STATUS_REJECTED, STATUS_EXPIRED, STATUS_ABORTED]);

const ALLOWED_TRANSITIONS = {
  [STATUS_OPEN]:      new Set([STATUS_CLAIMED, STATUS_ABORTED]),
  [STATUS_CLAIMED]:   new Set([STATUS_SUBMITTED]),
  [STATUS_SUBMITTED]: new Set([STATUS_APPROVED, STATUS_REJECTED, STATUS_EXPIRED]),
};

/** Pure helper: is `next` reachable from `current` per the state
 *  machine in mission_engine.rs? Exported for testing. */
function canTransition(current, next) {
  if (TERMINAL_STATUSES.has(current)) return false;
  const allowed = ALLOWED_TRANSITIONS[current];
  return Boolean(allowed && allowed.has(next));
}

function stableStringify(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") +
    "}"
  );
}

/** sha256 over a deterministic string of the payload. Used both for
 *  the audit-log chain and to derive inputs_hash on the create path. */
function hashPayload(payload) {
  return crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
}

/** Frontend bootstrap: record the off-chain side of a freshly-created
 *  mission. on_chain_id must be the value returned by create_mission;
 *  inputs_json must hash to the inputs_hash that was passed to the
 *  contract — the indexer will refuse to mirror events for a mission
 *  whose hashes don't match.
 *  Idempotent: re-calling with the same on_chain_id is a no-op. */
async function recordCreated({
  on_chain_id,
  template_slug,
  poster_wallet,
  kit_slug = null,
  inputs_json,
  inputs_hash,
  escrow_yocto,
  platform_fee_bps,
  tx_create = null,
  created_at = null,
}) {
  if (on_chain_id == null) throw new Error("on_chain_id required");
  if (!poster_wallet) throw new Error("poster_wallet required");
  if (!inputs_hash) throw new Error("inputs_hash required");
  // Sanity-check that the caller didn't lie: hashing the payload they
  // sent must match the hash they say they posted on-chain.
  const computed = hashPayload(inputs_json || {});
  if (computed !== inputs_hash) {
    throw new Error("inputs_hash mismatch — did the payload change after signing?");
  }

  const sql = `
    INSERT INTO missions
      (on_chain_id, template_slug, poster_wallet, kit_slug, inputs_json,
       inputs_hash, escrow_yocto, platform_fee_bps, status, tx_create,
       created_at, indexed_at)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, 'open', $9,
            COALESCE($10, NOW()), NOW())
    ON CONFLICT (on_chain_id) DO NOTHING
    RETURNING on_chain_id, status, created_at`;
  const { rows } = await db.query(sql, [
    on_chain_id,
    template_slug || null,
    poster_wallet,
    kit_slug,
    JSON.stringify(inputs_json || {}),
    inputs_hash,
    String(escrow_yocto),
    platform_fee_bps ?? 500,
    tx_create,
    created_at,
  ]);
  return rows[0] || (await getMission(on_chain_id));
}

/** Orchestrator path: apply an indexed mission_<status> event to the
 *  off-chain row. Validates state transitions so a misordered event
 *  feed can't corrupt the mirror. */
async function mirrorEvent(event) {
  if (!event || event.on_chain_id == null) throw new Error("on_chain_id required");
  const current = await getMission(event.on_chain_id);
  if (!current) {
    throw new Error(
      `mirrorEvent: unknown mission ${event.on_chain_id} — indexer must catch the create event first`,
    );
  }
  if (event.status && !canTransition(current.status, event.status)) {
    throw new Error(
      `Illegal transition ${current.status} → ${event.status} for mission ${event.on_chain_id}`,
    );
  }

  const set = [];
  const params = [event.on_chain_id];
  function bind(field, value) {
    if (value === undefined) return;
    params.push(value);
    set.push(`${field} = $${params.length}`);
  }

  bind("status",          event.status);
  bind("claimant_wallet", event.claimant_wallet);
  bind("audit_root",      event.audit_root);
  bind("tx_finalize",     event.tx_finalize);
  bind("claimed_at",      event.claimed_at);
  bind("submitted_at",    event.submitted_at);
  bind("review_deadline", event.review_deadline);
  bind("finalized_at",    event.finalized_at);

  if (set.length === 0) return current;

  const sql = `
    UPDATE missions
       SET ${set.join(", ")}, indexed_at = NOW()
     WHERE on_chain_id = $1
     RETURNING on_chain_id, status, claimant_wallet, audit_root,
               claimed_at, submitted_at, review_deadline, finalized_at`;
  const { rows } = await db.query(sql, params);
  return rows[0];
}

async function getMission(on_chain_id) {
  const { rows } = await db.query(
    `SELECT on_chain_id, template_slug, poster_wallet, claimant_wallet,
            kit_slug, inputs_json, inputs_hash, escrow_yocto,
            platform_fee_bps, status, audit_root, tx_create, tx_finalize,
            created_at, claimed_at, submitted_at, review_deadline,
            finalized_at, indexed_at
       FROM missions WHERE on_chain_id = $1`,
    [on_chain_id],
  );
  return rows[0] || null;
}

async function listMissions({ status = null, poster_wallet = null, claimant_wallet = null, kit_slug = null, limit = 50 } = {}) {
  const clauses = [];
  const params = [];
  function add(col, val) {
    params.push(val);
    clauses.push(`${col} = $${params.length}`);
  }
  if (status)          add("status", status);
  if (poster_wallet)   add("poster_wallet", poster_wallet);
  if (claimant_wallet) add("claimant_wallet", claimant_wallet);
  if (kit_slug)        add("kit_slug", kit_slug);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(Math.min(limit, 200));
  const { rows } = await db.query(
    `SELECT on_chain_id, template_slug, poster_wallet, claimant_wallet,
            kit_slug, status, escrow_yocto, platform_fee_bps,
            created_at, claimed_at, submitted_at, finalized_at
       FROM missions
       ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

/** Append a step to the mission audit log. Computes payload_hash and
 *  fetches the previous step's hash to maintain the chain. step_seq
 *  is monotonic per-mission; we compute it here so callers don't race. */
async function appendAuditStep({
  mission_on_chain_id,
  skill_id = null,
  role = null,
  action_type,
  payload = {},
  agent_wallet = null,
}) {
  if (!mission_on_chain_id) throw new Error("mission_on_chain_id required");
  if (!action_type) throw new Error("action_type required");

  const payload_hash = hashPayload(payload);

  // Wrap the SELECT-MAX + INSERT in one transaction with FOR UPDATE so
  // two concurrent appendAuditStep calls on the same mission can't
  // race to the same step_seq.
  return db.transaction(async (client) => {
    const { rows: prevRows } = await client.query(
      `SELECT step_seq, payload_hash
         FROM mission_audit_log
        WHERE mission_on_chain_id = $1
        ORDER BY step_seq DESC
        LIMIT 1
        FOR UPDATE`,
      [mission_on_chain_id],
    );
    const prev = prevRows[0];
    const next_step_seq = prev ? prev.step_seq + 1 : 1;
    const prev_hash = prev ? prev.payload_hash : null;

    const { rows } = await client.query(
      `INSERT INTO mission_audit_log
         (mission_on_chain_id, step_seq, skill_id, role, action_type,
          payload_json, payload_hash, prev_hash, agent_wallet, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, NOW())
       RETURNING id, step_seq, payload_hash, prev_hash, created_at`,
      [
        mission_on_chain_id,
        next_step_seq,
        skill_id,
        role,
        action_type,
        JSON.stringify(payload),
        payload_hash,
        prev_hash,
        agent_wallet,
      ],
    );
    return rows[0];
  });
}

async function getAuditLog(mission_on_chain_id) {
  const { rows } = await db.query(
    `SELECT id, step_seq, skill_id, role, action_type, payload_json,
            payload_hash, prev_hash, agent_wallet, created_at
       FROM mission_audit_log
      WHERE mission_on_chain_id = $1
      ORDER BY step_seq ASC`,
    [mission_on_chain_id],
  );
  return rows;
}

/** Latest payload_hash in the chain — what the claimant should submit
 *  on-chain via submit_mission_work(audit_root). */
async function getAuditRoot(mission_on_chain_id) {
  const { rows } = await db.query(
    `SELECT payload_hash
       FROM mission_audit_log
      WHERE mission_on_chain_id = $1
      ORDER BY step_seq DESC
      LIMIT 1`,
    [mission_on_chain_id],
  );
  return rows[0]?.payload_hash || null;
}

module.exports = {
  STATUS_OPEN,
  STATUS_CLAIMED,
  STATUS_SUBMITTED,
  STATUS_APPROVED,
  STATUS_REJECTED,
  STATUS_EXPIRED,
  STATUS_ABORTED,
  canTransition,
  hashPayload,
  stableStringify,
  recordCreated,
  mirrorEvent,
  getMission,
  listMissions,
  appendAuditStep,
  getAuditLog,
  getAuditRoot,
};
