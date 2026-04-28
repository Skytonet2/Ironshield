// backend/__tests__/connectors.jiji.test.js
// Shape + dispatch checks. Live scraping is not tested here — it'd be
// flaky CI noise; the connector is best-effort by design.

const test = require("node:test");
const assert = require("node:assert/strict");

const jiji = require("../connectors/jiji");

test("jiji connector: contract shape", () => {
  assert.equal(jiji.name, "jiji");
  assert.deepEqual(jiji.capabilities, ["search"]);
  assert.equal(jiji.auth_method, "byo_account");
  assert.equal(jiji.rate_limits.scope, "wallet");
  // Tight throttle — scraping connectors should never have generous quotas.
  assert.ok(jiji.rate_limits.per_hour <= 60, "per_hour should be conservative");
});

test("jiji connector: search without query throws", async () => {
  await assert.rejects(
    () => jiji.invoke("search", {}),
    /\{ query \} required/
  );
});

test("jiji connector: invoke rejects unknown action", async () => {
  await assert.rejects(
    () => jiji.invoke("teleport", {}),
    /unknown action/
  );
});
