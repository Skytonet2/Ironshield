// backend/connectors/facebook/oauth.js
//
// Facebook (Meta) Login OAuth 2.0. No PKCE — Meta's flow uses client
// secret on the token-exchange call.
//
//   https://www.facebook.com/v19.0/dialog/oauth
//   https://graph.facebook.com/v19.0/oauth/access_token
//
// After we get the user access token, we hit /me/accounts to pull the
// page tokens — those are what the page_dm action needs. They get
// stored alongside the user token under page_tokens: { [page_id]: token }.
//
// Scopes we ask for cover the connector's capabilities today:
//   pages_show_list, pages_messaging, groups_access_member_info
// (groups_access_member_info is heavily restricted by Meta — apps
// without explicit approval can still complete the OAuth dance, the
// Graph call just 403s downstream. Documented in COMPLIANCE.md.)

const credentialStore = require("../credentialStore");
const oauthState      = require("../oauthState");

const AUTH_URL  = "https://www.facebook.com/v19.0/dialog/oauth";
const TOKEN_URL = "https://graph.facebook.com/v19.0/oauth/access_token";
const ACCOUNTS  = "https://graph.facebook.com/v19.0/me/accounts";
const SCOPES    = "pages_show_list,pages_messaging,groups_access_member_info";

function _config() {
  const id     = process.env.FACEBOOK_APP_ID;
  const secret = process.env.FACEBOOK_APP_SECRET;
  const redir  = process.env.FACEBOOK_OAUTH_REDIRECT_URI;
  if (!id || !secret || !redir) {
    const err = new Error("facebook oauth: FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, FACEBOOK_OAUTH_REDIRECT_URI required");
    err.code = "FACEBOOK_OAUTH_NOT_CONFIGURED";
    throw err;
  }
  return { id, secret, redir };
}

function start(req, res) {
  let cfg;
  try { cfg = _config(); }
  catch (e) { return res.status(503).json({ error: e.message, code: e.code }); }

  const { state, cookie } = oauthState.fresh({
    wallet: req.wallet, connector: "facebook", withPkce: false,
  });
  oauthState.setCookie(res, cookie);

  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id",    cfg.id);
  u.searchParams.set("redirect_uri", cfg.redir);
  u.searchParams.set("scope",        SCOPES);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state",        state);
  res.json({ url: u.toString() });
}

async function _fetchPageTokens(userToken) {
  const u = new URL(ACCOUNTS);
  u.searchParams.set("access_token", userToken);
  u.searchParams.set("fields",       "id,access_token");
  const r = await fetch(u.toString());
  if (!r.ok) return {};
  const j = await r.json().catch(() => ({}));
  const out = {};
  for (const p of j.data || []) {
    if (p.id && p.access_token) out[p.id] = p.access_token;
  }
  return out;
}

async function callback(req, res) {
  let cfg;
  try { cfg = _config(); }
  catch (e) { return res.status(503).send(`facebook oauth: ${e.message}`); }
  const cookie = oauthState.readCookie(req);
  oauthState.clearCookie(res);
  const sess = oauthState.verify(cookie);
  if (!sess || sess.connector !== "facebook") {
    return res.status(400).send("invalid or expired oauth state — please retry from /connectors");
  }
  if (req.query.state !== sess.state) {
    return res.status(400).send("oauth state mismatch — possible CSRF, please retry");
  }
  if (req.query.error) {
    return res.redirect(oauthState.frontendRedirect(`/connectors?error=${encodeURIComponent(oauthState.safeErrorTag(req.query.error))}&connector=facebook`));
  }
  if (!req.query.code) {
    return res.status(400).send("missing oauth code");
  }

  const tokenUrl = new URL(TOKEN_URL);
  tokenUrl.searchParams.set("client_id",     cfg.id);
  tokenUrl.searchParams.set("client_secret", cfg.secret);
  tokenUrl.searchParams.set("redirect_uri",  cfg.redir);
  tokenUrl.searchParams.set("code",          String(req.query.code));
  const r = await fetch(tokenUrl.toString());
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.access_token) {
    return res.redirect(oauthState.frontendRedirect(`/connectors?error=${encodeURIComponent(oauthState.safeErrorTag(j?.error?.message || "token-exchange-failed"))}&connector=facebook`));
  }

  // Best-effort page-token harvest. If pages_show_list isn't granted
  // we still store the user token; page_dm action will fail with a
  // helpful error pointing the user back to /connect.
  const page_tokens = await _fetchPageTokens(j.access_token).catch(() => ({}));

  await credentialStore.upsert({
    wallet:    sess.wallet,
    connector: "facebook",
    payload: {
      access_token: j.access_token,
      token_type:   j.token_type || "bearer",
      page_tokens,
    },
    expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : null,
  });
  return res.redirect(oauthState.frontendRedirect("/connectors?connected=facebook"));
}

module.exports = { start, callback };
