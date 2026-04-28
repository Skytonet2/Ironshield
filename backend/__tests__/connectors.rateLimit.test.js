// backend/__tests__/connectors.rateLimit.test.js
// Unit tests for the connector rate-limit hub (Phase 10 Tier 4).

const test = require("node:test");
const assert = require("node:assert/strict");

const rl = require("../connectors/rateLimit");

test("acquire: bucket of capacity N grants N tokens immediately", async () => {
  rl._reset();
  rl.configure("burst", { per_minute: 5, scope: "wallet" });
  for (let i = 0; i < 5; i++) {
    await rl.acquire("burst", "alice.near");
  }
  // 6th should wait (we don't await it — just probe that tryAcquire is now false)
  assert.equal(rl.tryAcquire("burst", "alice.near"), false);
});

test("tryAcquire: separate buckets per wallet under wallet scope", () => {
  rl._reset();
  rl.configure("split", { per_minute: 1, scope: "wallet" });
  assert.equal(rl.tryAcquire("split", "alice.near"), true);
  assert.equal(rl.tryAcquire("split", "alice.near"), false);
  assert.equal(rl.tryAcquire("split", "bob.near"),   true);  // bob has his own bucket
});

test("platform scope: all wallets share one bucket", () => {
  rl._reset();
  rl.configure("shared", { per_minute: 2, scope: "platform" });
  assert.equal(rl.tryAcquire("shared", "alice.near"), true);
  assert.equal(rl.tryAcquire("shared", "bob.near"),   true);
  assert.equal(rl.tryAcquire("shared", "carol.near"), false); // exhausted
});

test("acquire: throws on unknown connector", async () => {
  rl._reset();
  await assert.rejects(() => rl.acquire("nope", "alice.near"), /unknown connector/);
});

test("default quota when limits unset: 60/min, permissive but bounded", () => {
  rl._reset();
  rl.configure("default", {});
  let granted = 0;
  for (let i = 0; i < 70; i++) {
    if (rl.tryAcquire("default", "alice.near")) granted++;
  }
  assert.equal(granted, 60);
});

test("acquire: queue cap rejects with RATE_LIMIT_QUEUE_FULL", async () => {
  rl._reset();
  // Tight bucket: 1 token, slow refill so the queue actually fills.
  rl.configure("tight", { per_hour: 1, scope: "platform" });
  // Drain the bucket.
  await rl.acquire("tight", "platform");
  // Fill the queue with N pending acquires (don't await them).
  const pending = [];
  for (let i = 0; i < 32; i++) pending.push(rl.acquire("tight", "platform"));
  // The 33rd should reject with RATE_LIMIT_QUEUE_FULL.
  let err;
  try { await rl.acquire("tight", "platform"); } catch (e) { err = e; }
  assert.ok(err, "expected rejection");
  assert.equal(err.code, "RATE_LIMIT_QUEUE_FULL");
  // Don't bother awaiting `pending` — they'll resolve eventually but
  // not within this test. Reset cleans them up.
  rl._reset();
});

test("tightest of multiple windows wins", () => {
  rl._reset();
  // 60/min implies 1/sec tokens-per-ms; 100/hour is far slower so wins.
  rl.configure("multi", { per_minute: 60, per_hour: 100, scope: "platform" });
  let granted = 0;
  for (let i = 0; i < 110; i++) {
    if (rl.tryAcquire("multi", "platform")) granted++;
  }
  assert.equal(granted, 100, "per_hour: 100 should be the tightest binding cap");
});
