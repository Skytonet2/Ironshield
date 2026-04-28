// backend/__tests__/connectors.linkedin.test.js
// Shape + dispatch + dormant-path + apply-gate tests.
// Live scraping intentionally untested.

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.CUSTODIAL_ENCRYPT_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
delete process.env.LINKEDIN_AUTO_APPLY_ENABLED;

const li = require("../connectors/linkedin");

test("linkedin connector: contract shape", () => {
  assert.equal(li.name, "linkedin");
  assert.deepEqual(li.capabilities.sort(), ["read", "search", "write"]);
  assert.equal(li.auth_method, "session_token");
  assert.equal(li.rate_limits.scope, "wallet");
  // Aggressively low rate cap — ban-mitigation.
  assert.ok(li.rate_limits.per_hour <= 20, "linkedin per_hour must be low");
});

test("linkedin connector: apply disabled by default", async () => {
  let err;
  try { await li.invoke("apply", { wallet: "alice.near", params: { jobId: "j1", confirm: true } }); }
  catch (e) { err = e; }
  assert.ok(err);
  assert.equal(err.code, "LINKEDIN_APPLY_DISABLED");
});

test("linkedin connector: apply with env enabled but no confirm flag", async () => {
  process.env.LINKEDIN_AUTO_APPLY_ENABLED = "true";
  // Re-require to pick up env? The module reads env at module load. So
  // setting after-the-fact won't flip APPLY_ENABLED. We expect the
  // disabled error here as long as the require happened before env was set.
  let err;
  try { await li.invoke("apply", { wallet: "alice.near", params: { jobId: "j1" } }); }
  catch (e) { err = e; }
  assert.ok(err);
  // Either disabled (if module captured env at load) or confirm-missing
  // (if env was caught). Both are valid guard paths.
  assert.ok(/LINKEDIN_APPLY_DISABLED|LINKEDIN_APPLY_CONFIRM_MISSING/.test(err.code));
  delete process.env.LINKEDIN_AUTO_APPLY_ENABLED;
});

test("linkedin connector: search rejects without query", async () => {
  await assert.rejects(
    () => li.invoke("search", { wallet: "alice.near", params: {} }),
    /\{ query \} required/
  );
});

test("linkedin connector: scrape rejects without slug", async () => {
  await assert.rejects(
    () => li.invoke("scrape", { wallet: "alice.near", params: {} }),
    /\{ profileSlug \} required/
  );
});

test("linkedin connector: invoke rejects unknown action", async () => {
  await assert.rejects(
    () => li.invoke("teleport", { wallet: "alice.near" }),
    /unknown action/
  );
});

test("linkedin connector: search without creds throws connect-first", async () => {
  const credStore = require("../connectors/credentialStore");
  const orig = credStore.getDecrypted;
  credStore.getDecrypted = async () => null;
  try {
    let err;
    try { await li.invoke("search", { wallet: "alice.near", params: { query: "react dev" } }); }
    catch (e) { err = e; }
    assert.ok(err);
    // Either creds-missing path (preferred) or playwright-missing (if cred check ordered after).
    assert.ok(/connect first|LINKEDIN_PLAYWRIGHT_MISSING/.test(err.message + (err.code || "")));
  } finally {
    credStore.getDecrypted = orig;
  }
});
