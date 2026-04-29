// backend/__tests__/connectors.x.test.js
// Shape + dispatch checks for the X connector. No live HTTP — that
// path requires a real bearer + user OAuth tokens which arrive via the
// connect endpoint commit.

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.CUSTODIAL_ENCRYPT_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const x = require("../connectors/x");

test("x connector: contract shape", () => {
  assert.equal(x.name, "x");
  assert.deepEqual(x.capabilities.sort(), ["read", "search", "write"]);
  assert.equal(x.auth_method, "oauth");
  assert.equal(typeof x.invoke, "function");
  assert.ok(x.rate_limits.per_minute > 0);
  assert.equal(x.rate_limits.scope, "wallet");
});

test("x connector: invoke rejects unknown action", async () => {
  await assert.rejects(
    () => x.invoke("teleport", { wallet: "alice.near" }),
    /unknown action/
  );
});

test("x connector: post without user token throws helpful error", async () => {
  // Stub credentialStore.getDecrypted to return null (no row).
  const credStore = require("../connectors/credentialStore");
  const origGet = credStore.getDecrypted;
  credStore.getDecrypted = async () => null;
  try {
    await assert.rejects(
      () => x.invoke("post", { wallet: "alice.near", params: { text: "hi" } }),
      /connect X first/
    );
  } finally {
    credStore.getDecrypted = origGet;
  }
});

test("x connector: search without bearer throws no-token error", async () => {
  // The module read X_BEARER_TOKEN at require time; we can't undo that
  // here, but we can assert the error path when search runs without one.
  // If X_BEARER_TOKEN happens to be set in the test env, skip this case.
  if (process.env.X_BEARER_TOKEN) {
    assert.ok(true, "X_BEARER_TOKEN is set; skipping no-bearer assertion");
    return;
  }
  await assert.rejects(
    () => x.invoke("search", { params: { query: "foo" } }),
    /no bearer\/user token/
  );
});

test("x oauth: callback returns 503 when client creds are missing", async () => {
  // Save + clear the env so _config() throws.
  const saved = {
    id: process.env.X_CLIENT_ID,
    secret: process.env.X_CLIENT_SECRET,
    redir: process.env.X_OAUTH_REDIRECT_URI,
  };
  delete process.env.X_CLIENT_ID;
  delete process.env.X_CLIENT_SECRET;
  delete process.env.X_OAUTH_REDIRECT_URI;
  try {
    const xOauth = require("../connectors/x/oauth");
    let status, body;
    const res = {
      status(c) { status = c; return res; },
      send(b)   { body = b; return res; },
      redirect() { return res; },
    };
    await xOauth.callback({ query: {}, headers: {} }, res);
    assert.equal(status, 503);
    assert.match(body, /x oauth/);
  } finally {
    if (saved.id)     process.env.X_CLIENT_ID = saved.id;
    if (saved.secret) process.env.X_CLIENT_SECRET = saved.secret;
    if (saved.redir)  process.env.X_OAUTH_REDIRECT_URI = saved.redir;
  }
});
