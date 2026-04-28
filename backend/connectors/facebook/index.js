// backend/connectors/facebook/index.js
//
// Facebook (Meta) connector — Graph API v19.
//
// Auth model: user-context OAuth 2.0 access token, stored encrypted
// per-wallet in connector_credentials. Page-scoped tokens (for page DM
// via Messenger) are nested in the same payload as { page_tokens:
// { [page_id]: token } } and selected at invoke time.
//
// Capability reality check:
//   - groups_read    — needs the `groups_access_member_info` Graph
//                      permission, which Meta has heavily restricted
//                      since 2023. Apps without explicit approval get
//                      403. The code path works; the platform-level
//                      gating does not.
//   - page_dm        — Messenger Platform send/2.0. Needs page access
//                      token + a recipient who messaged the page in
//                      the last 24h (24h customer-care window).
//   - marketplace_search — NOT EXPOSED via Graph API at any tier.
//                      Throws a clear error. Use the Jiji connector
//                      for classifieds search; the Realtor Kit
//                      fallbacks accordingly.
//
// Dormant until a wallet has connected via /api/connectors/facebook/connect.

const credentialStore = require("../credentialStore");

const API = "https://graph.facebook.com/v19.0";

async function tokens(wallet) {
  if (!wallet || wallet === "platform") return null;
  const row = await credentialStore.getDecrypted({ wallet, connector: "facebook" }).catch(() => null);
  return row?.payload || null; // { access_token, page_tokens?: { id: token } }
}

async function _fetchJson(url, { method = "GET", token, body } = {}) {
  if (!token) throw new Error("facebook: no access token — connect Facebook first");
  const u = new URL(url);
  // Graph API takes the token as a query param OR header; header is
  // less likely to leak in proxy logs.
  const res = await fetch(u.toString(), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* upstream non-JSON */ }
  if (!res.ok) {
    const err = new Error(`facebook ${method} ${url}: ${res.status} ${json?.error?.message || text.slice(0, 200)}`);
    err.status = res.status;
    err.body = json || text;
    throw err;
  }
  return json;
}

async function groupsRead({ wallet, groupId, limit = 25 }) {
  if (!groupId) throw new Error("groups_read: { groupId } required");
  const t = await tokens(wallet);
  if (!t?.access_token) throw new Error("groups_read: connect Facebook first");
  const u = new URL(`${API}/${encodeURIComponent(groupId)}/feed`);
  u.searchParams.set("limit", String(Math.min(100, Math.max(1, limit))));
  u.searchParams.set("fields", "id,message,created_time,from{id,name},permalink_url");
  return _fetchJson(u.toString(), { token: t.access_token });
}

async function pageDm({ wallet, pageId, recipientId, text }) {
  if (!pageId || !recipientId || !text) {
    throw new Error("page_dm: { pageId, recipientId, text } required");
  }
  const t = await tokens(wallet);
  const pageToken = t?.page_tokens?.[pageId];
  if (!pageToken) throw new Error(`page_dm: no token for page ${pageId} — re-run /connect`);
  return _fetchJson(`${API}/me/messages`, {
    method: "POST",
    token: pageToken,
    body: {
      recipient: { id: recipientId },
      messaging_type: "RESPONSE",  // 24h customer-care window
      message: { text },
    },
  });
}

function marketplaceSearch() {
  const err = new Error(
    "marketplace_search: not supported — Facebook Marketplace has no public Graph API endpoint. Use the jiji connector for classifieds search."
  );
  err.code = "FACEBOOK_MARKETPLACE_UNSUPPORTED";
  throw err;
}

async function invoke(action, ctx = {}) {
  const params = ctx.params || {};
  const wallet = ctx.wallet;
  switch (action) {
    case "groups_read":        return groupsRead({ wallet, ...params });
    case "page_dm":            return pageDm({ wallet, ...params });
    case "marketplace_search": return marketplaceSearch();
    default: throw new Error(`facebook connector: unknown action ${action}`);
  }
}

// Refresh — Facebook does not issue rotating refresh_tokens. Instead,
// short-lived user tokens (1h) can be exchanged for long-lived ones
// (60d) via fb_exchange_token. We do that exchange on the OAuth
// callback's first store; here we just extend a long-lived token by
// one more 60-day cycle if it's inside the refresh window. If the
// extension fails (token already expired, scopes revoked), the user
// has to re-run /oauth/start — there's no other automated path.
async function refresh({ wallet }) {
  const id     = process.env.FACEBOOK_APP_ID;
  const secret = process.env.FACEBOOK_APP_SECRET;
  if (!id || !secret) throw new Error("facebook refresh: app id/secret unset");
  const row = await credentialStore.getDecrypted({ wallet, connector: "facebook" });
  if (!row?.payload?.access_token) throw new Error("facebook refresh: no token on file");
  const u = new URL("https://graph.facebook.com/v19.0/oauth/access_token");
  u.searchParams.set("grant_type",        "fb_exchange_token");
  u.searchParams.set("client_id",         id);
  u.searchParams.set("client_secret",     secret);
  u.searchParams.set("fb_exchange_token", row.payload.access_token);
  const r = await fetch(u.toString());
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.access_token) {
    throw new Error(`facebook refresh failed: ${r.status} ${j?.error?.message || ""}`);
  }
  return {
    payload: {
      ...row.payload,                  // preserve page_tokens
      access_token: j.access_token,
      token_type:   j.token_type || "bearer",
    },
    expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : null,
  };
}

module.exports = {
  name: "facebook",
  capabilities: ["search", "read", "write"],
  // Graph API rate limits are app-level (200 calls/hour/user as a soft
  // baseline) and tightened by their BUC algorithm based on actual
  // server load. Conservative wallet-scoped cap: 60/hour ≈ 1/min steady,
  // bursts up to 60.
  rate_limits: { per_minute: 30, per_hour: 60, scope: "wallet" },
  auth_method: "oauth",
  invoke,
  refresh,
};
