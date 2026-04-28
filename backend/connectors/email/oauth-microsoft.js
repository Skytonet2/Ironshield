// backend/connectors/email/oauth-microsoft.js
//
// Microsoft (Outlook / Microsoft 365) OAuth 2.0. Same shape as
// oauth-google but with Microsoft's identity platform endpoints.
//
//   Auth URL:   https://login.microsoftonline.com/common/oauth2/v2.0/authorize
//   Token URL:  https://login.microsoftonline.com/common/oauth2/v2.0/token
//
// Tenant `/common` lets both consumer (outlook.com / hotmail) and
// enterprise (Microsoft 365) accounts authorize through the same flow.
//
// Scope notes:
//   - SMTP/IMAP via OAuth on Microsoft requires the SMTP.Send +
//     IMAP.AccessAsUser.All resource scopes plus offline_access for a
//     refresh_token. These are the modern XOAUTH2 endpoints; basic
//     auth has been deprecated for years and is now disabled by
//     default on most tenants.
//   - openid + email gets us the `mail` claim for the display name
//     so we can write the SMTP/IMAP `user` field.

const credentialStore = require("../credentialStore");
const oauthState      = require("../oauthState");

const AUTH_URL  = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const USERINFO  = "https://graph.microsoft.com/v1.0/me";
const SCOPES    = "https://outlook.office.com/SMTP.Send https://outlook.office.com/IMAP.AccessAsUser.All openid email offline_access";

function _config() {
  const id     = process.env.MICROSOFT_CLIENT_ID;
  const secret = process.env.MICROSOFT_CLIENT_SECRET;
  const redir  = process.env.MICROSOFT_OAUTH_REDIRECT_URI;
  if (!id || !secret || !redir) {
    const err = new Error("microsoft oauth: MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_OAUTH_REDIRECT_URI required");
    err.code = "MICROSOFT_OAUTH_NOT_CONFIGURED";
    throw err;
  }
  return { id, secret, redir };
}

function start(req, res) {
  let cfg;
  try { cfg = _config(); }
  catch (e) { return res.status(503).json({ error: e.message, code: e.code }); }

  const { state, cookie } = oauthState.fresh({
    wallet: req.wallet, connector: "email:microsoft", withPkce: false,
  });
  oauthState.setCookie(res, cookie);

  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id",     cfg.id);
  u.searchParams.set("redirect_uri",  cfg.redir);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope",         SCOPES);
  u.searchParams.set("state",         state);
  u.searchParams.set("response_mode", "query");
  // Force account picker so a user signed into multiple Microsoft
  // accounts in the browser doesn't accidentally bind the wrong one.
  u.searchParams.set("prompt",        "select_account");
  res.json({ url: u.toString() });
}

async function _userinfo(accessToken) {
  // Graph /me returns the userPrincipalName and mail; either works
  // as the SMTP/IMAP login. mail is preferred when populated.
  const r = await fetch(USERINFO, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.mail || j?.userPrincipalName || null;
}

async function callback(req, res) {
  let cfg;
  try { cfg = _config(); }
  catch (e) { return res.status(503).send(`microsoft oauth: ${e.message}`); }

  const cookie = oauthState.readCookie(req);
  oauthState.clearCookie(res);
  const sess = oauthState.verify(cookie);
  if (!sess || sess.connector !== "email:microsoft") {
    return res.status(400).send("invalid or expired oauth state — please retry from /connectors");
  }
  if (req.query.state !== sess.state) {
    return res.status(400).send("oauth state mismatch — possible CSRF, please retry");
  }
  if (req.query.error) {
    return res.redirect(`/connectors?error=${encodeURIComponent(String(req.query.error))}&connector=email`);
  }
  if (!req.query.code) return res.status(400).send("missing oauth code");

  const body = new URLSearchParams({
    grant_type:    "authorization_code",
    code:          String(req.query.code),
    client_id:     cfg.id,
    client_secret: cfg.secret,
    redirect_uri:  cfg.redir,
    scope:         SCOPES,
  });
  const r = await fetch(TOKEN_URL, {
    method:  "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.access_token) {
    return res.redirect(`/connectors?error=${encodeURIComponent(j?.error || "token-exchange-failed")}&connector=email`);
  }

  const userEmail = await _userinfo(j.access_token).catch(() => null);
  if (!userEmail) {
    return res.redirect(`/connectors?error=${encodeURIComponent("missing-email-claim")}&connector=email`);
  }

  await credentialStore.upsert({
    wallet:    sess.wallet,
    connector: "email",
    payload: {
      provider:      "microsoft",
      user:          userEmail,
      access_token:  j.access_token,
      refresh_token: j.refresh_token || null,
      token_type:    j.token_type || "Bearer",
      scope:         j.scope || SCOPES,
      smtp: { host: "smtp.office365.com", port: 587, secure: false, user: userEmail },
      imap: { host: "outlook.office365.com", port: 993, secure: true,  user: userEmail },
    },
    expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : null,
  });
  return res.redirect("/connectors?connected=email");
}

async function refresh({ payload }) {
  const cfg = _config();
  if (!payload?.refresh_token) throw new Error("microsoft email refresh: no refresh_token on file");
  const body = new URLSearchParams({
    grant_type:    "refresh_token",
    refresh_token: payload.refresh_token,
    client_id:     cfg.id,
    client_secret: cfg.secret,
    scope:         SCOPES,
  });
  const r = await fetch(TOKEN_URL, {
    method:  "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.access_token) {
    throw new Error(`microsoft email refresh failed: ${r.status} ${j?.error || ""}`);
  }
  return {
    payload: {
      ...payload,
      access_token: j.access_token,
      // Microsoft DOES rotate refresh_tokens on each refresh; use the
      // new one when present.
      refresh_token: j.refresh_token || payload.refresh_token,
      token_type:    j.token_type || payload.token_type || "Bearer",
    },
    expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : null,
  };
}

module.exports = { start, callback, refresh };
