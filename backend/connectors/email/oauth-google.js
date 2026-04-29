// backend/connectors/email/oauth-google.js
//
// Google OAuth 2.0 for Gmail. Uses the standard authorization-code
// flow with refresh_token (we ask for offline access). The resulting
// access token is used as XOAUTH2 SASL credential for SMTP + IMAP —
// nodemailer and imapflow both speak it natively, so we don't have to
// touch the wire format ourselves.
//
//   Auth URL:   https://accounts.google.com/o/oauth2/v2/auth
//   Token URL:  https://oauth2.googleapis.com/token
//
// Scope: https://mail.google.com/  — full mailbox SMTP+IMAP access.
// We do NOT request gmail.send / gmail.readonly because they only
// cover the Gmail API, not SMTP/IMAP. For pure-API path we'd swap.

const credentialStore = require("../credentialStore");
const oauthState      = require("../oauthState");

const AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO  = "https://openidconnect.googleapis.com/v1/userinfo";
const SCOPES    = "https://mail.google.com/ openid email";

function _config() {
  const id     = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  const redir  = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!id || !secret || !redir) {
    const err = new Error("google oauth: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI required");
    err.code = "GOOGLE_OAUTH_NOT_CONFIGURED";
    throw err;
  }
  return { id, secret, redir };
}

function start(req, res) {
  let cfg;
  try { cfg = _config(); }
  catch (e) { return res.status(503).json({ error: e.message, code: e.code }); }

  // The connector binding lands on the email row — we mark the cookie
  // with provider=google so the callback knows which token endpoint
  // to hit and how to shape the stored payload.
  const { state, cookie } = oauthState.fresh({
    wallet: req.wallet, connector: "email:google", withPkce: false,
  });
  oauthState.setCookie(res, cookie);

  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id",      cfg.id);
  u.searchParams.set("redirect_uri",   cfg.redir);
  u.searchParams.set("response_type",  "code");
  u.searchParams.set("scope",          SCOPES);
  u.searchParams.set("state",          state);
  u.searchParams.set("access_type",    "offline");      // gives us a refresh_token
  u.searchParams.set("prompt",         "consent");      // forces refresh_token reissue on re-link
  u.searchParams.set("include_granted_scopes", "true");
  res.json({ url: u.toString() });
}

async function _userinfo(accessToken) {
  const r = await fetch(USERINFO, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

async function callback(req, res) {
  let cfg;
  try { cfg = _config(); }
  catch (e) { return res.status(503).send(`google oauth: ${e.message}`); }

  const cookie = oauthState.readCookie(req);
  oauthState.clearCookie(res);
  const sess = oauthState.verify(cookie);
  if (!sess || sess.connector !== "email:google") {
    return res.status(400).send("invalid or expired oauth state — please retry from /connectors");
  }
  if (req.query.state !== sess.state) {
    return res.status(400).send("oauth state mismatch — possible CSRF, please retry");
  }
  if (req.query.error) {
    return res.redirect(oauthState.frontendRedirect(`/connectors?error=${encodeURIComponent(oauthState.safeErrorTag(req.query.error))}&connector=email`));
  }
  if (!req.query.code) return res.status(400).send("missing oauth code");

  const body = new URLSearchParams({
    grant_type:    "authorization_code",
    code:          String(req.query.code),
    client_id:     cfg.id,
    client_secret: cfg.secret,
    redirect_uri:  cfg.redir,
  });
  const r = await fetch(TOKEN_URL, {
    method:  "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.access_token) {
    return res.redirect(oauthState.frontendRedirect(`/connectors?error=${encodeURIComponent(oauthState.safeErrorTag(j?.error || "token-exchange-failed"))}&connector=email`));
  }

  const userinfo = await _userinfo(j.access_token).catch(() => null);
  const userEmail = userinfo?.email || null;
  if (!userEmail) {
    // Without the email address we can't construct SMTP/IMAP auth — abort.
    return res.redirect(oauthState.frontendRedirect(`/connectors?error=${encodeURIComponent("missing-email-claim")}&connector=email`));
  }

  // Persist as a single email-connector row. provider='google' tells
  // the connector to use XOAUTH2 with the access_token, and the
  // refresh worker to hit Google's token endpoint with refresh_token.
  await credentialStore.upsert({
    wallet:    sess.wallet,
    connector: "email",
    payload: {
      provider:      "google",
      user:          userEmail,
      access_token:  j.access_token,
      refresh_token: j.refresh_token || null,
      token_type:    j.token_type || "Bearer",
      scope:         j.scope || SCOPES,
      // Gmail's hosts are stable. Hard-coding here means the connector
      // doesn't need additional UX to ask the user for them.
      smtp: { host: "smtp.gmail.com", port: 465, secure: true,  user: userEmail },
      imap: { host: "imap.gmail.com", port: 993, secure: true,  user: userEmail },
    },
    expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : null,
  });
  return res.redirect(oauthState.frontendRedirect("/connectors?connected=email"));
}

/**
 * Token refresh — called by the email connector's refresh() when the
 * stored payload has provider:'google'. Returns the shape the
 * credentialStore.upsert path expects.
 */
async function refresh({ payload }) {
  const cfg = _config();
  if (!payload?.refresh_token) throw new Error("google email refresh: no refresh_token on file");
  const body = new URLSearchParams({
    grant_type:    "refresh_token",
    refresh_token: payload.refresh_token,
    client_id:     cfg.id,
    client_secret: cfg.secret,
  });
  const r = await fetch(TOKEN_URL, {
    method:  "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body:    body.toString(),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.access_token) {
    throw new Error(`google email refresh failed: ${r.status} ${j?.error || ""}`);
  }
  return {
    payload: {
      ...payload,
      access_token: j.access_token,
      // Google rotates refresh_tokens rarely; keep the existing one
      // unless a new one comes back.
      refresh_token: j.refresh_token || payload.refresh_token,
      token_type:    j.token_type || payload.token_type || "Bearer",
    },
    expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : null,
  };
}

module.exports = { start, callback, refresh };
