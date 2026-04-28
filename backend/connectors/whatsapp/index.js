// backend/connectors/whatsapp/index.js
//
// WhatsApp Business Cloud API connector. Hosted by Meta:
//   https://developers.facebook.com/docs/whatsapp/cloud-api
//
// Auth model: permanent system-user access token + phone_number_id +
// business_account_id, stored encrypted per-wallet:
//   { access_token, phone_number_id, business_account_id, app_secret? }
// `app_secret` is optional; if present we verify the inbound webhook
// signature with X-Hub-Signature-256.
//
// Actions:
//   send          — outbound text message. Inside the 24h customer
//                   service window only (free-form message).
//   send_template — pre-approved template send. Required for first
//                   contact / outside 24h window.
//   mark_read     — ack an inbound message id.
//
// Webhook receiver lives in ./webhook.js and is mounted by the
// /api/connectors/:name/connect route commit.

const credentialStore = require("../credentialStore");

const API = "https://graph.facebook.com/v19.0";

async function _creds(wallet) {
  if (!wallet || wallet === "platform") {
    throw new Error("whatsapp: per-wallet creds required");
  }
  const row = await credentialStore.getDecrypted({ wallet, connector: "whatsapp" }).catch(() => null);
  if (!row?.payload?.access_token || !row?.payload?.phone_number_id) {
    throw new Error("whatsapp: connect WhatsApp Business first");
  }
  return row.payload;
}

async function _post(url, body, token) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    const err = new Error(`whatsapp ${url}: ${res.status} ${json?.error?.message || text.slice(0, 200)}`);
    err.status = res.status;
    err.body = json || text;
    throw err;
  }
  return json;
}

async function send({ wallet, to, text }) {
  if (!to || !text) throw new Error("send: { to, text } required");
  const c = await _creds(wallet);
  return _post(
    `${API}/${c.phone_number_id}/messages`,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: text },
    },
    c.access_token
  );
}

async function sendTemplate({ wallet, to, templateName, languageCode = "en_US", components }) {
  if (!to || !templateName) throw new Error("send_template: { to, templateName } required");
  const c = await _creds(wallet);
  return _post(
    `${API}/${c.phone_number_id}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: components || undefined,
      },
    },
    c.access_token
  );
}

async function markRead({ wallet, messageId }) {
  if (!messageId) throw new Error("mark_read: { messageId } required");
  const c = await _creds(wallet);
  return _post(
    `${API}/${c.phone_number_id}/messages`,
    { messaging_product: "whatsapp", status: "read", message_id: messageId },
    c.access_token
  );
}

async function invoke(action, ctx = {}) {
  const params = ctx.params || {};
  const wallet = ctx.wallet;
  switch (action) {
    case "send":          return send({ wallet, ...params });
    case "send_template": return sendTemplate({ wallet, ...params });
    case "mark_read":     return markRead({ wallet, ...params });
    default: throw new Error(`whatsapp connector: unknown action ${action}`);
  }
}

module.exports = {
  name: "whatsapp",
  capabilities: ["write", "monitor"],
  // WhatsApp Business has tier-based per-day limits (Tier 1: 1k unique
  // recipients/24h, Tier 4: unlimited). Our budget targets a Tier 1
  // baseline: comfortable for the Realtor / Car Sales Kits' outreach
  // volume. Tighten or relax per actual tier in production.
  rate_limits: { per_minute: 30, per_hour: 200, scope: "wallet" },
  auth_method: "byo_account",
  invoke,
  webhook: require("./webhook"),
};
