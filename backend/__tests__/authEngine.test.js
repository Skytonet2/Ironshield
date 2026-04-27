// backend/__tests__/authEngine.test.js
//
// Pure unit tests for the auth engine's rule evaluator + threshold
// matcher. No DB — these only exercise the in-process functions.

const test = require("node:test");
const assert = require("node:assert/strict");

// Hijack db/client require so importing authEngine doesn't try to
// connect to Postgres. evaluateRules and thresholdMet don't touch
// the DB; we just need the module to load.
const path = require("node:path");
const clientPath = path.resolve(__dirname, "..", "db", "client.js");
require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true,
  exports: {
    query: async () => ({ rows: [] }),
    transaction: async () => null,
    pool: { connect: async () => ({ release: () => {} }) },
  },
};

const authEngine = require("../services/authEngine");

test("thresholdMet: empty threshold always matches", () => {
  assert.equal(authEngine.thresholdMet(undefined, { action_type: "x" }), true);
  assert.equal(authEngine.thresholdMet({}, { action_type: "x" }), true);
});

test("thresholdMet: amount comparison", () => {
  assert.equal(authEngine.thresholdMet({ amount: 100 }, { amount: 99 }), false);
  assert.equal(authEngine.thresholdMet({ amount: 100 }, { amount: 100 }), true);
  assert.equal(authEngine.thresholdMet({ amount: 100 }, { amount: 101 }), true);
  // Missing field on action fails the match.
  assert.equal(authEngine.thresholdMet({ amount: 100 }, {}), false);
});

test("thresholdMet: recipient_count comparison", () => {
  assert.equal(authEngine.thresholdMet({ recipient_count: 5 }, { recipient_count: 4 }), false);
  assert.equal(authEngine.thresholdMet({ recipient_count: 5 }, { recipient_count: 5 }), true);
});

test("evaluateRules: unknown action_type throws", () => {
  assert.throws(() => authEngine.evaluateRules([], { action_type: "drink_coffee" }), /Unknown action_type/);
});

test("evaluateRules: system default for commit_funds is require_approval", () => {
  const v = authEngine.evaluateRules([], { action_type: "commit_funds", amount: 1 });
  assert.equal(v.policy, "require_approval");
});

test("evaluateRules: user override beats system default", () => {
  const rules = [{ action_type: "commit_funds", policy: "auto" }];
  const v = authEngine.evaluateRules(rules, { action_type: "commit_funds", amount: 1 });
  assert.equal(v.policy, "auto");
});

test("evaluateRules: send_message under recipient threshold falls through to system auto", () => {
  // System default for send_message has threshold {recipient_count: 5}; below
  // that threshold the system rule doesn't fire and the safest default (auto)
  // is returned.
  const v = authEngine.evaluateRules([], {
    action_type: "send_message", recipient_count: 1,
  });
  assert.equal(v.policy, "auto");
});

test("evaluateRules: send_message with 5+ recipients hits notify rule", () => {
  const v = authEngine.evaluateRules([], {
    action_type: "send_message", recipient_count: 10,
  });
  assert.equal(v.policy, "notify");
});

test("evaluateRules: meet_irl is always require_approval", () => {
  const v = authEngine.evaluateRules([], { action_type: "meet_irl" });
  assert.equal(v.policy, "require_approval");
});

test("evaluateRules: rules scanned in order — first match wins", () => {
  const rules = [
    { action_type: "send_message", threshold: { recipient_count: 100 }, policy: "require_approval" },
    { action_type: "send_message", threshold: { recipient_count: 5 },   policy: "notify" },
  ];
  // 50 recipients matches the 5-threshold notify rule (the require_approval
  // rule needs 100+ to fire).
  const v = authEngine.evaluateRules(rules, {
    action_type: "send_message", recipient_count: 50,
  });
  assert.equal(v.policy, "notify");

  // 200 recipients crosses both thresholds — first matching rule wins,
  // so the require_approval rule fires.
  const v2 = authEngine.evaluateRules(rules, {
    action_type: "send_message", recipient_count: 200,
  });
  assert.equal(v2.policy, "require_approval");
});

test("evaluateRules: rule with invalid policy is skipped", () => {
  const rules = [{ action_type: "commit_funds", policy: "drink_coffee" }];
  // Skipped rule → fall through to system default require_approval.
  const v = authEngine.evaluateRules(rules, { action_type: "commit_funds", amount: 1 });
  assert.equal(v.policy, "require_approval");
});

test("evaluateRules: share_data sensitivity threshold", () => {
  // sensitivity=1 below the system threshold of 2 → falls through to auto
  const v1 = authEngine.evaluateRules([], { action_type: "share_data", data_sensitivity: 1 });
  assert.equal(v1.policy, "auto");
  // sensitivity=2 hits the threshold
  const v2 = authEngine.evaluateRules([], { action_type: "share_data", data_sensitivity: 2 });
  assert.equal(v2.policy, "require_approval");
});

test("ACTION_TYPES contract is stable", () => {
  // If this list changes, contract callers need updating — keep the
  // assertion explicit so a silent rename is caught.
  assert.deepEqual(authEngine.ACTION_TYPES.slice().sort(), [
    "commit_funds", "final_terms", "meet_irl", "public_post",
    "send_message", "share_data", "sign_tx",
  ]);
});
