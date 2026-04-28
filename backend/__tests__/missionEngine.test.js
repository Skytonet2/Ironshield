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

// mirrorEvent's allowSkip option is load-bearing for the indexer's
// catch-up path: when the bot has been offline and on-chain state has
// jumped past one or more intermediate steps, the indexer must be able
// to overwrite the mirror in one call. The HTTP /mirror route does NOT
// pass allowSkip, so the strict guard still protects route-side state.
test("mirrorEvent: allowSkip bypasses the canTransition guard", async () => {
  // Stand up a one-shot fake db that returns a fixed current row.
  const realCache = require.cache[clientPath].exports;
  let updateCalled = false;
  require.cache[clientPath].exports = {
    ...realCache,
    query: async (sql, params) => {
      if (/^\s*SELECT/i.test(sql)) {
        return { rows: [{
          on_chain_id: 1, status: "open", claimant_wallet: null,
          audit_root: null, claimed_at: null, submitted_at: null,
          review_deadline: null, finalized_at: null,
        }] };
      }
      if (/^\s*UPDATE/i.test(sql)) {
        updateCalled = true;
        return { rows: [{ on_chain_id: 1, status: params[1] || "approved" }] };
      }
      return { rows: [] };
    },
  };
  // Re-require missionEngine fresh so the test sees the swapped client.
  delete require.cache[require.resolve("../services/missionEngine")];
  const fresh = require("../services/missionEngine");

  // Without allowSkip — open → approved is illegal in v1.
  await assert.rejects(
    fresh.mirrorEvent({ on_chain_id: 1, status: "approved" }),
    /Illegal transition/,
  );
  // With allowSkip — same call succeeds.
  const out = await fresh.mirrorEvent({ on_chain_id: 1, status: "approved" }, { allowSkip: true });
  assert.equal(out.status, "approved");
  assert.equal(updateCalled, true);

  // Restore the original mock so later tests in the file see the same shape.
  require.cache[clientPath].exports = realCache;
  delete require.cache[require.resolve("../services/missionEngine")];
});
