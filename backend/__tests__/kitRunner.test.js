// backend/__tests__/kitRunner.test.js
// Unit-tests planSteps() with mocked skillManifests. No DB.

const test = require("node:test");
const assert = require("node:assert/strict");

const kitRunner = require("../services/kitRunner");

function fakeSkillManifests(byId) {
  return {
    getActiveManifest: async (id) => byId[id] || null,
  };
}

test("kitRunner.planSteps: maps bundled_skill_ids → steps with role from manifest", async () => {
  const steps = await kitRunner.planSteps({
    mission: {
      on_chain_id: 7,
      kit_slug: "realtor",
      inputs_json: { city: "Lagos" },
    },
    kit: {
      slug: "realtor",
      bundled_skill_ids: [1, 2, 3],
    },
    deployment: {
      preset_config_json: { query: "2-bedroom apartment", language: "English" },
    },
    deps: {
      skillManifests: fakeSkillManifests({
        1: { category: "scout"   },
        2: { category: "verifier"},
        3: { category: "outreach"},
      }),
    },
  });
  assert.equal(steps.length, 3);
  assert.equal(steps[0].skill_id, 1);
  assert.equal(steps[0].role, "scout");
  assert.equal(steps[1].role, "verifier");
  assert.equal(steps[2].role, "outreach");
  // Mission inputs override deployment presets but both should be visible.
  assert.equal(steps[0].params.query, "2-bedroom apartment");
  assert.equal(steps[0].params.language, "English");
  assert.equal(steps[0].params.city, "Lagos");
});

test("kitRunner.planSteps: throws when bundled_skill_ids is empty", async () => {
  await assert.rejects(
    () => kitRunner.planSteps({
      mission: { on_chain_id: 1, inputs_json: {} },
      kit: { slug: "freelancer_hunter", bundled_skill_ids: [] },
      deployment: null,
      deps: { skillManifests: fakeSkillManifests({}) },
    }),
    /bulk-import run/
  );
});

test("kitRunner.planSteps: throws when a skill_id has no active manifest", async () => {
  await assert.rejects(
    () => kitRunner.planSteps({
      mission: { on_chain_id: 1, inputs_json: {} },
      kit: { slug: "realtor", bundled_skill_ids: [1, 99] },
      deployment: null,
      deps: { skillManifests: fakeSkillManifests({ 1: { category: "scout" } }) },
    }),
    /no active manifest for skill_id=99/
  );
});

test("kitRunner.planSteps: tolerates missing deployment (mission inputs only)", async () => {
  const steps = await kitRunner.planSteps({
    mission: { on_chain_id: 1, inputs_json: { foo: "bar" } },
    kit: { slug: "realtor", bundled_skill_ids: [1] },
    deployment: null,
    deps: { skillManifests: fakeSkillManifests({ 1: { category: "scout" } }) },
  });
  assert.equal(steps[0].params.foo, "bar");
});

test("kitRunner.planSteps: rejects non-numeric skill_ids", async () => {
  await assert.rejects(
    () => kitRunner.planSteps({
      mission: { on_chain_id: 1, inputs_json: {} },
      kit: { slug: "realtor", bundled_skill_ids: ["not-a-number"] },
      deployment: null,
      deps: { skillManifests: fakeSkillManifests({}) },
    }),
    /not a number/
  );
});
