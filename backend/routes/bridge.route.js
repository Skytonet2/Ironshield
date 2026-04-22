// backend/routes/bridge.route.js
//
// Thin proxy for the NEAR Intents 1-click API used by the Bridge
// modal (spec §7). We proxy so:
//   1. Our 0.2% platform fee (appFees) is stamped server-side —
//      clients can't remove it by crafting a direct call to 1click.
//   2. Rate-limit / API-key churn stays server-side if we ever need
//      a paid upstream.
//   3. CORS is simpler than hoping 1click's default allows our origin.
//
// We don't cache quotes — they're time-sensitive and the client polls
// on amount changes. The /tokens response is cached for 60s in-process.
//
// Phase 5-3 adds /submit (signed intent → 1click /deposit) once the
// NEP-413 signMessage wiring in wallet-selector is tested across the
// wallets IronShield ships with.

const express = require("express");
const router = express.Router();

const BASE = "https://1click.chaindefuser.com/v0";
const FEE_BPS = 20; // 0.20% — keep in sync with src/lib/trading/fees.js

// Platform-fee recipient for bridge volume. Read lazily so env changes
// don't require a restart (handy on Render). Defaults to the same
// `fees.ironshield.near` collector the trading path uses.
const feeRecipient = () =>
  process.env.PLATFORM_WALLET_NEAR ||
  process.env.BRIDGE_FEE_RECIPIENT ||
  "fees.ironshield.near";

let tokensCache = { ts: 0, data: null };
const TOKENS_TTL = 60_000;

// GET /api/bridge/tokens — cached mirror of 1click's asset list.
router.get("/tokens", async (req, res) => {
  try {
    if (tokensCache.data && Date.now() - tokensCache.ts < TOKENS_TTL) {
      return res.json(tokensCache.data);
    }
    const r = await fetch(`${BASE}/tokens`);
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const j = await r.json();
    tokensCache = { ts: Date.now(), data: j };
    res.json(j);
  } catch (e) {
    res.status(502).json({ error: e.message || "tokens upstream failed" });
  }
});

// POST /api/bridge/quote
// body: {
//   originAsset, destinationAsset, amount, slippageBps?,
//   refundTo, recipient
// }
// We fill in the tedious NEAR Intents required fields (swapType,
// deposit/refund type, deadline) and stamp appFees with our 0.2%.
router.post("/quote", async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.originAsset || !b.destinationAsset || !b.amount || !b.recipient) {
      return res.status(400).json({
        error: "originAsset, destinationAsset, amount, recipient required",
      });
    }
    const payload = {
      dry: b.dry !== false,  // default to dry-run quotes; client flips to false on confirm
      depositMode: "SIMPLE",
      swapType: "EXACT_INPUT",
      slippageTolerance: Number(b.slippageBps) || 100, // 1% default
      originAsset:      b.originAsset,
      destinationAsset: b.destinationAsset,
      amount: String(b.amount),
      depositType: "ORIGIN_CHAIN",
      refundTo:   b.refundTo || b.recipient,
      refundType: "ORIGIN_CHAIN",
      recipient:  b.recipient,
      recipientType: "DESTINATION_CHAIN",
      // 10-minute deadline; covers any reasonable user hesitation.
      deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
      // Stamp our 0.2% platform fee. 1click accepts a NEAR account id
      // OR a 32-byte hex pubkey — the account id path is easier and
      // matches the trading-fee destination.
      appFees: [{ recipient: feeRecipient(), fee: FEE_BPS }],
    };

    const r = await fetch(`${BASE}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({ error: "non-json upstream response" }));
    if (!r.ok) {
      // 1click's 4xx responses are a flat `message` with all field
      // errors concatenated. Pass through so the frontend can surface
      // it without re-parsing.
      return res.status(r.status).json({
        error: j.message || j.error || `upstream ${r.status}`,
        upstream: j,
      });
    }
    res.json(j);
  } catch (e) {
    res.status(502).json({ error: e.message || "quote failed" });
  }
});

// POST /api/bridge/submit
// body: same shape as /quote, but forces dry=false — returns the
// commit-able quote with depositAddress the user sends their origin
// tokens to. Thin wrapper over /quote so callers can make intent
// explicit ("I am about to execute") and we can in the future log
// commit attempts without cluttering the dry-quote path.
router.post("/submit", async (req, res) => {
  // Delegate to the /quote handler with dry forced off. Express doesn't
  // expose a public forward primitive, so inline the path — it's short.
  try {
    const b = req.body || {};
    if (!b.originAsset || !b.destinationAsset || !b.amount || !b.recipient) {
      return res.status(400).json({ error: "originAsset, destinationAsset, amount, recipient required" });
    }
    const payload = {
      dry: false,
      depositMode: "SIMPLE",
      swapType: "EXACT_INPUT",
      slippageTolerance: Number(b.slippageBps) || 100,
      originAsset:      b.originAsset,
      destinationAsset: b.destinationAsset,
      amount: String(b.amount),
      depositType: "ORIGIN_CHAIN",
      refundTo:   b.refundTo || b.recipient,
      refundType: "ORIGIN_CHAIN",
      recipient:  b.recipient,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
      appFees: [{ recipient: feeRecipient(), fee: FEE_BPS }],
    };
    const r = await fetch(`${BASE}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({ error: "non-json upstream" }));
    if (!r.ok) return res.status(r.status).json({ error: j.message || `upstream ${r.status}`, upstream: j });
    res.json(j);
  } catch (e) {
    res.status(502).json({ error: e.message || "submit failed" });
  }
});

// GET /api/bridge/status?depositAddress=X
// Proxies 1click's deposit status. Client polls this every 5s until
// status is COMPLETE or REFUNDED.
router.get("/status", async (req, res) => {
  try {
    const addr = String(req.query.depositAddress || "").trim();
    if (!addr) return res.status(400).json({ error: "depositAddress required" });
    const r = await fetch(`${BASE}/status?depositAddress=${encodeURIComponent(addr)}`);
    const j = await r.json().catch(() => ({ error: "non-json upstream" }));
    if (!r.ok) return res.status(r.status).json({ error: j.message || `upstream ${r.status}` });
    res.json(j);
  } catch (e) {
    res.status(502).json({ error: e.message || "status failed" });
  }
});

module.exports = router;
