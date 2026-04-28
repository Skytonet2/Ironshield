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

const db                = require("../db/client");
const missionEngine     = require("./missionEngine");
const crewOrchestrator  = require("./crewOrchestrator");
const skillManifests    = require("./skillManifests");
const tgEscalation      = (() => {
  try { return require("./tgEscalation"); } catch { return null; }
})();

/** Plan a steps[] array for a Kit-driven mission. Pure — no DB writes,
 *  no orchestrator calls. Exported for unit-tests. */
async function planSteps({ mission, kit, deployment, deps = {} }) {
  const sm = deps.skillManifests || skillManifests;

  if (!mission)    throw new Error("planSteps: mission required");
  if (!kit)        throw new Error("planSteps: kit required");

  const ids = Array.isArray(kit.bundled_skill_ids) ? kit.bundled_skill_ids : [];
  if (ids.length === 0) {
    throw new Error(`planSteps: kit ${kit.slug} has no bundled_skill_ids — has Tier 1 bulk-import run?`);
  }

  // Shared params: mission inputs override Kit deployment presets which
  // override Kit defaults. Each skill module reads what it needs and
  // ignores the rest.
  const presets = deployment?.preset_config_json || {};
  const inputs  = mission.inputs_json || {};
  const params  = { ...presets, ...inputs };

  const steps = [];
  for (let i = 0; i < ids.length; i++) {
    const skill_id = Number(ids[i]);
    if (!Number.isFinite(skill_id)) {
      throw new Error(`planSteps: bundled_skill_ids[${i}] not a number`);
    }
    const manifest = await sm.getActiveManifest(skill_id);
    if (!manifest) {
      throw new Error(`planSteps: no active manifest for skill_id=${skill_id} (Kit ${kit.slug})`);
    }
    steps.push({
      skill_id,
      role:    manifest.category, // crewOrchestrator constraint
      params,
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
 *  shape: { mission_id, status, steps[], frozen_at, audit_root }. */
async function runKit({ mission_id, deps = {} }) {
  const { mission, kit, deployment } = await loadKitContext(mission_id);
  const steps = await planSteps({ mission, kit, deployment, deps });
  const co = deps.crewOrchestrator || crewOrchestrator;
  const dispatchEscalation = deps.dispatchEscalation
    || (tgEscalation ? tgEscalation.dispatch : (() => Promise.resolve(null)));
  const run = await co.runCrew({ mission_id, steps, dispatchEscalation, deps });
  return run;
}

module.exports = { runKit, planSteps, loadKitContext };
