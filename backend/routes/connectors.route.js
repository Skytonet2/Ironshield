// backend/routes/connectors.route.js
//
// Phase 10 Tier 4 — connector credential management + provider webhooks.
//
// Endpoints:
//   GET    /api/connectors                       — public registry list (no auth)
//   GET    /api/connectors/me                    — my connections (status only)
//   POST   /api/connectors/:name/connect         — store creds for a connector
//   DELETE /api/connectors/:name                 — disconnect
//   GET    /api/connectors/whatsapp/webhook      — Meta verify handshake
//   POST   /api/connectors/whatsapp/webhook      — Meta inbound events
//
// OAuth-redirect flows (for X / Facebook) ship as a follow-up. The
// /connect endpoint accepts a directly-supplied payload today — the
// frontend handles the OAuth redirect dance and posts the resulting
// tokens here.

const express = require("express");
const router = express.Router();

const requireWallet = require("../middleware/requireWallet");
const connectors = require("../connectors");
const credentialStore = require("../connectors/credentialStore");
const whatsappWebhook = require("../connectors/whatsapp/webhook");

// Public registry — no auth. Frontend uses this to render the "available
// connectors" tab and decide which connect dialog to show.
router.get("/", (req, res) => {
  res.json({ connectors: connectors.list() });
});

// My connections — wallet-authed, returns connector_name + expires_at
// + timestamps. Never the encrypted blob.
router.get("/me", requireWallet, async (req, res) => {
  try {
    const rows = await credentialStore.listForWallet(req.wallet);
    res.json({ connections: rows });
  } catch (e) {
    console.warn("[connectors:/me] error:", e.message);
    res.status(500).json({ error: "list failed" });
  }
});

// WhatsApp webhook — mounted explicitly because it's the only connector
// that needs an inbound HTTP surface. Verify-token + signature check
// live in the connector module itself.
router.get("/whatsapp/webhook", whatsappWebhook.handleVerify);
router.post("/whatsapp/webhook",
  whatsappWebhook.verifySignature,
  whatsappWebhook.handleEvent
);

// Connect — store creds for a connector. Payload shape is connector-
// specific; we don't enforce schema here. The connector's invoke()
// throws a clear "config missing in credentials" error if the user
// supplied a wrong shape, which the UX surfaces back to them.
router.post("/:name/connect", requireWallet, async (req, res) => {
  const { name } = req.params;
  const mod = connectors.get(name);
  if (!mod) return res.status(404).json({ error: `unknown connector: ${name}` });
  const { payload, expires_at } = req.body || {};
  if (!payload || typeof payload !== "object" || Object.keys(payload).length === 0) {
    return res.status(400).json({ error: "payload (object with at least one field) required" });
  }
  try {
    const row = await credentialStore.upsert({
      wallet: req.wallet,
      connector: name,
      payload,
      expiresAt: expires_at || null,
    });
    res.json({ ok: true, connection: row });
  } catch (e) {
    console.warn(`[connectors:/${name}/connect] error:`, e.message);
    res.status(500).json({ error: "connect failed" });
  }
});

// Disconnect — drop creds for a connector. Idempotent; 200 even if no
// row was present.
router.delete("/:name", requireWallet, async (req, res) => {
  const { name } = req.params;
  if (!connectors.get(name)) return res.status(404).json({ error: `unknown connector: ${name}` });
  try {
    const removed = await credentialStore.remove({ wallet: req.wallet, connector: name });
    res.json({ ok: true, removed });
  } catch (e) {
    console.warn(`[connectors:DELETE /${name}] error:`, e.message);
    res.status(500).json({ error: "disconnect failed" });
  }
});

module.exports = router;
