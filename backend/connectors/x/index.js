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
  const row = await credentialStore.getDecrypted({ wallet, connector: "x" }).catch(() => null);
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

module.exports = {
  name: "x",
  capabilities: ["search", "read", "write"],
  // X v2 free-tier limits are tight (search 60/15min app, 180/15min user;
  // post 17/24h app, 200/15min user). Set a conservative cap that respects
  // the user-context window and lets the rate hub buffer bursts.
  rate_limits: { per_minute: 12, per_hour: 180, scope: "wallet" },
  auth_method: "oauth",
  invoke,
};
