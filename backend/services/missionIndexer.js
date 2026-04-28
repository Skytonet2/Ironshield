// backend/services/missionIndexer.js
//
// Phase 10 — Agent Economy: mission lifecycle indexer.
//
// Mirrors the contract's Mission state into the off-chain `missions`
// table. The on-chain row is authoritative — the indexer reconciles
// our mirror to it on every tick. If the indexer is offline for hours
// or days, on restart it walks the full mission corpus and brings the
// mirror back into sync with no replay-of-events needed.
//
// Strategy (no event-log scanning required):
//   1. Page through `list_missions(from_id, 100)` from id 0 until the
//      contract returns fewer than the page size. This is a small
//      amount of RPC work — 200 missions ≈ 2 calls per tick.
//   2. For each on-chain mission:
//        • If no off-chain row exists, insert via
//          missionEngine.recordCreatedFromChain (placeholder
//          inputs_json — frontend bootstrap can fill it later).
//        • If a row exists at a different status, call
//          missionEngine.mirrorEvent({ allowSkip: true }) so a single
//          tick can take open → approved when the indexer is catching
//          up after downtime.
//        • Otherwise no-op.
//
// All state lives in Postgres. No side-state file is required: every
// reconciliation decision is derivable from (on-chain row, DB row).
//
// Required env: STAKING_CONTRACT_ID (default ironshield.near),
// NEAR_RPC_URL (default https://rpc.mainnet.near.org). Tuning:
// MISSION_INDEXER_PAGE_SIZE (default 100, contract caps at 100).

const { connect, keyStores } = require("near-api-js");
const missionEngine = require("./missionEngine");

const STAKING_CONTRACT = process.env.STAKING_CONTRACT_ID || "ironshield.near";
const NODE_URL         = process.env.NEAR_RPC_URL        || "https://rpc.mainnet.near.org";
const NETWORK_ID       = process.env.NEAR_NETWORK_ID     || "mainnet";
const PAGE_SIZE        = Math.min(parseInt(process.env.MISSION_INDEXER_PAGE_SIZE || "100", 10), 100);

const TERMINAL = new Set(["approved", "rejected", "expired", "aborted"]);

let cachedAccount = null;
async function viewAccount() {
  if (cachedAccount) return cachedAccount;
  const near = await connect({
    networkId: NETWORK_ID,
    nodeUrl:   NODE_URL,
    keyStore:  new keyStores.InMemoryKeyStore(),
  });
  cachedAccount = await near.account("anonymous");
  return cachedAccount;
}

async function viewContract(methodName, args = {}) {
  const account = await viewAccount();
  return account.viewFunction({ contractId: STAKING_CONTRACT, methodName, args });
}

/** Block timestamp (u64 nanoseconds) → ISO string. Returns null for
 *  null/undefined/0. NEAR's serde may serialize u64 as either number
 *  or string; we accept both. */
function nsToIso(ns) {
  if (ns == null) return null;
  let big;
  try {
    big = BigInt(typeof ns === "string" ? ns : String(ns));
  } catch {
    return null;
  }
  if (big === 0n) return null;
  return new Date(Number(big / 1_000_000n)).toISOString();
}

/** Map an on-chain Mission record to the row shape recordCreatedFromChain
 *  expects. Pure — exported for testing. */
function toCreatedRecord(m) {
  const status = String(m.status || "open");
  // The contract reuses Mission.finalized_at as window-storage while
  // status is "open" (see mission_engine.rs:105). Only treat
  // finalized_at as a real timestamp once the mission has terminated.
  const finalized_at = TERMINAL.has(status) ? nsToIso(m.finalized_at) : null;
  return {
    on_chain_id:      Number(m.id),
    template_slug:    null, // m.template_id may not match a mission_templates.slug — leave null
    poster_wallet:    String(m.poster),
    kit_slug:         m.kit_slug || null,
    inputs_hash:      String(m.inputs_hash),
    escrow_yocto:     String(m.escrow_yocto),
    platform_fee_bps: Number(m.platform_fee_bps) || 500,
    status,
    claimant_wallet:  m.claimant || null,
    audit_root:       m.audit_root || null,
    created_at:       nsToIso(m.created_at),
    claimed_at:       nsToIso(m.claimed_at),
    submitted_at:     nsToIso(m.submitted_at),
    review_deadline:  nsToIso(m.review_deadline_ns),
    finalized_at,
  };
}

/** Map an on-chain Mission record to mirrorEvent's input shape. Same
 *  finalized_at quirk as above. Pure — exported for testing. */
function toMirrorEvent(m) {
  const status = String(m.status || "open");
  const finalized_at = TERMINAL.has(status) ? nsToIso(m.finalized_at) : null;
  return {
    on_chain_id:     Number(m.id),
    status,
    claimant_wallet: m.claimant || null,
    audit_root:      m.audit_root || null,
    claimed_at:      nsToIso(m.claimed_at),
    submitted_at:    nsToIso(m.submitted_at),
    review_deadline: nsToIso(m.review_deadline_ns),
    finalized_at,
  };
}

/** Decide what action — if any — the indexer should take for a given
 *  on-chain mission. Returns one of:
 *    { kind: "noop" }
 *    { kind: "create", record }
 *    { kind: "mirror", event }
 *  Pure — exported for testing. */
function planReconcile(onChain, dbRow) {
  if (!dbRow) {
    return { kind: "create", record: toCreatedRecord(onChain) };
  }
  if (String(onChain.status) !== String(dbRow.status)) {
    return { kind: "mirror", event: toMirrorEvent(onChain) };
  }
  return { kind: "noop" };
}

async function reconcile(onChain) {
  const id = Number(onChain.id);
  let dbRow;
  try {
    dbRow = await missionEngine.getMission(id);
  } catch (err) {
    console.error(`[mission-indexer] getMission(${id}) failed: ${err.message}`);
    return;
  }
  const plan = planReconcile(onChain, dbRow);
  try {
    if (plan.kind === "create") {
      await missionEngine.recordCreatedFromChain(plan.record);
      console.log(`[mission-indexer] created mirror row for mission #${id} (status=${plan.record.status})`);
    } else if (plan.kind === "mirror") {
      await missionEngine.mirrorEvent(plan.event, { allowSkip: true });
      console.log(`[mission-indexer] mirrored mission #${id} → ${plan.event.status}`);
    }
  } catch (err) {
    console.error(`[mission-indexer] reconcile #${id} failed: ${err.message}`);
  }
}

/** Walk the full on-chain mission corpus once and reconcile each row
 *  against the off-chain mirror. Idempotent — safe to call as often as
 *  the orchestrator polls. */
async function pollOnce() {
  let from = 0;
  let total = 0;
  while (true) {
    let batch;
    try {
      batch = await viewContract("list_missions", { from_id: from, limit: PAGE_SIZE });
    } catch (err) {
      console.warn(`[mission-indexer] list_missions(from=${from}) failed: ${err.message}`);
      return;
    }
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const m of batch) {
      await reconcile(m);
      total += 1;
    }
    if (batch.length < PAGE_SIZE) break;
    // list_missions uses inclusive from_id — page by `last_id + 1`.
    const lastId = Number(batch[batch.length - 1].id);
    if (!Number.isFinite(lastId)) break;
    from = lastId + 1;
  }
  if (total > 0) console.log(`[mission-indexer] tick complete — reconciled ${total} mission(s)`);
}

module.exports = {
  pollOnce,
  // Exported for unit testing / explicit invocation.
  toCreatedRecord,
  toMirrorEvent,
  planReconcile,
  nsToIso,
};
