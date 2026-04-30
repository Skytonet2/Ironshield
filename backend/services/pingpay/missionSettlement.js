// backend/services/pingpay/missionSettlement.js
//
// State machine for PingPay-funded missions. Owns the DB transitions
// for pending_missions + pingpay_payments. Pure-DB module — no HTTP,
// no NEAR signing — so the route handlers and the test suite share
// the exact same code path.
//
// Lifecycle (settlement shape "a"):
//
//   1. createPending()                — buyer hits POST /checkout
//                                       → row in pending_missions
//                                         (status='pending_payment'),
//                                         seed row in pingpay_payments
//                                         (status='PENDING').
//
//   2. applyWebhookEvent(evt)         — webhook lands; if event is
//                                       checkout.session.completed:
//                                       update pingpay_payments to
//                                       COMPLETED + flip pending_missions
//                                       to 'funded'. Other event types
//                                       are recorded for audit but don't
//                                       transition state.
//
//   3. resolveSession(sessionId)      — fallback for the success page:
//                                       polls PingPay GET /sessions/:id
//                                       and applies the same transition
//                                       if the webhook is delayed.
//
//   4. attachOnChainId(pendingId,…)   — frontend calls after the buyer
//                                       has signed create_mission. Writes
//                                       resolved_on_chain_id and flips
//                                       status='signed'. Doesn't touch
//                                       the missions table — that path
//                                       is owned by missionEngine.recordCreated.
//
// Idempotency: every transition uses CHECK-and-UPDATE so re-running
// any step is a no-op. PingPay retries webhooks aggressively; the
// route handler and this module both lean on UNIQUE(session_id) +
// "WHERE status = previous_status" updates.

"use strict";

const crypto = require("crypto");
const db     = require("../../db/client");

// Stable JSON serializer (insertion-order independent) so the same
// inputs hash the same on chain and off. Mirrors missionEngine's helper
// — kept local to avoid a circular import.
function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
}
function hashInputs(inputs) {
  return crypto.createHash("sha256").update(stableStringify(inputs || {})).digest("hex");
}

/** Create the pending-mission row + seed pingpay_payments. Returns the
 *  pending mission row. */
async function createPending({
  poster_wallet,
  template_slug = null,
  kit_slug = null,
  inputs_json = {},
  escrow_amount_usd,
  pingpay_session_id,
}) {
  if (!poster_wallet) throw new Error("poster_wallet required");
  if (!Number.isFinite(Number(escrow_amount_usd)) || Number(escrow_amount_usd) <= 0) {
    throw new Error("escrow_amount_usd must be positive");
  }
  if (!pingpay_session_id) throw new Error("pingpay_session_id required");

  const inputs_hash = hashInputs(inputs_json);

  const { rows } = await db.query(
    `INSERT INTO pending_missions
       (poster_wallet, template_slug, kit_slug, inputs_json, inputs_hash,
        escrow_amount_usd, pingpay_session_id, pingpay_status, status)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, 'PENDING', 'pending_payment')
     RETURNING *`,
    [
      String(poster_wallet).toLowerCase(),
      template_slug,
      kit_slug,
      JSON.stringify(inputs_json || {}),
      inputs_hash,
      Number(escrow_amount_usd),
      pingpay_session_id,
    ],
  );
  const pending = rows[0];

  // Seed the audit row. UNIQUE(session_id) means an accidental retry of
  // createPending won't double-write here.
  await db.query(
    `INSERT INTO pingpay_payments
       (session_id, pending_mission_id, amount_usd, status)
     VALUES ($1, $2, $3, 'PENDING')
     ON CONFLICT (session_id) DO NOTHING`,
    [pingpay_session_id, pending.id, Number(escrow_amount_usd)],
  );

  return pending;
}

/** Look up by session id. Used by the success page + webhook path. */
async function findBySession(sessionId) {
  if (!sessionId) return null;
  const { rows } = await db.query(
    `SELECT * FROM pending_missions WHERE pingpay_session_id = $1 LIMIT 1`,
    [String(sessionId)],
  );
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await db.query(`SELECT * FROM pending_missions WHERE id = $1`, [Number(id)]);
  return rows[0] || null;
}

/** Apply a verified webhook event. Returns
 *  { applied: bool, pending: row|null, reason?: string } so callers can
 *  log without re-reading state. */
async function applyWebhookEvent(event) {
  if (!event || typeof event !== "object") {
    return { applied: false, pending: null, reason: "no event payload" };
  }
  const sessionId =
    event?.data?.object?.id ||
    event?.data?.sessionId ||
    event?.sessionId ||
    null;
  if (!sessionId) {
    return { applied: false, pending: null, reason: "event missing sessionId" };
  }

  const sessionStatus =
    event?.data?.object?.status ||
    event?.data?.status ||
    null;
  const amountYocto =
    event?.data?.object?.routing?.amount_yocto ||
    event?.data?.amount_yocto ||
    null;

  // Always record the inbound event for audit, regardless of whether it
  // moves state. Last write wins on raw_event_json — we only need the
  // freshest snapshot per session.
  await db.query(
    `UPDATE pingpay_payments
        SET raw_event_json = $2::jsonb,
            status         = COALESCE($3, status),
            amount_yocto   = COALESCE($4, amount_yocto),
            completed_at   = CASE WHEN $3 = 'COMPLETED' THEN NOW() ELSE completed_at END
      WHERE session_id = $1`,
    [sessionId, JSON.stringify(event), sessionStatus, amountYocto],
  );

  if (event.type !== "checkout.session.completed" && sessionStatus !== "COMPLETED") {
    const pending = await findBySession(sessionId);
    return { applied: false, pending, reason: `event type ${event.type || "?"} not actionable` };
  }

  // Flip pending → funded. Guard with WHERE status='pending_payment' so
  // a duplicate webhook is a no-op.
  const upd = await db.query(
    `UPDATE pending_missions
        SET status        = 'funded',
            pingpay_status = 'COMPLETED',
            escrow_yocto  = COALESCE($2, escrow_yocto),
            funded_at     = NOW(),
            updated_at    = NOW()
      WHERE pingpay_session_id = $1
        AND status = 'pending_payment'
      RETURNING *`,
    [sessionId, amountYocto],
  );
  if (upd.rowCount > 0) {
    return { applied: true, pending: upd.rows[0] };
  }
  // Already funded (or never existed). Return current state for log.
  const current = await findBySession(sessionId);
  return { applied: false, pending: current, reason: "already funded or unknown session" };
}

/** Webhook-fallback path. Caller passes the freshly-fetched session
 *  object from PingPay's GET endpoint; we synthesize a minimal event
 *  shape and reuse applyWebhookEvent so the lifecycle stays single-path. */
async function resolveFromPolledSession(session) {
  if (!session || !session.id) {
    return { applied: false, pending: null, reason: "empty session" };
  }
  const synthetic = {
    type: session.status === "COMPLETED" ? "checkout.session.completed" : "checkout.session.updated",
    data: { object: session },
  };
  return applyWebhookEvent(synthetic);
}

/** Buyer signed create_mission off-page; flip to 'signed' and store
 *  the on-chain id so we can join through to the missions row later.
 *  No-op if already signed (idempotent). */
async function attachOnChainId(pendingMissionId, onChainId, { wallet } = {}) {
  if (pendingMissionId == null) throw new Error("pendingMissionId required");
  if (onChainId == null) throw new Error("onChainId required");
  const params = [Number(onChainId), Number(pendingMissionId)];
  let walletGuard = "";
  if (wallet) {
    params.push(String(wallet).toLowerCase());
    walletGuard = ` AND poster_wallet = $${params.length}`;
  }
  const { rows } = await db.query(
    `UPDATE pending_missions
        SET status               = 'signed',
            resolved_on_chain_id = $1,
            signed_at            = NOW(),
            updated_at           = NOW()
      WHERE id = $2
        AND status IN ('funded', 'pending_payment')
        ${walletGuard}
      RETURNING *`,
    params,
  );
  return rows[0] || null;
}

module.exports = {
  createPending,
  findBySession,
  findById,
  applyWebhookEvent,
  resolveFromPolledSession,
  attachOnChainId,
  hashInputs,
};
