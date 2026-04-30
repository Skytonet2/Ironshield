// backend/routes/payments.route.js
//
// PingPay payment surface — hosted-checkout on-ramp + agent balance read.
//
// Hosted-checkout endpoints (chip 1):
//
//   POST /api/payments/pingpay/checkout
//     Wallet-authed (NEP-413). Creates a pending_missions row + a
//     PingPay checkout session, returns { sessionId, sessionUrl } for
//     the frontend to redirect to.
//
//   POST /api/payments/pingpay/webhook
//     Public; HMAC-SHA256 over `{timestamp}.{raw_body}` in
//     `x-ping-signature` is the credential. On a verified
//     `checkout.session.completed` we flip the pending mission to
//     'funded' so the buyer's success page can let them sign
//     create_mission with the now-funded NEAR balance.
//
//   GET /api/payments/pingpay/session/:id
//     Wallet-authed. Used by /payments/success to confirm COMPLETED
//     before showing the "Sign mission" CTA. Falls back to a live
//     GET against PingPay if the webhook hasn't landed yet (the docs
//     warn the webhook can lag by tens of seconds).
//
// Agent balance endpoint (chip 2 thin slice):
//
//   GET /api/payments/agent/balance
//     Wallet-authed. On-chain NEAR + USDC balance for the agent
//     dashboard "Wallet" panel. The full cash-out flow (quote →
//     submit → webhook → status) lands in a follow-up PR.

"use strict";

const express = require("express");
const router  = express.Router();

const requireWallet     = require("../middleware/requireWallet");
const checkout          = require("../services/pingpay/checkout");
const settlement        = require("../services/pingpay/missionSettlement");
const { getAgentBalance } = require("../services/balanceLookup");

// Hard cap on the escrow a buyer can fund through hosted checkout.
// Tuned to match the NEAR Intents 1-click ceiling we already advertise
// elsewhere; raise as PingPay limits move. Above this, send the buyer
// to the NEAR-wallet path (or split the mission).
const MAX_ESCROW_USD = 5_000;

function buildRedirectUrls(req) {
  // The frontend is served from a different origin than the API. Take
  // the buyer's Origin header (already validated by CORS on this same
  // request) and use it for the success/cancel pages — never hardcode
  // a single host. PUBLIC_FRONTEND_URL is the fallback for non-browser
  // callers (curl, server-to-server).
  const origin = req.header("origin")
              || process.env.PUBLIC_FRONTEND_URL
              || "https://azuka.pages.dev";
  return {
    successUrl: `${origin.replace(/\/$/, "")}/payments/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl:  `${origin.replace(/\/$/, "")}/payments/cancel?session_id={CHECKOUT_SESSION_ID}`,
  };
}

// ── POST /api/payments/pingpay/checkout ──────────────────────────
router.post("/pingpay/checkout", requireWallet, async (req, res) => {
  try {
    const {
      mission_template_slug = null,
      kit_slug = null,
      inputs_json = {},
      escrow_amount_usd,
    } = req.body || {};

    const usd = Number(escrow_amount_usd);
    if (!Number.isFinite(usd) || usd <= 0) {
      return res.status(400).json({ error: "escrow_amount_usd must be a positive number" });
    }
    if (usd > MAX_ESCROW_USD) {
      return res.status(400).json({
        error: `escrow_amount_usd above ${MAX_ESCROW_USD} — fund via NEAR wallet path`,
      });
    }
    if (typeof inputs_json !== "object" || inputs_json === null || Array.isArray(inputs_json)) {
      return res.status(400).json({ error: "inputs_json must be an object" });
    }

    const { successUrl, cancelUrl } = buildRedirectUrls(req);

    let session;
    try {
      session = await checkout.createSession({
        amountUsd: usd,
        successUrl,
        cancelUrl,
        description: kit_slug ? `Mission funding: ${kit_slug}` : "Mission funding",
        // metadata is opaque to PingPay but echoed back in webhook
        // payloads; we use it only as a tracing aid. The authoritative
        // link from session → pending_mission is in the
        // pending_missions row keyed by pingpay_session_id.
        metadata: {
          poster_wallet: req.wallet,
          kit_slug:      kit_slug || "",
          template_slug: mission_template_slug || "",
        },
      });
    } catch (err) {
      // Don't leak the publishable key or upstream message verbatim.
      const code = err?.code || "PINGPAY_ERROR";
      const status = err?.status >= 400 && err?.status < 500 ? 502 : 500;
      console.error("[payments] PingPay createSession failed:", code, err.message);
      return res.status(status).json({ error: "PingPay checkout unavailable", code });
    }

    const pending = await settlement.createPending({
      poster_wallet:      req.wallet,
      template_slug:      mission_template_slug,
      kit_slug,
      inputs_json,
      escrow_amount_usd:  usd,
      pingpay_session_id: session.sessionId,
    });

    return res.json({
      ok: true,
      sessionId:           session.sessionId,
      sessionUrl:          session.sessionUrl,
      pending_mission_id:  pending.id,
      inputs_hash:         pending.inputs_hash,
    });
  } catch (err) {
    console.error("[payments] checkout failed:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /api/payments/pingpay/webhook ───────────────────────────
// PingPay POSTs here on every state change. Body must be the EXACT
// bytes signed by the upstream — express's verify hook stashes them on
// req.rawBody. We never log the raw body or signature.
router.post("/pingpay/webhook", async (req, res) => {
  const sigHeader = req.header("x-ping-signature");
  const raw       = req.rawBody;
  if (!raw || !raw.length) {
    return res.status(400).json({ error: "empty body" });
  }
  if (!checkout.verifyWebhookSignature(raw, sigHeader)) {
    // Treat verification failures uniformly — don't tell the caller
    // whether the secret is missing vs. signature wrong.
    return res.status(401).json({ error: "bad signature" });
  }

  let event;
  try { event = JSON.parse(raw.toString("utf8")); }
  catch { return res.status(400).json({ error: "invalid json" }); }

  try {
    const result = await settlement.applyWebhookEvent(event);
    // Always 200 a verified webhook so PingPay doesn't retry storm.
    // Internal "no-op" outcomes (duplicate, unknown session) are still
    // success from the upstream's perspective — they delivered the
    // signal, that's the contract.
    return res.json({ ok: true, applied: Boolean(result.applied) });
  } catch (err) {
    console.error("[payments] webhook apply failed:", err.message);
    // 5xx triggers PingPay retry per their backoff policy — that's
    // what we want for transient DB errors.
    return res.status(500).json({ error: "internal" });
  }
});

// ── GET /api/payments/pingpay/session/:id ────────────────────────
// The success page polls this. Same-buyer check is enforced so a
// session id alone can't be used to fish another buyer's status.
router.get("/pingpay/session/:id", requireWallet, async (req, res) => {
  const sessionId = String(req.params.id || "").trim();
  if (!sessionId) return res.status(400).json({ error: "session id required" });

  const pending = await settlement.findBySession(sessionId);
  if (!pending) return res.status(404).json({ error: "session not found" });
  if (String(pending.poster_wallet).toLowerCase() !== String(req.wallet).toLowerCase()) {
    return res.status(403).json({ error: "not your session" });
  }

  // If the webhook has already landed we trust the DB. Otherwise poll
  // PingPay's GET endpoint and apply the same transition. This keeps
  // the success page snappy when the webhook lags.
  let resolved = pending;
  if (pending.status === "pending_payment") {
    try {
      const live = await checkout.getSession(sessionId);
      const r = await settlement.resolveFromPolledSession(live);
      if (r?.pending) resolved = r.pending;
    } catch (err) {
      console.warn("[payments] live session lookup failed:", err.message);
      // Fall through with the DB row; client can retry.
    }
  }

  return res.json({
    ok: true,
    pending_mission_id: resolved.id,
    session_id:         resolved.pingpay_session_id,
    status:             resolved.status,
    pingpay_status:     resolved.pingpay_status,
    template_slug:      resolved.template_slug,
    kit_slug:           resolved.kit_slug,
    inputs_json:        resolved.inputs_json,
    inputs_hash:        resolved.inputs_hash,
    escrow_amount_usd:  Number(resolved.escrow_amount_usd),
    escrow_yocto:       resolved.escrow_yocto ? String(resolved.escrow_yocto) : null,
    resolved_on_chain_id: resolved.resolved_on_chain_id,
    funded_at:          resolved.funded_at,
    signed_at:          resolved.signed_at,
  });
});

// ── POST /api/payments/pingpay/session/:id/attach ────────────────
// Called by the success page after the buyer signs create_mission.
// Records resolved_on_chain_id so /missions/:id and pending_missions
// stay joined for support / refunds.
router.post("/pingpay/session/:id/attach", requireWallet, async (req, res) => {
  const sessionId = String(req.params.id || "").trim();
  const { on_chain_id } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: "session id required" });
  if (on_chain_id == null) return res.status(400).json({ error: "on_chain_id required" });

  const pending = await settlement.findBySession(sessionId);
  if (!pending) return res.status(404).json({ error: "session not found" });
  if (String(pending.poster_wallet).toLowerCase() !== String(req.wallet).toLowerCase()) {
    return res.status(403).json({ error: "not your session" });
  }

  const updated = await settlement.attachOnChainId(pending.id, Number(on_chain_id), {
    wallet: req.wallet,
  });
  if (!updated) {
    return res.status(409).json({ error: "pending mission not in fundable state" });
  }
  return res.json({ ok: true, pending_mission_id: updated.id, status: updated.status });
});

// ── GET /api/payments/agent/balance ──────────────────────────────
// Read-only on-chain balance for the agent dashboard "Wallet" panel.
// Cash-out (quote / submit / webhook / status) lands in a follow-up.
router.get("/agent/balance", requireWallet, async (req, res) => {
  try {
    const out = await getAgentBalance(req.wallet);
    res.json(out);
  } catch (err) {
    console.warn("[payments/balance]", err.message);
    res.status(503).json({ error: "balance lookup unavailable" });
  }
});

// ── Paystack PSP on-ramp routes ────────────────────────────────────
// Fiat-to-NEAR on-ramp routes for Nigerian buyers.
//
// This file is intentionally provider-shaped: each provider gets its own
// nested prefix (currently /psp for Paystack-style hosted-checkout PSPs;
// chip 1's PingPay flow will mount alongside as /pingpay). The provider-
// agnostic façade lives in services/psp/index.js.
//
// Endpoints under /api/payments/psp:
//
//   POST /checkout             — wallet-authed; creates a pending mission
//                                row, opens a Paystack transaction, returns
//                                the hosted-checkout URL.
//   POST /webhook              — Paystack server-to-server webhook. HMAC-
//                                SHA512 over raw body, signature in
//                                x-paystack-signature. On charge.success
//                                we re-verify with Paystack's API (defense
//                                in depth), settle the mission on-chain
//                                via floatManager, mark rows funded.
//   GET  /session/:reference   — used by the success page to confirm a
//                                tx is settled before showing "Mission live."
//   GET  /float                — operator status (admin only).
//
// What this route does NOT do (yet):
//   - Move naira out of our holding account (that lives in a manual ops
//     runbook until the founder picks an exchange).
//   - Issue refunds (Paystack supports it via /refund; we'd add a
//     /psp/refund handler when the contract has a matching mission-
//     cancel path).
//
// Logging discipline: never log full webhook bodies, full email/phone,
// or card details. Reference and amount only.

const crypto = require("node:crypto");

const db                = require("../db/client");
const requireAdmin      = require("../middleware/requireAdmin");
const missionEngine     = require("../services/missionEngine");
const floatManager      = require("../services/psp/floatManager");
const { getProvider }   = require("../services/psp");

// 5% platform fee matches DEFAULT_PLATFORM_FEE_BPS in
// contract/src/mission_engine.rs. Surfaced here so the route can show
// the buyer the same fee math the contract will apply.
const DEFAULT_PLATFORM_FEE_BPS = 500;

// Reference prefix lets the operator filter Paystack's dashboard for
// missions paid through us vs. anything else on the same merchant
// account. Underscore is the Paystack-allowed separator.
const REF_PREFIX = "ironshield_";

function maskEmail(email) {
  if (!email) return "";
  const [local, domain] = String(email).split("@");
  if (!domain) return "***";
  const head = local.slice(0, 2);
  return `${head}***@${domain}`;
}

function buildReference() {
  // 16 hex chars + ts so a re-attempted checkout with the same body
  // gets a fresh reference (Paystack's idempotency is on the reference
  // string itself — same ref returns the existing tx URL even after
  // it's been paid, which we don't want).
  const r = crypto.randomBytes(8).toString("hex");
  return `${REF_PREFIX}${Date.now()}_${r}`;
}

// ─── POST /api/payments/psp/checkout ────────────────────────────────
// Wallet-authed. Body:
//   {
//     mission_template_slug: string,
//     kit_slug?: string,
//     inputs_json: object,
//     escrow_amount_naira: number,   // whole naira
//     buyer_email: string            // Paystack receipt email
//   }
//
// On success returns { authorization_url, reference }. The frontend
// redirects the buyer to authorization_url; webhook does the rest.
router.post("/psp/checkout", requireWallet, async (req, res) => {
  try {
    const {
      mission_template_slug,
      kit_slug = null,
      inputs_json = {},
      escrow_amount_naira,
      buyer_email,
      review_window_secs = null,
    } = req.body || {};

    if (!mission_template_slug) {
      return res.status(400).json({ error: "mission_template_slug required" });
    }
    if (!buyer_email || !/^[^@]+@[^@]+\.[^@]+$/.test(String(buyer_email))) {
      return res.status(400).json({ error: "valid buyer_email required" });
    }
    const naira = Number(escrow_amount_naira);
    if (!Number.isFinite(naira) || naira <= 0) {
      return res.status(400).json({ error: "escrow_amount_naira must be positive" });
    }
    // Floor to whole naira; Paystack's amount param is kobo (integer).
    const amount_kobo = Math.floor(naira * 100);

    // Convert naira → yoctoNEAR via the configured rate. The rate is
    // operator-managed (set via PSP_NAIRA_PER_NEAR env or admin route);
    // the cron refresh of the live FX rate is a separate piece of work.
    // Until that lands, the operator sets the env and the route reads it.
    const naira_per_near = Number(process.env.PSP_NAIRA_PER_NEAR || "0");
    if (!Number.isFinite(naira_per_near) || naira_per_near <= 0) {
      return res.status(503).json({
        error: "naira-NEAR rate not configured (PSP_NAIRA_PER_NEAR)",
      });
    }
    const escrow_near = naira / naira_per_near;
    const escrow_yocto = floatManager.nearToYocto(escrow_near).toString();

    const inputs_hash = missionEngine.hashPayload(inputs_json || {});
    const reference   = buildReference();
    const buyer_wallet = req.wallet;

    // Insert the pending row first so a webhook arriving before this
    // returns can still find it. ON CONFLICT DO NOTHING is paranoia —
    // reference is a fresh nonce.
    await db.query(
      `INSERT INTO psp_pending_missions
         (pending_key, buyer_wallet, template_slug, kit_slug, inputs_json,
          inputs_hash, escrow_yocto, amount_kobo, status)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, 'pending_payment')
       ON CONFLICT (pending_key) DO NOTHING`,
      [
        reference,
        buyer_wallet,
        mission_template_slug,
        kit_slug,
        JSON.stringify(inputs_json || {}),
        inputs_hash,
        escrow_yocto,
        amount_kobo,
      ],
    );

    // Pre-create the paystack_transactions row in 'pending' state — the
    // webhook upserts it on charge.success. This way a webhook that
    // races initialize() still has a row to update.
    await db.query(
      `INSERT INTO paystack_transactions
         (reference, pending_key, buyer_wallet, amount_kobo, status, provider)
       VALUES ($1, $1, $2, $3, 'pending', 'paystack')
       ON CONFLICT (reference) DO NOTHING`,
      [reference, buyer_wallet, amount_kobo],
    );

    const provider = getProvider();
    const callback_url = (process.env.FRONTEND_URL || "")
      ? `${process.env.FRONTEND_URL}/agents/deploy/payment-success?ref=${encodeURIComponent(reference)}`
      : undefined;

    const init = await provider.initialize({
      amount_kobo,
      email: buyer_email,
      reference,
      callback_url,
      metadata: {
        buyer_wallet,
        mission_template_slug,
        kit_slug,
        // Paystack's metadata is shown in the dashboard — keep it
        // minimal and PII-light.
      },
    });

    void review_window_secs; // captured in pending row only at settle time (TODO if we expose)
    res.json({
      reference,
      authorization_url: init.authorization_url,
      expected_escrow_near: escrow_near,
      naira_per_near,
    });
  } catch (e) {
    console.error("[payments] /psp/checkout failed:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/payments/psp/webhook ────────────────────────────────
// Paystack sends one of: charge.success, charge.failed, transfer.*.
// We HMAC-verify, re-confirm via API, then settle.
router.post("/psp/webhook", async (req, res) => {
  try {
    const provider = getProvider();
    const sig = req.header("x-paystack-signature");
    const secret = process.env.PAYSTACK_WEBHOOK_SECRET;
    if (!secret) {
      console.error("[payments] webhook: PAYSTACK_WEBHOOK_SECRET not set");
      return res.status(503).json({ error: "webhook not configured" });
    }
    if (!provider.verifyWebhookSignature({ rawBody: req.rawBody, signature: sig, secret })) {
      console.warn("[payments] webhook: bad signature");
      return res.status(401).json({ error: "bad signature" });
    }

    const event = req.body || {};
    const eventName = event?.event;
    const data = event?.data || {};
    const reference = data?.reference;

    // Always 200 quickly so Paystack stops retrying — record-keeping
    // failures shouldn't trigger replay storms. Real failures are
    // surfaced through the /admin reconcile path.
    res.status(200).json({ received: true });

    if (!reference) {
      console.warn(`[payments] webhook: ${eventName} with no reference`);
      return;
    }

    if (eventName === "charge.failed") {
      await db.query(
        `UPDATE paystack_transactions
            SET status = 'failed', verified_at = NOW(),
                raw_event_json = $2::jsonb
          WHERE reference = $1`,
        [reference, JSON.stringify(redactEvent(event))],
      );
      await db.query(
        `UPDATE psp_pending_missions
            SET status = 'failed', failure_reason = $2
          WHERE pending_key = $1`,
        [reference, data?.gateway_response || "charge.failed"],
      );
      return;
    }

    if (eventName !== "charge.success") {
      // Unhandled event types are fine — Paystack also fires
      // transfer.success etc. for outbound flows we don't run.
      return;
    }

    // Defense-in-depth: re-verify with Paystack before crediting.
    let verified;
    try { verified = await provider.verify(reference); }
    catch (err) {
      console.error(`[payments] verify(${reference}) failed:`, err.message);
      await db.query(
        `UPDATE paystack_transactions
            SET status = 'pending', verified_at = NOW(),
                raw_event_json = $2::jsonb
          WHERE reference = $1`,
        [reference, JSON.stringify(redactEvent(event))],
      );
      return;
    }
    if (!verified || verified.status !== "success") {
      console.warn(`[payments] webhook claimed success but verify says ${verified?.status}`);
      return;
    }

    // Mark verified.
    await db.query(
      `UPDATE paystack_transactions
          SET status = 'paid', verified_at = NOW(),
              amount_kobo = COALESCE($2, amount_kobo),
              raw_event_json = $3::jsonb
        WHERE reference = $1`,
      [reference, verified.amount || null, JSON.stringify(redactEvent(event))],
    );

    // Find pending mission. If absent, quarantine the tx — paid w/o
    // matching mission is a reconciliation case, never a silent drop.
    const { rows } = await db.query(
      `SELECT pending_key, buyer_wallet, template_slug, kit_slug,
              inputs_json, inputs_hash, escrow_yocto, status, on_chain_id
         FROM psp_pending_missions
        WHERE pending_key = $1`,
      [reference],
    );
    const pending = rows[0];
    if (!pending) {
      console.error(`[payments] webhook: paid tx ${reference} has no pending mission row — quarantining`);
      await db.query(
        `UPDATE paystack_transactions
            SET status = 'quarantined'
          WHERE reference = $1`,
        [reference],
      );
      return;
    }
    if (pending.status === "funded" && pending.on_chain_id != null) {
      // Already settled — webhook re-delivery. Idempotent no-op.
      return;
    }

    // Settle on-chain via the float wallet.
    let funded;
    try {
      funded = await floatManager.fundMission({
        template_slug: pending.template_slug,
        kit_slug:      pending.kit_slug,
        inputs_json:   pending.inputs_json,
        escrow_yocto:  pending.escrow_yocto,
      });
    } catch (err) {
      console.error(`[payments] settlement for ${reference} failed:`, err.message);
      await db.query(
        `UPDATE psp_pending_missions
            SET status = 'settle_failed', failure_reason = $2
          WHERE pending_key = $1`,
        [reference, err.message?.slice(0, 500)],
      );
      return;
    }

    if (funded.on_chain_id == null) {
      // create_mission succeeded but we couldn't parse the id. Operator
      // has to reconcile manually using funded.tx_hash.
      console.error(`[payments] settled but no on_chain_id parsed (tx ${funded.tx_hash})`);
      await db.query(
        `UPDATE psp_pending_missions
            SET status = 'settle_unparsed', failure_reason = $2
          WHERE pending_key = $1`,
        [reference, `tx ${funded.tx_hash}`],
      );
      return;
    }

    // Mirror the on-chain mission off-chain. The orchestrator's indexer
    // also catches the mission_created event independently and ON
    // CONFLICT DO NOTHING means whichever gets there first wins.
    await missionEngine.recordCreated({
      on_chain_id:      funded.on_chain_id,
      template_slug:    pending.template_slug,
      poster_wallet:    pending.buyer_wallet,
      kit_slug:         pending.kit_slug,
      inputs_json:      pending.inputs_json,
      inputs_hash:      pending.inputs_hash,
      escrow_yocto:     pending.escrow_yocto,
      platform_fee_bps: DEFAULT_PLATFORM_FEE_BPS,
      tx_create:        funded.tx_hash,
    });

    // Link rows + log the float drawdown for reconciliation.
    await db.query(
      `UPDATE psp_pending_missions
          SET status = 'funded', on_chain_id = $2, funded_at = NOW()
        WHERE pending_key = $1`,
      [reference, funded.on_chain_id],
    );
    await db.query(
      `UPDATE paystack_transactions
          SET status = 'settled', settled_at = NOW(),
              mission_id = $2
        WHERE reference = $1`,
      [reference, funded.on_chain_id],
    );
    await db.query(
      `INSERT INTO psp_naira_float_log
         (kind, paystack_tx_id, mission_id, naira_kobo,
          near_amount_yocto, exchange, tx_hash, notes)
       VALUES (
         'spend',
         (SELECT id FROM paystack_transactions WHERE reference = $1),
         $2, $3, $4, NULL, $5,
         $6
       )`,
      [
        reference,
        funded.on_chain_id,
        verified.amount || null,
        // Negative because this is a draw FROM the float.
        "-" + String(funded.escrow_yocto),
        funded.tx_hash,
        `paystack→mission settle (buyer=${pending.buyer_wallet})`,
      ],
    );
  } catch (e) {
    // Webhook handler must never let the route's outer error handler
    // emit a 500 — Paystack will replay. We already 200'd above.
    console.error("[payments] webhook handler error:", e.message);
  }
});

// Strip PII from a Paystack event before persisting. We keep amount,
// reference, status, gateway_response, channel — the audit-relevant
// fields. Email + phone + last4 are masked.
function redactEvent(event) {
  if (!event || typeof event !== "object") return event;
  const data = { ...(event.data || {}) };
  const customer = data.customer ? { ...data.customer } : null;
  if (customer) {
    if (customer.email) customer.email = maskEmail(customer.email);
    if (customer.phone) customer.phone = "***";
    delete customer.metadata;
  }
  const auth = data.authorization ? { ...data.authorization } : null;
  if (auth) {
    delete auth.exp_month;
    delete auth.exp_year;
    delete auth.bin;
    delete auth.signature;
    delete auth.account_name;
  }
  return {
    event: event.event,
    data: {
      reference:        data.reference,
      amount:           data.amount,
      currency:         data.currency,
      status:           data.status,
      channel:          data.channel,
      gateway_response: data.gateway_response,
      paid_at:          data.paid_at,
      customer,
      authorization: auth,
    },
  };
}

// ─── GET /api/payments/psp/session/:reference ──────────────────────
// Buyer-side polling endpoint for the success page. Returns a slim
// summary; never leaks the raw webhook body. Public (no wallet auth)
// because the reference is itself a 96-bit unguessable token.
router.get("/psp/session/:reference", async (req, res) => {
  try {
    const { reference } = req.params;
    const { rows } = await db.query(
      `SELECT t.reference, t.status AS tx_status, t.amount_kobo,
              t.settled_at, t.verified_at,
              p.status AS pending_status, p.on_chain_id, p.template_slug,
              p.kit_slug, p.failure_reason
         FROM paystack_transactions t
    LEFT JOIN psp_pending_missions p ON p.pending_key = t.reference
        WHERE t.reference = $1`,
      [reference],
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ error: "not found" });
    res.json({
      reference:        row.reference,
      tx_status:        row.tx_status,
      pending_status:   row.pending_status,
      mission_id:       row.on_chain_id,
      amount_kobo:      Number(row.amount_kobo),
      template_slug:    row.template_slug,
      kit_slug:         row.kit_slug,
      verified_at:      row.verified_at,
      settled_at:       row.settled_at,
      failure_reason:   row.failure_reason,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/payments/psp/float ───────────────────────────────────
// Operator status — float wallet balance vs. configured thresholds,
// plus a recent reconciliation summary. Admin-only.
router.get("/psp/float", requireWallet, requireAdmin, async (req, res) => {
  try {
    const status = await floatManager.status();
    const { rows: recent } = await db.query(
      `SELECT kind, naira_kobo, near_amount_yocto, exchange, tx_hash,
              notes, created_at
         FROM psp_naira_float_log
        ORDER BY created_at DESC
        LIMIT 25`,
    );
    const { rows: counts } = await db.query(
      `SELECT status, COUNT(*)::int AS n
         FROM paystack_transactions
        GROUP BY status`,
    );
    res.json({ status, recent, counts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/payments/psp/reconcile ──────────────────────────────
// Admin-triggered: scan paid-but-not-settled rows and retry the
// settlement path. Useful when the float was empty earlier.
router.post("/psp/reconcile", requireWallet, requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT t.reference
         FROM paystack_transactions t
         JOIN psp_pending_missions p ON p.pending_key = t.reference
        WHERE t.status = 'paid'
          AND p.status IN ('pending_payment', 'settle_failed')
        LIMIT 50`,
    );
    res.json({ candidates: rows.map((r) => r.reference) });
    // Settlement re-attempts are NOT auto-run here — keep this endpoint
    // safe-by-default (returns the worklist). The operator triggers
    // reattempts via /psp/reconcile/:reference (TODO when first incident
    // hits — building the per-reference handler now would be speculative).
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
