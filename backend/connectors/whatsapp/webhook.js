// backend/connectors/whatsapp/webhook.js
//
// Express handlers for WhatsApp Cloud API webhooks.
//   GET  — verify challenge (Meta sends hub.verify_token + hub.challenge)
//   POST — inbound message / status callback
//
// Mounted by the /api/connectors/:name/connect route commit at
// /api/connectors/whatsapp/webhook. Until that mounts, this file just
// exports the handlers; the connector module itself works fine without
// the route.
//
// Verify-token rotation: the platform-shared verify token lives in
// WHATSAPP_WEBHOOK_VERIFY_TOKEN. App-secret signatures (optional but
// recommended) are read per-wallet from credentialStore.payload.app_secret.

const crypto = require("crypto");
const eventBus = require("../../services/eventBus");

const VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "";

/** GET handler — Meta-hosted webhook verification. */
function handleVerify(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge || "");
  }
  return res.status(403).json({ error: "verify_token mismatch" });
}

/** POST handler — inbound messages + statuses. */
async function handleEvent(req, res) {
  // Acknowledge immediately — Meta retries aggressively if we hold open.
  // Do the work after the response.
  res.status(200).end();
  try {
    const body = req.body || {};
    if (body.object !== "whatsapp_business_account") return;
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const v = change.value || {};
        const phone_number_id = v.metadata?.phone_number_id;
        for (const msg of v.messages || []) {
          eventBus.emit("connector:whatsapp:message", {
            phone_number_id,
            from: msg.from,
            id: msg.id,
            timestamp: msg.timestamp,
            type: msg.type,
            text: msg.text?.body,
          });
        }
        for (const status of v.statuses || []) {
          eventBus.emit("connector:whatsapp:status", {
            phone_number_id,
            id: status.id,
            recipient: status.recipient_id,
            status: status.status,
            timestamp: status.timestamp,
          });
        }
      }
    }
  } catch (e) {
    // Swallow — we already 200'd. Log for forensics.
    console.warn("[whatsapp:webhook] handler error:", e.message);
  }
}

/**
 * Verify X-Hub-Signature-256 against the platform app secret. Use this
 * as middleware in front of handleEvent if WHATSAPP_APP_SECRET is set.
 * Returns 401 on mismatch. Designed to read raw body — caller must
 * ensure express.json() preserves req.rawBody (e.g. via verify hook).
 */
function verifySignature(req, res, next) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return next(); // signature verification opt-in
  const sig = req.get("x-hub-signature-256") || "";
  const raw = req.rawBody || (typeof req.body === "string" ? req.body : JSON.stringify(req.body || {}));
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  // Constant-time compare guards against timing oracles even on a low-stakes endpoint.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "signature mismatch" });
  }
  next();
}

module.exports = { handleVerify, handleEvent, verifySignature };
