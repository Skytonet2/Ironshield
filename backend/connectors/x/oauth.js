// backend/connectors/x/oauth.js
//
// X (Twitter) OAuth 2.0 with PKCE.
//
//   GET https://x.com/i/oauth2/authorize
//   POST https://api.x.com/2/oauth2/token  (form-encoded, basic auth)
//
// Scopes cover the actions the X connector exposes today:
//   tweet.read tweet.write users.read dm.read dm.write offline.access
//
// `offline.access` is what gets us a refresh_token. Without it we'd
// have to bounce the user through this flow every two hours.

const credentialStore = require("../credentialStore");
const oauthState      = require("../oauthState");

const AUTH_URL  = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const SCOPES    = "tweet.read tweet.write users.read dm.read dm.write offline.access";

function _config() {
  const id     = process.env.X_CLIENT_ID;
  const secret = process.env.X_CLIENT_SECRET;
  const redir  = process.env.X_OAUTH_REDIRECT_URI;
  if (!id || !secret || !redir) {
    const err = new Error("x oauth: X_CLIENT_ID, X_CLIENT_SECRET, X_OAUTH_REDIRECT_URI required");
    err.code = "X_OAUTH_NOT_CONFIGURED";
    throw err;
  }
  return { id, secret, redir };
}

function start(req, res) {
  let cfg;
  try { cfg = _config(); }
  catch (e) { return res.status(503).json({ error: e.message, code: e.code }); }

  const { state, challenge, cookie } = oauthState.fresh({
    wallet: req.wallet, connector: "x", withPkce: true,
  });
  oauthState.setCookie(res, cookie);

  const u = new URL(AUTH_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id",     cfg.id);
  u.searchParams.set("redirect_uri",  cfg.redir);
  u.searchParams.set("scope",         SCOPES);
  u.searchParams.set("state",         state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  res.json({ url: u.toString() });
}

async function callback(req, res) {
  let cfg;
  try { cfg = _config(); }
  catch (e) { return res.status(503).send(`x oauth: ${e.message}`); }
  const cookie = oauthState.readCookie(req);
  oauthState.clearCookie(res);
  const sess = oauthState.verify(cookie);
  if (!sess || sess.connector !== "x") {
    return res.status(400).send("invalid or expired oauth state — please retry from /connectors");
  }
  if (req.query.state !== sess.state) {
    return res.status(400).send("oauth state mismatch — possible CSRF, please retry");
  }
  if (req.query.error) {
    return res.redirect(oauthState.frontendRedirect(`/connectors?error=${encodeURIComponent(oauthState.safeErrorTag(req.query.error))}&connector=x`));
  }
  if (!req.query.code) {
    return res.status(400).send("missing oauth code");
  }

  const body = new URLSearchParams({
    grant_type:    "authorization_code",
    code:          String(req.query.code),
    redirect_uri:  cfg.redir,
    code_verifier: sess.verifier,
    client_id:     cfg.id,
  });
  const basic = Buffer.from(`${cfg.id}:${cfg.secret}`).toString("base64");
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization:  `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = null; }
  if (!r.ok || !j?.access_token) {
    return res.redirect(oauthState.frontendRedirect(`/connectors?error=${encodeURIComponent(oauthState.safeErrorTag(j?.error || "token-exchange-failed"))}&connector=x`));
  }

  await credentialStore.upsert({
    wallet:    sess.wallet,
    connector: "x",
    payload: {
      access_token:  j.access_token,
      refresh_token: j.refresh_token || null,
      token_type:    j.token_type || "bearer",
      scope:         j.scope || SCOPES,
    },
    expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : null,
  });
  return res.redirect(oauthState.frontendRedirect("/connectors?connected=x"));
}

module.exports = { start, callback };
