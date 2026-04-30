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

module.exports = router;
