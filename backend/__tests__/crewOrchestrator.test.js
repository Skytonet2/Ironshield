// backend/__tests__/crewOrchestrator.test.js
//
// Tests for the sequential crew runtime. Pure helpers (validateStep,
// buildAuthAction, isValidRole, defaultActionForRole) are exercised
// directly. The end-to-end runCrew loop is exercised against in-memory
// fakes of missionEngine / authEngine / skillManifests / skills so the
// scheduling, gating, and audit-step recording are covered without
// Postgres or NEAR.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// Stub the db client before requiring anything that pulls it in.
const clientPath = path.resolve(__dirname, "..", "db", "client.js");
require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true,
  exports: {
    query: async () => ({ rows: [] }),
    transaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
    pool: { connect: async () => ({ release: () => {}, query: async () => ({ rows: [] }) }) },
  },
};

const co = require("../services/crewOrchestrator");

// ─── Pure helpers ────────────────────────────────────────────────────

test("ROLES contains exactly the six declared roles", () => {
  assert.deepEqual([...co.ROLES].sort(), [
    "executor", "negotiator", "outreach", "reporter", "scout", "verifier",
  ]);
});

test("isValidRole: accepts every declared role and rejects others", () => {
  for (const r of co.ROLES) assert.equal(co.isValidRole(r), true);
  for (const bad of ["", null, undefined, "scientist", "scout ", "Scout"]) {
    assert.equal(co.isValidRole(bad), false);
  }
});

test("defaultActionForRole: every role has a default in ACTION_TYPES", () => {
  // The set of action_types the authEngine accepts. Hard-coded here so
  // a typo in ROLE_DEFAULT_ACTION can't slip through.
  const ACTION_TYPES = new Set([
    "send_message", "commit_funds", "sign_tx", "share_data",
    "meet_irl", "final_terms", "public_post",
  ]);
  for (const r of co.ROLES) {
    assert.ok(ACTION_TYPES.has(co.defaultActionForRole(r)),
      `role ${r} default ${co.defaultActionForRole(r)} not a valid action_type`);
  }
});

test("defaultActionForRole: throws on unknown role", () => {
  assert.throws(() => co.defaultActionForRole("scientist"), /Unknown role/);
});

test("validateStep: accepts the minimum valid step", () => {
  const out = co.validateStep({ skill_id: 1, role: "scout" }, 0);
  assert.equal(out.skill_id, 1);
  assert.equal(out.role, "scout");
  assert.equal(out.action_type, "share_data");
  assert.deepEqual(out.params, {});
});

test("validateStep: per-step action_type override is preserved", () => {
  const out = co.validateStep(
    { skill_id: 1, role: "outreach", action_type: "share_data" },
    0,
  );
  assert.equal(out.action_type, "share_data");
});

test("validateStep: rejects bad role", () => {
  assert.throws(
    () => co.validateStep({ skill_id: 1, role: "scientist" }, 2),
    /step\[2\].role "scientist" not in/,
  );
});

test("validateStep: rejects non-integer skill_id", () => {
  assert.throws(
    () => co.validateStep({ skill_id: "1", role: "scout" }, 0),
    /skill_id must be a non-negative integer/,
  );
});

test("validateStep: rejects null/undefined step", () => {
  assert.throws(() => co.validateStep(null, 0), /step\[0\] must be an object/);
});

test("buildAuthAction: copies thresholdable fields from payload", () => {
  const action = co.buildAuthAction({
    action_type: "send_message",
    payload: { recipient_count: 12, summary: "blast" },
  });
  assert.equal(action.action_type, "send_message");
  assert.equal(action.recipient_count, 12);
  assert.equal(action.summary, "blast");
  assert.deepEqual(action.payload, { recipient_count: 12, summary: "blast" });
});

test("buildAuthAction: bare step (no payload) just carries action_type", () => {
  const action = co.buildAuthAction({ action_type: "share_data" });
  assert.deepEqual(Object.keys(action), ["action_type"]);
});

// ─── End-to-end runCrew with fakes ───────────────────────────────────

function makeDeps({
  mission = { on_chain_id: 1, poster_wallet: "alice.near", claimant_wallet: "bob.near", status: "claimed" },
  manifests = {},                  // { [skill_id]: { category, tool_manifest } }
  authVerdicts = [],               // sequential list of verdicts
  skillResults = {},               // { [runtime_category]: result }
  skillThrows = {},                // { [runtime_category]: errorMessage }
} = {}) {
  let auditSeq = 0;
  const auditLog = [];
  const calls = { authChecks: [], skillRuns: [], audit: [] };
  const verdicts = [...authVerdicts];

  const fakes = {
    missionEngine: {
      getMission: async (id) => (id === mission.on_chain_id ? mission : null),
      appendAuditStep: async (entry) => {
        auditSeq += 1;
        const row = {
          id: auditSeq,
          step_seq: auditSeq,
          payload_hash: `hash-${auditSeq}`,
          ...entry,
        };
        calls.audit.push(row);
        auditLog.push(row);
        return row;
      },
    },
    authEngine: {
      POLICY_AUTO:             "auto",
      POLICY_NOTIFY:           "notify",
      POLICY_REQUIRE_APPROVAL: "require_approval",
      check: async ({ action, ctx }) => {
        calls.authChecks.push({ action, ctx });
        if (verdicts.length === 0) return { policy: "auto" };
        return verdicts.shift();
      },
    },
    skillManifests: {
      getActiveManifest: async (skill_id) => manifests[skill_id] || null,
    },
    skills: {
      runByCategory: async ({ category, ctx }) => {
        calls.skillRuns.push({ category, ctx });
        if (skillThrows[category]) throw new Error(skillThrows[category]);
        return skillResults[category] ?? { ok: true };
      },
    },
  };
  return { deps: fakes, calls, auditLog };
}

test("runCrew: rejects unknown mission_id", async () => {
  const { deps } = makeDeps();
  await assert.rejects(
    co.runCrew({
      mission_id: 999,
      steps: [{ skill_id: 1, role: "scout" }],
      deps,
    }),
    /Mission 999 not found/,
  );
});

test("runCrew: rejects empty steps array", async () => {
  const { deps } = makeDeps();
  await assert.rejects(
    co.runCrew({ mission_id: 1, steps: [], deps }),
    /steps must be a non-empty array/,
  );
});

test("runCrew: errors out cleanly when manifest missing", async () => {
  const { deps } = makeDeps({ manifests: {} });
  const out = await co.runCrew({
    mission_id: 1,
    steps: [{ skill_id: 7, role: "scout" }],
    deps,
  });
  assert.equal(out.status, "failed");
  assert.match(out.steps[0].error, /No active manifest for skill_id=7/);
});

test("runCrew: errors out when manifest.category disagrees with step.role", async () => {
  const { deps } = makeDeps({
    manifests: { 7: { category: "outreach", tool_manifest: [] } },
  });
  const out = await co.runCrew({
    mission_id: 1,
    steps: [{ skill_id: 7, role: "scout" }],
    deps,
  });
  assert.equal(out.status, "failed");
  assert.match(out.steps[0].error, /does not match step\.role="scout"/);
});

test("runCrew: auto policy walks the full crew, appending audit per step", async () => {
  const { deps, calls } = makeDeps({
    manifests: {
      1: { category: "scout",     tool_manifest: [{ runtime_category: "builtin:airdrop_scan" }] },
      2: { category: "verifier",  tool_manifest: [{ runtime_category: "builtin:summarise_url" }] },
    },
    authVerdicts: [
      { policy: "auto" },
      { policy: "auto" },
    ],
    skillResults: {
      "builtin:airdrop_scan":   { found: 3 },
      "builtin:summarise_url":  { ok: true, summary: "..." },
    },
  });
  const out = await co.runCrew({
    mission_id: 1,
    steps: [
      { skill_id: 1, role: "scout" },
      { skill_id: 2, role: "verifier" },
    ],
    deps,
  });
  assert.equal(out.status, "completed");
  assert.equal(out.steps.length, 2);
  assert.equal(out.frozen_at, null);
  assert.equal(calls.skillRuns.length, 2);
  assert.equal(calls.audit.length, 2);
  // step_seq is monotonic from the audit log
  assert.equal(calls.audit[0].step_seq, 1);
  assert.equal(calls.audit[1].step_seq, 2);
  // policy is recorded on every audit row
  assert.equal(calls.audit[0].action_type, "share_data");
  assert.equal(calls.audit[1].action_type, "share_data");
  assert.equal(out.audit_root, "hash-2");
});

test("runCrew: require_approval freezes the crew at that step", async () => {
  const { deps, calls } = makeDeps({
    manifests: {
      1: { category: "scout",    tool_manifest: [{ runtime_category: "builtin:airdrop_scan" }] },
      2: { category: "executor", tool_manifest: [{ runtime_category: "builtin:airdrop_scan" }] },
      3: { category: "reporter", tool_manifest: [{ runtime_category: "builtin:airdrop_scan" }] },
    },
    authVerdicts: [
      { policy: "auto" },
      { policy: "require_approval", escalationId: 42, channel: "tg" },
      // would-be 3rd verdict — must NOT be consumed
    ],
  });
  const out = await co.runCrew({
    mission_id: 1,
    steps: [
      { skill_id: 1, role: "scout" },
      { skill_id: 2, role: "executor" },
      { skill_id: 3, role: "reporter" },
    ],
    deps,
  });
  assert.equal(out.status, "frozen");
  assert.equal(out.steps.length, 2);
  assert.deepEqual(out.frozen_at, { step_index: 1, escalation_id: 42, channel: "tg" });
  // Only the first (scout) step should have actually run a skill —
  // executor was frozen before invocation.
  assert.equal(calls.skillRuns.length, 1);
  // Two audit entries: scout's regular step + frozen marker for executor.
  assert.equal(calls.audit.length, 2);
  assert.equal(calls.audit[1].action_type, "step.frozen");
  assert.equal(calls.audit[1].payload.escalation_id, 42);
});

test("runCrew: skill execution error halts the crew with status=failed", async () => {
  const { deps, calls } = makeDeps({
    manifests: {
      1: { category: "scout",    tool_manifest: [{ runtime_category: "builtin:airdrop_scan" }] },
      2: { category: "verifier", tool_manifest: [{ runtime_category: "builtin:bogus" }] },
    },
    authVerdicts: [{ policy: "auto" }, { policy: "auto" }],
    skillThrows: { "builtin:bogus": "kaboom" },
  });
  const out = await co.runCrew({
    mission_id: 1,
    steps: [
      { skill_id: 1, role: "scout" },
      { skill_id: 2, role: "verifier" },
    ],
    deps,
  });
  assert.equal(out.status, "failed");
  assert.equal(out.steps.length, 2);
  assert.equal(out.steps[1].error, "kaboom");
  // Audit row for the failed step still gets written so the chain
  // captures the failure — the next step (if any) doesn't run.
  assert.equal(calls.audit.length, 2);
  assert.equal(calls.audit[1].payload.error, "kaboom");
});

test("runCrew: forwards dispatchEscalation to authEngine.check", async () => {
  // The dispatch hook is the production wiring point — confirm it
  // makes it through. We don't actually assert the dispatcher fires,
  // just that authEngine.check sees it.
  const { deps } = makeDeps({
    manifests: { 1: { category: "scout", tool_manifest: [] } },
  });
  const dispatch = async () => {};
  // Wrap the fake check so we can capture the dispatchEscalation arg.
  const origCheck = deps.authEngine.check;
  let seen = null;
  deps.authEngine.check = async (args) => {
    seen = args.dispatchEscalation;
    return origCheck(args);
  };
  await co.runCrew({
    mission_id: 1,
    steps: [{ skill_id: 1, role: "scout" }],
    dispatchEscalation: dispatch,
    deps,
  });
  assert.equal(seen, dispatch);
});

test("runCrew: notify policy proceeds and is recorded in audit row", async () => {
  const { deps, calls } = makeDeps({
    manifests: { 1: { category: "outreach", tool_manifest: [{ runtime_category: "builtin:airdrop_scan" }] } },
    authVerdicts: [{ policy: "notify", escalationId: 7, channel: "in_app" }],
  });
  const out = await co.runCrew({
    mission_id: 1,
    steps: [{ skill_id: 1, role: "outreach" }],
    deps,
  });
  assert.equal(out.status, "completed");
  assert.equal(out.steps[0].policy, "notify");
  assert.equal(calls.skillRuns.length, 1);
  assert.equal(calls.audit[0].payload.policy, "notify");
});

test("runCrew: no runtime_category resolved → audit step recorded, skill not invoked", async () => {
  // A manifest with no runtime hint is metadata-only; the orchestrator
  // shouldn't pick a random skill module to invoke. Treat it as a
  // gated-and-noted step.
  const { deps, calls } = makeDeps({
    manifests: { 1: { category: "scout", tool_manifest: [] } },
    authVerdicts: [{ policy: "auto" }],
  });
  const out = await co.runCrew({
    mission_id: 1,
    steps: [{ skill_id: 1, role: "scout" }],
    deps,
  });
  assert.equal(out.status, "completed");
  assert.equal(calls.skillRuns.length, 0);
  assert.equal(calls.audit.length, 1);
  assert.equal(calls.audit[0].payload.runtime_category, null);
});
