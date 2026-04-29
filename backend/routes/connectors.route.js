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
const xOauth        = require("../connectors/x/oauth");
const facebookOauth = require("../connectors/facebook/oauth");
const emailGoogleOauth    = require("../connectors/email/oauth-google");
const emailMicrosoftOauth = require("../connectors/email/oauth-microsoft");

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

// Telegram inbound HTTP fallback — for split deployments where the bot
// runs in a process separate from the backend and can't push events on
// the in-process eventBus. Co-located deploys never hit this path; the
// bot's bot/attach.js prefers in-process emit. Gated by the same shared
// secret as POST /api/missions/:id/mirror.
router.post("/tg/inbound", async (req, res) => {
  const expected = process.env.ORCHESTRATOR_SHARED_SECRET;
  const provided = req.headers["x-orchestrator-secret"];
  if (!expected || provided !== expected) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const b = req.body || {};
  if (!b.text || typeof b.text !== "string") {
    return res.status(400).json({ error: "missing text" });
  }
  try {
    require("../services/eventBus").emit("connector:tg:message", b);
    res.json({ ok: true });
  } catch (e) {
    console.warn("[connectors:/tg/inbound] emit failed:", e.message);
    res.status(500).json({ error: "emit failed" });
  }
});

// OAuth flows — start needs the wallet (to bind the cookie); callback
// is a top-level GET from the provider, so it auths via the signed
// cookie set during start. Each connector implements its own pair.
router.post("/x/oauth/start",        requireWallet, xOauth.start);
router.get( "/x/oauth/callback",                    xOauth.callback);
router.post("/facebook/oauth/start", requireWallet, facebookOauth.start);
router.get( "/facebook/oauth/callback",             facebookOauth.callback);

// Email is multi-provider: each provider gets its own start+callback
// pair that ultimately persists into the same `email` connector row
// (with provider:'google' | 'microsoft'). The connector itself
// dispatches XOAUTH2 vs password auth based on payload.provider.
router.post("/email/oauth/google/start",       requireWallet, emailGoogleOauth.start);
router.get( "/email/oauth/google/callback",                   emailGoogleOauth.callback);
router.post("/email/oauth/microsoft/start",    requireWallet, emailMicrosoftOauth.start);
router.get( "/email/oauth/microsoft/callback",                emailMicrosoftOauth.callback);

// Connect — store creds for a connector. Payload shape is connector-
// specific; we don't enforce schema here. The connector's invoke()
// throws a clear "config missing in credentials" error if the user
// supplied a wrong shape, which the UX surfaces back to them.
//
// Size cap: payload is capped at 64KB serialised. Real credentials
// (OAuth tokens, page-token bundles, mailbox creds, session cookies)
// fit well under 10KB; 64KB leaves room for unusual cases without
// letting a wallet-authed client store arbitrary blobs. This is in
// addition to the global express.json({ limit: '256kb' }) ceiling.
const CONNECT_PAYLOAD_MAX_BYTES = 64 * 1024;

router.post("/:name/connect", requireWallet, async (req, res) => {
  const { name } = req.params;
  const mod = connectors.get(name);
  if (!mod) return res.status(404).json({ error: `unknown connector: ${name}` });
  const { payload, expires_at } = req.body || {};
  if (!payload || typeof payload !== "object" || Object.keys(payload).length === 0) {
    return res.status(400).json({ error: "payload (object with at least one field) required" });
  }
  // Cheap byte-length check on the serialised payload. Buffer.byteLength
  // matches what credentialStore.encrypt will end up writing.
  const size = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (size > CONNECT_PAYLOAD_MAX_BYTES) {
    return res.status(413).json({
      error: `payload too large (${size} bytes, max ${CONNECT_PAYLOAD_MAX_BYTES})`,
    });
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
