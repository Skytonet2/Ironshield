// backend/services/kitRunner.js
//
// Bridge from "this mission targets Kit X" to crewOrchestrator's
// runCrew(steps[]) call. Tier 1's runtime expects steps to be picked
// by the agent owner; Tier 5 collapses that for Kit-driven missions
// by reading agent_kits.bundled_skill_ids and turning each on-chain
// Skill ID into a step with the right role + the deployment's preset
// params.
//
// Output threading between steps (e.g. scout → negotiator) is NOT
// done here — each step sees the same shared params plus the
// mission inputs_json. Skills self-select fields they care about.
// A future Kit DSL can declare per-step input mapping; for now the
// skills are written to take the union and ignore extras.

const fs                = require("node:fs");
const path              = require("node:path");
const db                = require("../db/client");
const missionEngine     = require("./missionEngine");
const crewOrchestrator  = require("./crewOrchestrator");
const skillManifests    = require("./skillManifests");
const kitParamResolver  = require("./kitParamResolver");
const tgEscalation      = (() => {
  try { return require("./tgEscalation"); } catch { return null; }
})();

const KIT_MANIFEST_DIR = path.join(__dirname, "..", "data", "kits");

/** Read the JSON manifest by slug if present on disk. The bulk-import
 *  CLI is the canonical source for on-chain Skill IDs, but the rich
 *  DSL (per-step param mappings) lives in the JSON file we shipped
 *  with the Kit. Returns null if the file isn't there — callers then
 *  fall back to the today-shape "shared params for every step." */
function readManifestFromDisk(slug) {
  if (!slug || /[^a-z0-9_-]/i.test(slug)) return null; // path-traversal guard
  const fp = path.join(KIT_MANIFEST_DIR, `${slug}.json`);
  try {
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

/** Plan a steps[] array for a Kit-driven mission. Pure — no DB writes,
 *  no orchestrator calls. Exported for unit-tests.
 *
 *  Two modes, picked automatically:
 *   1. DSL mode — the JSON manifest on disk has a `bundled_skills`
 *      array of step objects with per-step `params` (which can contain
 *      template strings like "$prev.items[0].title"). The templates
 *      are passed through verbatim here; `runKit` wires them to the
 *      crewOrchestrator's resolveStepParams hook for runtime substitution.
 *   2. Shared-params mode — no manifest on disk OR the entries are
 *      bare category strings. Every step gets the same merged
 *      preset+mission params and skills self-select fields. This is
 *      the original Tier-5 commit-5 behaviour, preserved for backwards
 *      compatibility.
 */
async function planSteps({ mission, kit, deployment, deps = {} }) {
  const sm = deps.skillManifests || skillManifests;
  const readManifest = deps.readManifestFromDisk || readManifestFromDisk;

  if (!mission)    throw new Error("planSteps: mission required");
  if (!kit)        throw new Error("planSteps: kit required");

  const ids = Array.isArray(kit.bundled_skill_ids) ? kit.bundled_skill_ids : [];
  if (ids.length === 0) {
    throw new Error(`planSteps: kit ${kit.slug} has no bundled_skill_ids — has Tier 1 bulk-import run?`);
  }

  const presets = deployment?.preset_config_json || {};
  const inputs  = mission.inputs_json || {};
  const sharedParams = { ...presets, ...inputs };

  // DSL: each entry in manifest.bundled_skills can be either a category
  // string (legacy) OR { skill: <category>, params: {...} } (DSL).
  const manifest = readManifest(kit.slug);
  const dslEntries = Array.isArray(manifest?.bundled_skills) ? manifest.bundled_skills : [];

  const steps = [];
  for (let i = 0; i < ids.length; i++) {
    const skill_id = Number(ids[i]);
    if (!Number.isFinite(skill_id)) {
      throw new Error(`planSteps: bundled_skill_ids[${i}] not a number`);
    }
    const skillManifest = await sm.getActiveManifest(skill_id);
    if (!skillManifest) {
      throw new Error(`planSteps: no active manifest for skill_id=${skill_id} (Kit ${kit.slug})`);
    }
    // Pick params: per-step DSL mapping when present; otherwise shared.
    const dsl = dslEntries[i];
    const dslParams = (dsl && typeof dsl === "object" && dsl.params) ? dsl.params : null;
    steps.push({
      skill_id,
      role:    skillManifest.category, // crewOrchestrator constraint
      params:  dslParams || sharedParams,
    });
  }
  return steps;
}

/** Look up the Kit + deployment rows backing a mission. */
async function loadKitContext(mission_id) {
  const mission = await missionEngine.getMission(mission_id);
  if (!mission) {
    const err = new Error(`mission ${mission_id} not found`);
    err.code = "MISSION_NOT_FOUND";
    throw err;
  }
  if (!mission.kit_slug) {
    const err = new Error(`mission ${mission_id} has no kit_slug — not a Kit-driven mission`);
    err.code = "MISSION_NOT_KIT";
    throw err;
  }
  const { rows: kitRows } = await db.query(
    "SELECT * FROM agent_kits WHERE slug = $1 LIMIT 1",
    [mission.kit_slug],
  );
  const kit = kitRows[0] || null;
  if (!kit) {
    const err = new Error(`kit ${mission.kit_slug} not in agent_kits — has Tier 1 bulk-import run?`);
    err.code = "KIT_NOT_FOUND";
    throw err;
  }
  // Latest deployment owned by the claimant. Multiple deployments per
  // (kit, owner) are allowed — pick the freshest.
  let deployment = null;
  if (mission.claimant_wallet) {
    const { rows: depRows } = await db.query(
      `SELECT * FROM kit_deployments
         WHERE kit_slug = $1 AND agent_owner_wallet = $2
         ORDER BY created_at DESC LIMIT 1`,
      [mission.kit_slug, mission.claimant_wallet],
    );
    deployment = depRows[0] || null;
  }
  return { mission, kit, deployment };
}

/** Public entry: load context, plan, run. Returns the runCrew result
 *  shape: { mission_id, status, steps[], frozen_at, audit_root }.
 *
 *  Wires the DSL param resolver into runCrew's optional
 *  `resolveStepParams` hook. The resolver closes over the mission +
 *  preset env so the orchestrator only has to pass priorResults per step.
 */
async function runKit({ mission_id, deps = {} }) {
  const { mission, kit, deployment } = await loadKitContext(mission_id);
  const steps = await planSteps({ mission, kit, deployment, deps });
  const co = deps.crewOrchestrator || crewOrchestrator;
  const dispatchEscalation = deps.dispatchEscalation
    || (tgEscalation ? tgEscalation.dispatch : (() => Promise.resolve(null)));
  const resolveStepParams = kitParamResolver.makeStepResolver({
    mission,
    preset: deployment?.preset_config_json || {},
  });
  const run = await co.runCrew({
    mission_id,
    steps,
    dispatchEscalation,
    deps: { ...deps, resolveStepParams },
  });
  return run;
}

module.exports = { runKit, planSteps, loadKitContext, readManifestFromDisk };
