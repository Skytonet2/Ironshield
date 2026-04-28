// backend/__tests__/missionIndexer.test.js
//
// Unit tests for the mission indexer's pure helpers:
//   nsToIso         — block-timestamp (u64 ns) → ISO string
//   toCreatedRecord — on-chain Mission → recordCreatedFromChain shape
//   toMirrorEvent   — on-chain Mission → mirrorEvent input shape
//   planReconcile   — decision: noop / create / mirror
//
// pollOnce is integration-tested via the live RPC in staging — these
// tests cover the value-mapping logic that's most likely to drift.

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

const idx = require("../services/missionIndexer");

// A representative on-chain mission. NEAR's serde may emit u64 as
// number or string; `created_at` here is the kind of value the contract
// returns (nanoseconds since unix epoch). Mid-2026 ≈ 1.78e18 ns.
const NS_2026_05 = 1_777_000_000_000_000_000n;
const ISO_2026_05 = new Date(Number(NS_2026_05 / 1_000_000n)).toISOString();

const openMission = {
  id: 7,
  poster: "alice.near",
  claimant: null,
  template_id: "wallet-watch-v1",
  kit_slug: "wallet_watch",
  inputs_hash: "deadbeef",
  escrow_yocto: "1000000000000000000000000",
  platform_fee_bps: 500,
  status: "open",
  audit_root: null,
  created_at: NS_2026_05.toString(),
  claimed_at: null,
  submitted_at: null,
  review_deadline_ns: null,
  // The contract reuses finalized_at to stash the review window in ns
  // while status is "open". Indexer must NOT treat this as a terminal
  // timestamp.
  finalized_at: (60n * 60n * 24n * 7n * 1_000_000_000n).toString(),
};

const approvedMission = {
  ...openMission,
  id: 9,
  claimant: "bob.near",
  status: "approved",
  audit_root: "abc123",
  claimed_at: NS_2026_05.toString(),
  submitted_at: NS_2026_05.toString(),
  review_deadline_ns: (NS_2026_05 + 3600n * 1_000_000_000n).toString(),
  finalized_at: NS_2026_05.toString(),
};

test("nsToIso: null/0/undefined → null", () => {
  assert.equal(idx.nsToIso(null), null);
  assert.equal(idx.nsToIso(undefined), null);
  assert.equal(idx.nsToIso(0), null);
  assert.equal(idx.nsToIso("0"), null);
});

test("nsToIso: accepts both number and string ns inputs", () => {
  const fromString = idx.nsToIso(NS_2026_05.toString());
  const fromNumber = idx.nsToIso(Number(NS_2026_05));
  assert.equal(fromString, ISO_2026_05);
  assert.equal(fromNumber, ISO_2026_05);
});

test("nsToIso: malformed input → null (no throw)", () => {
  assert.equal(idx.nsToIso("not-a-number"), null);
});

test("toCreatedRecord: open mission — finalized_at is suppressed (window-storage hack)", () => {
  const r = idx.toCreatedRecord(openMission);
  assert.equal(r.on_chain_id, 7);
  assert.equal(r.poster_wallet, "alice.near");
  assert.equal(r.kit_slug, "wallet_watch");
  assert.equal(r.inputs_hash, "deadbeef");
  assert.equal(r.escrow_yocto, "1000000000000000000000000");
  assert.equal(r.platform_fee_bps, 500);
  assert.equal(r.status, "open");
  assert.equal(r.claimant_wallet, null);
  assert.equal(r.audit_root, null);
  assert.equal(r.created_at, ISO_2026_05);
  assert.equal(r.claimed_at, null);
  assert.equal(r.submitted_at, null);
  assert.equal(r.review_deadline, null);
  // Critical: open-state finalized_at is the review window in ns, NOT
  // a real timestamp. Must be null in the mirror.
  assert.equal(r.finalized_at, null);
});

test("toCreatedRecord: approved mission — finalized_at is honoured", () => {
  const r = idx.toCreatedRecord(approvedMission);
  assert.equal(r.status, "approved");
  assert.equal(r.claimant_wallet, "bob.near");
  assert.equal(r.audit_root, "abc123");
  assert.equal(r.finalized_at, ISO_2026_05);
  assert.equal(r.claimed_at, ISO_2026_05);
  assert.equal(r.submitted_at, ISO_2026_05);
});

test("toCreatedRecord: template_slug stays null (on-chain template_id ≠ slug)", () => {
  const r = idx.toCreatedRecord(openMission);
  // template_id "wallet-watch-v1" must NOT be coerced into template_slug —
  // the column has a FK to mission_templates(slug) and a wrong slug
  // would 23503 the insert.
  assert.equal(r.template_slug, null);
});

test("toMirrorEvent: terminal mission carries finalized_at, open does not", () => {
  assert.equal(idx.toMirrorEvent(openMission).finalized_at, null);
  assert.equal(idx.toMirrorEvent(approvedMission).finalized_at, ISO_2026_05);
});

test("toMirrorEvent: includes only fields mirrorEvent consumes", () => {
  const e = idx.toMirrorEvent(approvedMission);
  // mirrorEvent's writable surface in missionEngine.js
  const allowed = new Set([
    "on_chain_id", "status", "claimant_wallet", "audit_root",
    "tx_finalize", "claimed_at", "submitted_at", "review_deadline",
    "finalized_at",
  ]);
  for (const k of Object.keys(e)) {
    assert.ok(allowed.has(k), `unexpected field "${k}" in toMirrorEvent output`);
  }
});

test("planReconcile: no DB row → create", () => {
  const plan = idx.planReconcile(openMission, null);
  assert.equal(plan.kind, "create");
  assert.equal(plan.record.on_chain_id, 7);
});

test("planReconcile: status matches → noop", () => {
  const dbRow = { on_chain_id: 7, status: "open" };
  const plan = idx.planReconcile(openMission, dbRow);
  assert.equal(plan.kind, "noop");
});

test("planReconcile: status diverges → mirror", () => {
  const dbRow = { on_chain_id: 9, status: "submitted" };
  const plan = idx.planReconcile(approvedMission, dbRow);
  assert.equal(plan.kind, "mirror");
  assert.equal(plan.event.status, "approved");
  assert.equal(plan.event.claimant_wallet, "bob.near");
});

test("planReconcile: catch-up jump (open → approved) is a single mirror plan", () => {
  // Indexer offline: DB is at "open" but on-chain has terminated. The
  // planner emits one mirror call; the indexer passes allowSkip:true to
  // mirrorEvent so the canTransition guard doesn't reject the jump.
  const dbRow = { on_chain_id: 9, status: "open" };
  const plan = idx.planReconcile(approvedMission, dbRow);
  assert.equal(plan.kind, "mirror");
  assert.equal(plan.event.status, "approved");
});
