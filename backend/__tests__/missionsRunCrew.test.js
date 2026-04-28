// backend/__tests__/missionsRunCrew.test.js
//
// Tests for the POST /api/missions/:id/run-crew route. The handler is
// exported as a named function so it's exercised directly with mocked
// req/res + injected deps — no Express server needed. A structural
// test also confirms the route is wallet-guarded by `requireWallet`.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// Stub db client before requiring anything that pulls it in.
const clientPath = path.resolve(__dirname, "..", "db", "client.js");
require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true,
  exports: {
    query: async () => ({ rows: [] }),
    transaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
    pool: { connect: async () => ({ release: () => {}, query: async () => ({ rows: [] }) }) },
  },
};

const router = require("../routes/missions.route");
const { runCrewHandler } = router;
const requireWallet = require("../middleware/requireWallet");

// ─── Tiny req/res helpers ────────────────────────────────────────────
function makeReq({ id = "1", wallet = "alice.near", body = {} } = {}) {
  return { params: { id }, wallet, body };
}
function makeRes() {
  const r = {
    statusCode: 200, body: null,
    status(c) { r.statusCode = c; return r; },
    json(b)   { r.body = b; return r; },
  };
  return r;
}

const baseMission = {
  on_chain_id: 1,
  poster_wallet: "alice.near",
  claimant_wallet: "bob.near",
  status: "claimed",
};

function makeDeps({
  mission = baseMission,
  runResult = { mission_id: 1, status: "completed", steps: [], frozen_at: null, audit_root: "h1" },
  runThrows = null,
} = {}) {
  const calls = { runCrew: [], dispatch: null };
  const dispatch = async () => {};
  return {
    calls,
    deps: {
      missionEngine: {
        getMission: async (id) => (Number(id) === Number(mission?.on_chain_id) ? mission : null),
      },
      crewOrchestrator: {
        runCrew: async (args) => {
          calls.runCrew.push(args);
          calls.dispatch = args.dispatchEscalation;
          if (runThrows) throw new Error(runThrows);
          return runResult;
        },
      },
      tgEscalation: { dispatch },
    },
    expectedDispatch: dispatch,
  };
}

// ─── Structural: route is wallet-guarded ─────────────────────────────

test("missions.route — POST /:id/run-crew is guarded by requireWallet", () => {
  const layer = router.stack.find(
    (l) => l.route?.path === "/:id/run-crew" && l.route?.methods?.post,
  );
  assert.ok(layer, "POST /:id/run-crew not registered");
  const guarded = layer.route.stack.some((l) => l.handle === requireWallet);
  assert.equal(guarded, true, "POST /:id/run-crew is missing requireWallet middleware");
});

// ─── Handler unit tests ──────────────────────────────────────────────

test("runCrewHandler: 400 when id is non-numeric", async () => {
  const { deps } = makeDeps();
  const res = makeRes();
  await runCrewHandler(makeReq({ id: "abc" }), res, deps);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /id must be numeric/);
});

test("runCrewHandler: 404 when mission absent", async () => {
  const { deps } = makeDeps({ mission: null });
  const res = makeRes();
  await runCrewHandler(makeReq({ id: "999" }), res, deps);
  assert.equal(res.statusCode, 404);
});

test("runCrewHandler: 403 when wallet is neither poster nor claimant", async () => {
  const { deps, calls } = makeDeps();
  const res = makeRes();
  await runCrewHandler(
    makeReq({ wallet: "eve.near", body: { steps: [{ skill_id: 1, role: "scout" }] } }),
    res,
    deps,
  );
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /Only poster or claimant/);
  assert.equal(calls.runCrew.length, 0, "runCrew should not run for unauthorised caller");
});

test("runCrewHandler: 403 wallet check is case-insensitive", async () => {
  const { deps } = makeDeps();
  const res = makeRes();
  await runCrewHandler(
    makeReq({
      wallet: "Alice.NEAR",                  // poster_wallet is "alice.near"
      body: { steps: [{ skill_id: 1, role: "scout" }] },
    }),
    res,
    deps,
  );
  assert.equal(res.statusCode, 200);
});

test("runCrewHandler: 400 when steps array is empty or missing", async () => {
  const { deps } = makeDeps();
  for (const body of [{}, { steps: [] }, { steps: "nope" }]) {
    const res = makeRes();
    await runCrewHandler(makeReq({ body }), res, deps);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /steps must be a non-empty array/);
  }
});

test("runCrewHandler: 200 with run summary on success", async () => {
  const { deps, calls, expectedDispatch } = makeDeps();
  const res = makeRes();
  await runCrewHandler(
    makeReq({
      wallet: "bob.near",                    // claimant
      body: { steps: [{ skill_id: 1, role: "scout" }] },
    }),
    res,
    deps,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.run.status, "completed");
  // Production wiring: tgEscalation.dispatch is what gets passed into
  // the orchestrator. Pinning this so an accidental rename doesn't
  // silently leave escalations un-dispatched.
  assert.equal(calls.dispatch, expectedDispatch);
});

test("runCrewHandler: 400 when crewOrchestrator.runCrew throws", async () => {
  const { deps } = makeDeps({ runThrows: "step[0].role \"bogus\" not in {...}" });
  const res = makeRes();
  await runCrewHandler(
    makeReq({ body: { steps: [{ skill_id: 1, role: "bogus" }] } }),
    res,
    deps,
  );
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /role/);
});

test("runCrewHandler: passes mission_id (numeric) and steps through unchanged", async () => {
  const { deps, calls } = makeDeps();
  const steps = [
    { skill_id: 7, role: "scout",    params: { x: 1 } },
    { skill_id: 9, role: "verifier", payload: { data_sensitivity: 2 } },
  ];
  await runCrewHandler(
    makeReq({ wallet: "alice.near", body: { steps } }),
    makeRes(),
    deps,
  );
  assert.equal(calls.runCrew.length, 1);
  assert.equal(calls.runCrew[0].mission_id, 1);
  assert.equal(typeof calls.runCrew[0].mission_id, "number");
  assert.deepEqual(calls.runCrew[0].steps, steps);
});

test("runCrewHandler: a `frozen` run summary still returns 200", async () => {
  const { deps } = makeDeps({
    runResult: {
      mission_id: 1,
      status: "frozen",
      steps: [{ skill_id: 1, role: "executor", policy: "require_approval" }],
      frozen_at: { step_index: 0, escalation_id: 42, channel: "tg" },
      audit_root: "h-frozen",
    },
  });
  const res = makeRes();
  await runCrewHandler(
    makeReq({ body: { steps: [{ skill_id: 1, role: "executor" }] } }),
    res,
    deps,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.run.status, "frozen");
  assert.equal(res.body.run.frozen_at.escalation_id, 42);
});
