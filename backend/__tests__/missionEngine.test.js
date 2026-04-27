// backend/__tests__/missionEngine.test.js
//
// Unit tests for the mission engine's pure helpers:
//   canTransition  — state-machine guard
//   hashPayload    — deterministic SHA-256 over stable JSON
//   stableStringify — key-sorted serialization
//
// recordCreated / mirrorEvent / appendAuditStep all touch Postgres and
// are exercised by integration suites.

const test = require("node:test");
const assert = require("node:assert/strict");

const path = require("node:path");
const clientPath = path.resolve(__dirname, "..", "db", "client.js");
require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true,
  exports: {
    query: async () => ({ rows: [] }),
    transaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
    pool: { connect: async () => ({ release: () => {}, query: async () => ({ rows: [] }) }) },
  },
};

const me = require("../services/missionEngine");

test("canTransition: open → claimed allowed", () => {
  assert.equal(me.canTransition(me.STATUS_OPEN, me.STATUS_CLAIMED), true);
});

test("canTransition: open → aborted allowed", () => {
  assert.equal(me.canTransition(me.STATUS_OPEN, me.STATUS_ABORTED), true);
});

test("canTransition: open → submitted forbidden (must claim first)", () => {
  assert.equal(me.canTransition(me.STATUS_OPEN, me.STATUS_SUBMITTED), false);
});

test("canTransition: claimed → submitted allowed", () => {
  assert.equal(me.canTransition(me.STATUS_CLAIMED, me.STATUS_SUBMITTED), true);
});

test("canTransition: claimed → approved forbidden (must submit first)", () => {
  assert.equal(me.canTransition(me.STATUS_CLAIMED, me.STATUS_APPROVED), false);
});

test("canTransition: submitted → approved/rejected/expired allowed", () => {
  assert.equal(me.canTransition(me.STATUS_SUBMITTED, me.STATUS_APPROVED), true);
  assert.equal(me.canTransition(me.STATUS_SUBMITTED, me.STATUS_REJECTED), true);
  assert.equal(me.canTransition(me.STATUS_SUBMITTED, me.STATUS_EXPIRED),  true);
});

test("canTransition: terminal states never transition", () => {
  for (const term of [me.STATUS_APPROVED, me.STATUS_REJECTED, me.STATUS_EXPIRED, me.STATUS_ABORTED]) {
    assert.equal(me.canTransition(term, me.STATUS_OPEN), false);
    assert.equal(me.canTransition(term, me.STATUS_CLAIMED), false);
  }
});

test("canTransition: rejected can't go back to open in v1", () => {
  // The simpler v1 design ends the mission on reject (refund poster).
  // If we ever change to "reject means re-open for next claimant" this
  // assertion goes red — intentional anchor.
  assert.equal(me.canTransition(me.STATUS_REJECTED, me.STATUS_OPEN), false);
});

test("stableStringify: key order does not affect output", () => {
  const a = me.stableStringify({ b: 1, a: 2 });
  const b = me.stableStringify({ a: 2, b: 1 });
  assert.equal(a, b);
});

test("stableStringify: nested objects sorted recursively", () => {
  const a = me.stableStringify({ outer: { z: 1, a: 2 } });
  const b = me.stableStringify({ outer: { a: 2, z: 1 } });
  assert.equal(a, b);
  assert.equal(a, '{"outer":{"a":2,"z":1}}');
});

test("stableStringify: arrays preserve order", () => {
  const a = me.stableStringify([3, 1, 2]);
  assert.equal(a, "[3,1,2]");
});

test("hashPayload: same payload → same hash regardless of key order", () => {
  const h1 = me.hashPayload({ b: 1, a: { y: 2, x: 1 } });
  const h2 = me.hashPayload({ a: { x: 1, y: 2 }, b: 1 });
  assert.equal(h1, h2);
});

test("hashPayload: different payloads → different hashes", () => {
  assert.notEqual(me.hashPayload({ a: 1 }), me.hashPayload({ a: 2 }));
});

test("hashPayload: returns 64-char hex string", () => {
  const h = me.hashPayload({ x: 1 });
  assert.match(h, /^[0-9a-f]{64}$/);
});
