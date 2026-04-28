// backend/__tests__/oauthState.test.js
// Sign / verify / cookie helpers for the connector OAuth round-trip.

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.OAUTH_STATE_SECRET =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const oauthState = require("../connectors/oauthState");

test("oauthState.fresh returns a state, cookie, and (when asked) PKCE pair", () => {
  const out = oauthState.fresh({ wallet: "alice.near", connector: "x", withPkce: true });
  assert.equal(typeof out.state, "string");
  assert.ok(out.state.length >= 24);
  assert.equal(typeof out.verifier, "string");
  assert.equal(typeof out.challenge, "string");
  assert.equal(typeof out.cookie, "string");
  assert.match(out.cookie, /\./, "cookie format should be body.mac");
});

test("oauthState.fresh without PKCE skips verifier + challenge", () => {
  const out = oauthState.fresh({ wallet: "alice.near", connector: "facebook" });
  assert.equal(out.verifier, null);
  assert.equal(out.challenge, null);
});

test("oauthState.verify accepts a freshly-signed cookie", () => {
  const { cookie, payload } = oauthState.fresh({ wallet: "alice.near", connector: "x", withPkce: true });
  const verified = oauthState.verify(cookie);
  assert.ok(verified);
  assert.equal(verified.wallet, "alice.near");
  assert.equal(verified.connector, "x");
  assert.equal(verified.state, payload.state);
});

test("oauthState.verify rejects tampered cookies", () => {
  const { cookie } = oauthState.fresh({ wallet: "alice.near", connector: "x" });
  const dot = cookie.lastIndexOf(".");
  const tampered = cookie.slice(0, dot) + "." + "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  assert.equal(oauthState.verify(tampered), null);
});

test("oauthState.verify rejects expired cookies", () => {
  // Sign a payload with exp in the past directly via .sign().
  const expired = oauthState.sign({
    wallet: "alice.near", connector: "x", state: "s", verifier: null, exp: Date.now() - 1000,
  });
  assert.equal(oauthState.verify(expired), null);
});

test("oauthState.readCookie picks our cookie out of a multi-cookie header", () => {
  const fakeReq = { headers: { cookie: `other=foo; ${oauthState.COOKIE_NAME}=tok123; another=bar` } };
  assert.equal(oauthState.readCookie(fakeReq), "tok123");
});

test("oauthState.readCookie returns null when our cookie is absent", () => {
  const fakeReq = { headers: { cookie: "other=foo; another=bar" } };
  assert.equal(oauthState.readCookie(fakeReq), null);
});
