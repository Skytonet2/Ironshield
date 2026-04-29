// backend/connectors/x/index.js
//
// Twitter / X connector — API v2 (https://developer.x.com/en/docs/x-api).
//
// Mixed auth model:
//   - search / mentions: app-level bearer token (X_BEARER_TOKEN). Read-only.
//   - post / dm:         user-context OAuth 2.0 access token, stored per
//                        wallet in connector_credentials. The dispatcher
//                        picks user-context if a row exists for the wallet,
//                        otherwise falls back to bearer for read paths only.
//
// Dormant until X_BEARER_TOKEN is set (read-only paths) or a user has
// connected their X account (write paths). Connect flow lands in the
// /api/connectors/:name/connect commit.

const credentialStore = require("../credentialStore");

const API = "https://api.x.com/2";
const APP_BEARER = process.env.X_BEARER_TOKEN || "";

async function userToken(wallet) {
  if (!wallet || wallet === "platform") return null;
  let row;
  try {
    row = await credentialStore.getDecrypted({ wallet, connector: "x" });
  } catch (e) {
    // DB hiccup is not the same as "no token on file" — surface a
    // distinct error so callers don't tell the user to re-do OAuth
    // when the storage layer is just sleepy.
    console.warn(`[x] credentialStore lookup failed for ${wallet}:`, e.message);
    const err = new Error("x: credential lookup unavailable — try again shortly");
    err.code = "X_CRED_LOOKUP_FAILED";
    throw err;
  }
  return row?.payload?.access_token || null;
}

async function _fetchJson(url, { method = "GET", token, body } = {}) {
  if (!token) throw new Error("x: no bearer/user token available");
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* upstream sent non-JSON */ }
  if (!res.ok) {
    const err = new Error(`x ${method} ${url}: ${res.status} ${json?.title || text.slice(0, 200)}`);
    err.status = res.status;
    err.body = json || text;
    throw err;
  }
  return json;
}

async function search({ query, maxResults = 10 }) {
  if (!query) throw new Error("search: { query } required");
  const token = APP_BEARER;
  const u = new URL(`${API}/tweets/search/recent`);
  u.searchParams.set("query", query);
  u.searchParams.set("max_results", String(Math.min(100, Math.max(10, maxResults))));
  u.searchParams.set("tweet.fields", "author_id,created_at,public_metrics,lang");
  return _fetchJson(u.toString(), { token });
}

async function post({ wallet, text, replyTo }) {
  if (!text) throw new Error("post: { text } required");
  const token = await userToken(wallet);
  if (!token) throw new Error("post: no user token for wallet — connect X first");
  const body = { text };
  if (replyTo) body.reply = { in_reply_to_tweet_id: String(replyTo) };
  return _fetchJson(`${API}/tweets`, { method: "POST", token, body });
}

async function dm({ wallet, participantId, text }) {
  if (!participantId || !text) throw new Error("dm: { participantId, text } required");
  const token = await userToken(wallet);
  if (!token) throw new Error("dm: no user token for wallet — connect X first");
  return _fetchJson(
    `${API}/dm_conversations/with/${encodeURIComponent(participantId)}/messages`,
    { method: "POST", token, body: { text } }
  );
}

async function mentions({ wallet, userId, maxResults = 10 }) {
  if (!userId) throw new Error("mentions: { userId } required");
  // Prefer user token if present (higher quota), else app bearer.
  const token = (await userToken(wallet)) || APP_BEARER;
  const u = new URL(`${API}/users/${encodeURIComponent(userId)}/mentions`);
  u.searchParams.set("max_results", String(Math.min(100, Math.max(5, maxResults))));
  u.searchParams.set("tweet.fields", "author_id,created_at,public_metrics");
  return _fetchJson(u.toString(), { token });
}

async function invoke(action, ctx = {}) {
  const params = ctx.params || {};
  const wallet = ctx.wallet;
  switch (action) {
    case "search":   return search(params);
    case "post":     return post({ wallet, ...params });
    case "dm":       return dm({ wallet, ...params });
    case "mentions": return mentions({ wallet, ...params });
    default: throw new Error(`x connector: unknown action ${action}`);
  }
}

// Refresh — called by connectorRefresh worker before expires_at fires.
// X expects grant_type=refresh_token + Basic-auth client creds at the
// same /oauth2/token endpoint the OAuth callback uses. Returns the
// shape upsert() expects: { payload, expiresAt }.
async function refresh({ wallet }) {
  const id     = process.env.X_CLIENT_ID;
  const secret = process.env.X_CLIENT_SECRET;
  if (!id || !secret) throw new Error("x refresh: X_CLIENT_ID/SECRET unset");
  const row = await credentialStore.getDecrypted({ wallet, connector: "x" });
  if (!row?.payload?.refresh_token) throw new Error("x refresh: no refresh_token on file");
  const body = new URLSearchParams({
    grant_type:    "refresh_token",
    refresh_token: row.payload.refresh_token,
    client_id:     id,
  });
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  const r = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      authorization:  `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.access_token) {
    throw new Error(`x refresh failed: ${r.status} ${j?.error || ""}`);
  }
  return {
    payload: {
      access_token:  j.access_token,
      // X rotates refresh tokens — use the new one if returned, else keep old.
      refresh_token: j.refresh_token || row.payload.refresh_token,
      token_type:    j.token_type || "bearer",
      scope:         j.scope || row.payload.scope,
    },
    expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : null,
  };
}

module.exports = {
  name: "x",
  capabilities: ["search", "read", "write"],
  // X v2 free-tier limits are tight (search 60/15min app, 180/15min user;
  // post 17/24h app, 200/15min user). Set a conservative cap that respects
  // the user-context window and lets the rate hub buffer bursts.
  rate_limits: { per_minute: 12, per_hour: 180, scope: "wallet" },
  auth_method: "oauth",
  invoke,
  refresh,
};
