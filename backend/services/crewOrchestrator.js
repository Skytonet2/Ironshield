// backend/services/crewOrchestrator.js
//
// Phase 10 — Agent Economy: sequential crew runtime.
//
// Given a mission and an ordered list of (skill_id, role) steps, walk
// them in order: gate each step through authEngine, append a hash-
// chained entry to the mission audit log, and execute the skill via
// the existing in-process registry. No DAG yet — the Wallet Watch Kit
// only needs single-track sequential, and adding parallelism before
// we have a real second consumer is premature.
//
// ── Six-role taxonomy ────────────────────────────────────────────────
// Every step in a crew is tagged with exactly one role. The roles are
// fixed and the orchestrator refuses anything outside this set. A
// skill manifest is bound to a role via the skill_runtime_manifests
// `category` column — the runtime checks the manifest's category
// equals the role declared in the step. This keeps the manifest catalog
// self-classifying (you can list all "verifier" skills with a single
// query) while still letting the same skill appear in multiple roles
// across different versions.
//
// ── Action gating ────────────────────────────────────────────────────
// Each role maps to a default authEngine action_type (see
// ROLE_DEFAULT_ACTION). The default is the most-restrictive sensible
// gate for that role — `executor` always tries to sign_tx so it always
// escalates; `scout` reads data so it auto-passes. Callers can override
// the action_type per step (e.g. an outreach step that's a mass DM
// passes recipient_count so the threshold rule fires).
//
// ── Idempotency ──────────────────────────────────────────────────────
// Tier 1.3 does NOT auto-resume a partially-run crew. If the caller
// invokes runCrew on a mission that already has audit-log entries, the
// new entries are simply appended after them. Resume logic is a Tier 2
// concern; for now the surface is "one crew run = one runCrew call."

const missionEngine = require("./missionEngine");
const authEngine    = require("./authEngine");
const skillManifests = require("./skillManifests");
const skills        = require("./skills");

// ─── Six-role enum ───────────────────────────────────────────────────
const ROLE_SCOUT      = "scout";
const ROLE_OUTREACH   = "outreach";
const ROLE_NEGOTIATOR = "negotiator";
const ROLE_VERIFIER   = "verifier";
const ROLE_EXECUTOR   = "executor";
const ROLE_REPORTER   = "reporter";

const ROLES = Object.freeze([
  ROLE_SCOUT, ROLE_OUTREACH, ROLE_NEGOTIATOR,
  ROLE_VERIFIER, ROLE_EXECUTOR, ROLE_REPORTER,
]);

const ROLE_SET = new Set(ROLES);

/** Default authEngine action_type per role. Pick the most-restrictive
 *  sensible gate for each role so a misconfigured caller errs on the
 *  side of escalating, not auto-passing. */
const ROLE_DEFAULT_ACTION = Object.freeze({
  [ROLE_SCOUT]:      "share_data",
  [ROLE_OUTREACH]:   "send_message",
  [ROLE_NEGOTIATOR]: "final_terms",
  [ROLE_VERIFIER]:   "share_data",
  [ROLE_EXECUTOR]:   "sign_tx",
  [ROLE_REPORTER]:   "public_post",
});

function isValidRole(role) {
  return ROLE_SET.has(role);
}

function defaultActionForRole(role) {
  if (!isValidRole(role)) throw new Error(`Unknown role: ${role}`);
  return ROLE_DEFAULT_ACTION[role];
}

// ─── Pure planning ───────────────────────────────────────────────────

/** Validate a step input shape. Throws on bad data. Pure — exported
 *  for testing. Returns the normalised step. */
function validateStep(step, index) {
  if (!step || typeof step !== "object") {
    throw new Error(`step[${index}] must be an object`);
  }
  if (!Number.isInteger(step.skill_id) || step.skill_id < 0) {
    throw new Error(`step[${index}].skill_id must be a non-negative integer`);
  }
  if (!isValidRole(step.role)) {
    throw new Error(`step[${index}].role "${step.role}" not in {${ROLES.join(", ")}}`);
  }
  // Per-step action_type override is optional. Anything else
  // (params, payload) is forwarded to the skill verbatim.
  if (step.action_type !== undefined && typeof step.action_type !== "string") {
    throw new Error(`step[${index}].action_type must be a string when provided`);
  }
  return {
    skill_id:    step.skill_id,
    role:        step.role,
    action_type: step.action_type || defaultActionForRole(step.role),
    params:      step.params  || {},
    payload:     step.payload || null,
  };
}

/** Build the action object that authEngine.check consumes for one
 *  step. Caller can supply per-step `payload` to pass thresholdable
 *  fields (amount, recipient_count, data_sensitivity, summary). Pure —
 *  exported for testing. */
function buildAuthAction(step) {
  const action = { action_type: step.action_type };
  if (step.payload && typeof step.payload === "object") {
    if (step.payload.amount          != null) action.amount = step.payload.amount;
    if (step.payload.recipient_count != null) action.recipient_count = step.payload.recipient_count;
    if (step.payload.data_sensitivity != null) action.data_sensitivity = step.payload.data_sensitivity;
    if (step.payload.summary)                 action.summary = step.payload.summary;
    action.payload = step.payload;
  }
  return action;
}

// ─── Orchestration ───────────────────────────────────────────────────

/** Resolve a planned step's executable surface. Returns the active
 *  manifest plus the on-chain skill metadata category required by the
 *  skills runtime. Throws if the manifest is missing or its declared
 *  role doesn't match the step's role.
 *
 *  Note: skill_runtime_manifests.category is the *role* classifier
 *  (one of ROLES). The on-chain Skill row's category — what
 *  skills.classifyCategory expects ("builtin:<id>" or "http:<url>") —
 *  is sourced separately and passed in as `runtime_category` in the
 *  manifest body's tool_manifest or a sibling field. For Tier 1.3 we
 *  expect the caller to pass a `runtime_category` per step OR fall
 *  back to the manifest's tool_manifest[0].category if present. */
async function resolveStep(step, deps) {
  const sm = deps.skillManifests || skillManifests;
  const manifest = await sm.getActiveManifest(step.skill_id);
  if (!manifest) {
    throw new Error(`No active manifest for skill_id=${step.skill_id}`);
  }
  if (manifest.category !== step.role) {
    throw new Error(
      `skill_id=${step.skill_id} manifest.category="${manifest.category}" does not match step.role="${step.role}"`,
    );
  }
  // Caller can override; manifest can hint via tool_manifest[0].category.
  const runtime_category =
    step.runtime_category ||
    manifest.tool_manifest?.[0]?.runtime_category ||
    null;
  return { manifest, runtime_category };
}

/** Walk a list of validated steps in order. Per step:
 *    1. authEngine.check → policy
 *    2. require_approval → freeze, append audit step (frozen marker),
 *       stop the run, return frozen result
 *    3. auto/notify → run skill (if runtime_category resolved),
 *       append audit step, continue
 *
 *  Returns:
 *    { mission_id, status: 'completed' | 'frozen' | 'failed',
 *      steps: [{ ...step, policy, audit_step, result?, error? }],
 *      frozen_at: { step_index, escalation_id, channel } | null,
 *      audit_root: <last payload_hash> | null }
 *
 *  All of authEngine, missionEngine, skills, skillManifests are
 *  injectable via `deps` so the run can be unit-tested without
 *  Postgres or NEAR. Production caller passes none of them. */
async function runCrew({
  mission_id,
  steps,
  dispatchEscalation,
  deps = {},
}) {
  if (mission_id == null) throw new Error("mission_id required");
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error("steps must be a non-empty array");
  }

  const me   = deps.missionEngine || missionEngine;
  const ae   = deps.authEngine    || authEngine;
  const sk   = deps.skills        || skills;

  const mission = await me.getMission(mission_id);
  if (!mission) throw new Error(`Mission ${mission_id} not found`);

  // Validate every step up front — never start a run we know will
  // bail mid-stream.
  const planned = steps.map(validateStep);

  const result = {
    mission_id,
    status: "completed",
    steps: [],
    frozen_at: null,
    audit_root: null,
  };

  for (let i = 0; i < planned.length; i += 1) {
    const step = planned[i];
    const stepRecord = { ...step, policy: null, audit_step: null };

    let resolved;
    try {
      resolved = await resolveStep(step, deps);
    } catch (e) {
      stepRecord.error = e.message;
      result.steps.push(stepRecord);
      result.status = "failed";
      return result;
    }

    // Auth gate. ctx mirrors what other authEngine callers pass:
    // user_wallet (poster), agent_owner_wallet (claimant),
    // mission_on_chain_id, step_seq.
    const ctx = {
      user_wallet:         mission.poster_wallet,
      agent_owner_wallet:  mission.claimant_wallet || null,
      mission_on_chain_id: mission_id,
      step_seq:            i + 1,
    };
    const action = buildAuthAction(step);

    let verdict;
    try {
      verdict = await ae.check({ action, ctx, dispatchEscalation });
    } catch (e) {
      stepRecord.error = `authEngine.check failed: ${e.message}`;
      result.steps.push(stepRecord);
      result.status = "failed";
      return result;
    }
    stepRecord.policy = verdict.policy;

    if (verdict.policy === ae.POLICY_REQUIRE_APPROVAL) {
      // Freeze the crew here. The audit log records that the step was
      // gated; resume happens via a separate call once the escalation
      // resolves (Tier 2).
      const audit_step = await me.appendAuditStep({
        mission_on_chain_id: mission_id,
        skill_id:            step.skill_id,
        role:                step.role,
        action_type:         "step.frozen",
        payload: {
          step_index:    i,
          policy:        verdict.policy,
          escalation_id: verdict.escalationId,
          channel:       verdict.channel,
        },
        agent_wallet: mission.claimant_wallet || null,
      });
      stepRecord.audit_step = audit_step;
      result.steps.push(stepRecord);
      result.frozen_at = {
        step_index:    i,
        escalation_id: verdict.escalationId,
        channel:       verdict.channel,
      };
      result.status     = "frozen";
      result.audit_root = audit_step.payload_hash;
      return result;
    }

    // auto or notify — proceed. Notify already wrote an escalation row;
    // we don't block on it, just record that we proceeded.
    //
    // Optional pre-run hook (Tier 5 — Kit DSL): callers that want
    // per-step output threading (e.g. scout result → negotiator
    // params) supply a `resolveStepParams({ step, priorResults, index })`
    // callback in deps. The hook returns the final params to forward to
    // the skill runtime; default behaviour is the planned step.params
    // unchanged. Pure ad-hoc /run-crew callers don't need this.
    let runResult = null;
    let runError  = null;
    let effectiveParams = step.params;
    if (typeof deps.resolveStepParams === "function") {
      try {
        effectiveParams = await deps.resolveStepParams({
          step,
          priorResults: result.steps.map((s) => s.result),
          index: i,
        }) || step.params;
      } catch (e) {
        runError = `resolveStepParams failed: ${e.message}`;
      }
    }
    if (resolved.runtime_category && !runError) {
      try {
        runResult = await sk.runByCategory({
          category: resolved.runtime_category,
          ctx: {
            owner:          mission.poster_wallet,
            agent_account:  mission.claimant_wallet || null,
            params:         effectiveParams,
            mission_id,
          },
          // Built-ins bypass; HTTP requires admin verification — for
          // Tier 1.3 we only run built-ins, so verified=false is fine.
          verified: false,
        });
      } catch (e) {
        runError = e.message;
      }
    }

    const audit_step = await me.appendAuditStep({
      mission_on_chain_id: mission_id,
      skill_id:            step.skill_id,
      role:                step.role,
      action_type:         step.action_type,
      payload: {
        step_index:        i,
        policy:            verdict.policy,
        runtime_category:  resolved.runtime_category,
        params:            effectiveParams,           // post-resolution view of what ran
        ...(effectiveParams !== step.params ? { params_planned: step.params } : {}),
        result:            runResult,
        ...(runError ? { error: runError } : {}),
      },
      agent_wallet: mission.claimant_wallet || null,
    });
    stepRecord.audit_step = audit_step;
    if (runResult != null) stepRecord.result = runResult;
    if (runError)          stepRecord.error  = runError;
    result.steps.push(stepRecord);
    result.audit_root = audit_step.payload_hash;

    if (runError) {
      // A skill execution failure halts the crew so a downstream step
      // doesn't operate on stale assumptions. Same idea as freezing.
      result.status = "failed";
      return result;
    }
  }

  return result;
}

module.exports = {
  ROLES,
  ROLE_SCOUT,
  ROLE_OUTREACH,
  ROLE_NEGOTIATOR,
  ROLE_VERIFIER,
  ROLE_EXECUTOR,
  ROLE_REPORTER,
  ROLE_DEFAULT_ACTION,
  isValidRole,
  defaultActionForRole,
  validateStep,
  buildAuthAction,
  resolveStep,
  runCrew,
};
