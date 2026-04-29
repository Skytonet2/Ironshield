// backend/__tests__/connectors.facebook.test.js
// Shape + dispatch checks for the Facebook connector.

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.CUSTODIAL_ENCRYPT_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const fb = require("../connectors/facebook");

test("facebook connector: contract shape", () => {
  assert.equal(fb.name, "facebook");
  assert.deepEqual(fb.capabilities.sort(), ["read", "search", "write"]);
  assert.equal(fb.auth_method, "oauth");
  assert.equal(fb.rate_limits.scope, "wallet");
});

test("facebook connector: marketplace_search throws structured unsupported error", async () => {
  let err;
  try { await fb.invoke("marketplace_search", { wallet: "alice.near" }); }
  catch (e) { err = e; }
  assert.ok(err);
  assert.equal(err.code, "FACEBOOK_MARKETPLACE_UNSUPPORTED");
});

test("facebook connector: page_dm without page token throws", async () => {
  const credStore = require("../connectors/credentialStore");
  const orig = credStore.getDecrypted;
  credStore.getDecrypted = async () => ({ payload: { access_token: "u-tok" } }); // no page_tokens
  try {
    await assert.rejects(
      () => fb.invoke("page_dm", {
        wallet: "alice.near",
        params: { pageId: "p1", recipientId: "r1", text: "hi" },
      }),
      /no token for page p1/
    );
  } finally {
    credStore.getDecrypted = orig;
  }
});

test("facebook connector: groups_read without token throws connect-first", async () => {
  const credStore = require("../connectors/credentialStore");
  const orig = credStore.getDecrypted;
  credStore.getDecrypted = async () => null;
  try {
    await assert.rejects(
      () => fb.invoke("groups_read", { wallet: "alice.near", params: { groupId: "g1" } }),
      /connect Facebook first/
    );
  } finally {
    credStore.getDecrypted = orig;
  }
});

test("facebook connector: invoke rejects unknown action", async () => {
  await assert.rejects(
    () => fb.invoke("teleport", { wallet: "alice.near" }),
    /unknown action/
  );
});

test("facebook oauth: callback returns 503 when app creds are missing", async () => {
  const saved = {
    id: process.env.FACEBOOK_APP_ID,
    secret: process.env.FACEBOOK_APP_SECRET,
    redir: process.env.FACEBOOK_OAUTH_REDIRECT_URI,
  };
  delete process.env.FACEBOOK_APP_ID;
  delete process.env.FACEBOOK_APP_SECRET;
  delete process.env.FACEBOOK_OAUTH_REDIRECT_URI;
  try {
    const fbOauth = require("../connectors/facebook/oauth");
    let status, body;
    const res = {
      status(c) { status = c; return res; },
      send(b)   { body = b; return res; },
      redirect() { return res; },
    };
    await fbOauth.callback({ query: {}, headers: {} }, res);
    assert.equal(status, 503);
    assert.match(body, /facebook oauth/);
  } finally {
    if (saved.id)     process.env.FACEBOOK_APP_ID = saved.id;
    if (saved.secret) process.env.FACEBOOK_APP_SECRET = saved.secret;
    if (saved.redir)  process.env.FACEBOOK_OAUTH_REDIRECT_URI = saved.redir;
  }
});
