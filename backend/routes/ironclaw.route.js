// backend/routes/ironclaw.route.js
//
// HTTP surface for the IronClaw ↔ IronShield bridge. Three endpoints:
//
//   POST /api/ironclaw/bridge/inbound
//     Webhook from a linked ironclaw.com agent (or any external relay
//     holding our shared secret). Body is signed with HMAC-SHA256 over
//     the raw JSON, signature in X-Ironclaw-Signature. On success we
//     translate supported events into feed rows and return { ok: true }.
//     Dedupe is by body.id when present.
//
//   GET  /api/ironclaw/bridge/health
//     Non-sensitive snapshot of bridge config + delivery counters.
//     Useful for operator checks without needing DB access.
//
//   GET  /api/ironclaw/bridge/source/:owner
//     Read-only passthrough to the contract's get_ironclaw_source view,
//     cached 60s in-process. Exists so frontends can answer "is this
//     wallet linked?" without each of them holding a NEAR connection.

const express = require("express");
const router  = express.Router();
const bridge  = require("../services/ironclawBridge");

// ── Inbound webhook ──────────────────────────────────────────────
router.post("/bridge/inbound", async (req, res) => {
  const sig = req.header("x-ironclaw-signature");
  const raw = req.rawBody;
  if (!raw || !raw.length) {
    return res.status(400).json({ error: "empty body" });
  }
  if (raw.length > bridge.MAX_BODY) {
    return res.status(413).json({ error: "body too large" });
  }
  if (!bridge.verifySignature(raw.toString("utf8"), sig)) {
    return res.status(401).json({ error: "bad signature" });
  }

  const body = req.body || {};
  const { id, event, owner, payload } = body;
  if (!event || !owner) {
    return res.status(400).json({ error: "event + owner required" });
  }

  try {
    const result = await bridge.ingestInbound({ id, event, owner, payload: payload || {} });
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error("[ironclaw.route] inbound failed:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── Health ───────────────────────────────────────────────────────
router.get("/bridge/health", (_req, res) => {
  res.json(bridge.healthSnapshot());
});

// ── Source lookup ────────────────────────────────────────────────
router.get("/bridge/source/:owner", async (req, res) => {
  const owner = String(req.params.owner || "").trim();
  if (!owner) return res.status(400).json({ error: "owner required" });
  try {
    const source = await bridge.resolveSource(owner);
    res.json({ owner, source: source || null, linked: Boolean(source) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
