// backend/__tests__/connectors.email.oauth.test.js
//
// Unit-tests for the email connector's OAuth dispatch + refresh
// branch. Live token exchange is not exercised — that needs real
// provider creds — but the cred-shape selection, refresh dispatch,
// and dormant-config paths are covered.

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.CUSTODIAL_ENCRYPT_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.OAUTH_STATE_SECRET = "0".repeat(64);

const oauthGoogle    = require("../connectors/email/oauth-google");
const oauthMicrosoft = require("../connectors/email/oauth-microsoft");
const email          = require("../connectors/email");

function fakeReqRes(over = {}) {
  const headers = {};
  const res = {
    statusCode: 200, body: null,
    status(c) { res.statusCode = c; return res; },
    json(b)   { res.body = b; return res; },
    send(b)   { res.body = b; return res; },
    redirect(u) { res.statusCode = 302; res.body = u; return res; },
    setHeader(k, v) { headers[k] = v; },
    // Express 4-style append: accumulates Set-Cookie values across calls.
    append(k, v) { headers[k] = headers[k] ? [].concat(headers[k], v) : v; },
    end() {},
    _headers: headers,
  };
  return { req: { wallet: "alice.near", query: {}, headers: {}, ...over }, res };
}

test("email/oauth-google: start without env returns 503 with structured code", () => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
  const { req, res } = fakeReqRes();
  oauthGoogle.start(req, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "GOOGLE_OAUTH_NOT_CONFIGURED");
});

test("email/oauth-google: start with env returns a Google authorize URL + scope + offline access", () => {
  process.env.GOOGLE_CLIENT_ID     = "g-client";
  process.env.GOOGLE_CLIENT_SECRET = "g-secret";
  process.env.GOOGLE_OAUTH_REDIRECT_URI = "https://example.test/cb";
  const { req, res } = fakeReqRes();
  oauthGoogle.start(req, res);
  assert.equal(res.statusCode, 200);
  const u = new URL(res.body.url);
  assert.equal(u.hostname, "accounts.google.com");
  assert.match(u.searchParams.get("scope"), /https:\/\/mail\.google\.com\//);
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.ok(
    [].concat(res._headers["Set-Cookie"] || []).some(Boolean),
    "Set-Cookie should be set"
  );
});

test("email/oauth-microsoft: start without env returns 503", () => {
  delete process.env.MICROSOFT_CLIENT_ID;
  delete process.env.MICROSOFT_CLIENT_SECRET;
  delete process.env.MICROSOFT_OAUTH_REDIRECT_URI;
  const { req, res } = fakeReqRes();
  oauthMicrosoft.start(req, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "MICROSOFT_OAUTH_NOT_CONFIGURED");
});

test("email/oauth-microsoft: start hits Microsoft identity platform with SMTP+IMAP scopes", () => {
  process.env.MICROSOFT_CLIENT_ID     = "ms-client";
  process.env.MICROSOFT_CLIENT_SECRET = "ms-secret";
  process.env.MICROSOFT_OAUTH_REDIRECT_URI = "https://example.test/cb";
  const { req, res } = fakeReqRes();
  oauthMicrosoft.start(req, res);
  assert.equal(res.statusCode, 200);
  const u = new URL(res.body.url);
  assert.equal(u.hostname, "login.microsoftonline.com");
  assert.match(u.searchParams.get("scope"), /SMTP\.Send/);
  assert.match(u.searchParams.get("scope"), /IMAP\.AccessAsUser\.All/);
  assert.match(u.searchParams.get("scope"), /offline_access/);
});

test("email connector: refresh() dispatches by provider", async () => {
  const credStore = require("../connectors/credentialStore");
  const orig = credStore.getDecrypted;

  // 1. provider:'google' — should call oauth-google.refresh which fails
  //    fast on no refresh_token rather than dispatching wrong.
  credStore.getDecrypted = async () => ({ payload: { provider: "google" } });
  await assert.rejects(
    () => email.refresh({ wallet: "alice.near" }),
    /no refresh_token on file/
  );

  // 2. provider:'microsoft'
  credStore.getDecrypted = async () => ({ payload: { provider: "microsoft" } });
  await assert.rejects(
    () => email.refresh({ wallet: "alice.near" }),
    /no refresh_token on file/
  );

  // 3. byo (no provider) — structured EMAIL_NO_REFRESH error
  credStore.getDecrypted = async () => ({ payload: { smtp: { user: "x" } } });
  let err;
  try { await email.refresh({ wallet: "alice.near" }); } catch (e) { err = e; }
  assert.ok(err);
  assert.equal(err.code, "EMAIL_NO_REFRESH");

  credStore.getDecrypted = orig;
});

test("email connector: still exposes refresh() in module surface", () => {
  assert.equal(typeof email.refresh, "function");
});
