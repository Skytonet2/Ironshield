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

// Default disk-read stub for tests that don't care about the DSL —
// returns null so planSteps falls back to shared-params mode and
// matches the pre-DSL behaviour these tests were written against.
const noDsl = { readManifestFromDisk: () => null };

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
      ...noDsl,
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
      deps: { ...noDsl, skillManifests: fakeSkillManifests({}) },
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
      deps: { ...noDsl, skillManifests: fakeSkillManifests({ 1: { category: "scout" } }) },
    }),
    /no active manifest for skill_id=99/
  );
});

test("kitRunner.planSteps: tolerates missing deployment (mission inputs only)", async () => {
  const steps = await kitRunner.planSteps({
    mission: { on_chain_id: 1, inputs_json: { foo: "bar" } },
    kit: { slug: "realtor", bundled_skill_ids: [1] },
    deployment: null,
    deps: { ...noDsl, skillManifests: fakeSkillManifests({ 1: { category: "scout" } }) },
  });
  assert.equal(steps[0].params.foo, "bar");
});

test("kitRunner.planSteps: rejects non-numeric skill_ids", async () => {
  await assert.rejects(
    () => kitRunner.planSteps({
      mission: { on_chain_id: 1, inputs_json: {} },
      kit: { slug: "realtor", bundled_skill_ids: ["not-a-number"] },
      deployment: null,
      deps: { ...noDsl, skillManifests: fakeSkillManifests({}) },
    }),
    /not a number/
  );
});

test("kitRunner.planSteps: DSL mode picks per-step params over shared params", async () => {
  const steps = await kitRunner.planSteps({
    mission: { on_chain_id: 1, inputs_json: { city: "Lagos" } },
    kit: { slug: "realtor", bundled_skill_ids: [1, 2] },
    deployment: { preset_config_json: { language: "English" } },
    deps: {
      skillManifests: fakeSkillManifests({
        1: { category: "scout"     },
        2: { category: "negotiator"},
      }),
      // Stub disk read — return a manifest with DSL params for step 1.
      readManifestFromDisk: () => ({
        bundled_skills: [
          { skill: "builtin:scout_jiji", params: { query: "$preset.query", limit: 25 } },
          // Second entry is a bare string — falls back to shared params.
          "builtin:negotiator",
        ],
      }),
    },
  });
  assert.equal(steps.length, 2);
  // Step 0: DSL params (template strings preserved — runtime resolves them).
  assert.deepEqual(steps[0].params, { query: "$preset.query", limit: 25 });
  // Step 1: shared params (preset + mission inputs merged).
  assert.equal(steps[1].params.language, "English");
  assert.equal(steps[1].params.city, "Lagos");
});

test("kitRunner.planSteps: missing manifest file = legacy shared-params for every step", async () => {
  const steps = await kitRunner.planSteps({
    mission: { on_chain_id: 1, inputs_json: { foo: "bar" } },
    kit: { slug: "no_manifest_kit", bundled_skill_ids: [1] },
    deployment: { preset_config_json: { baz: 42 } },
    deps: {
      skillManifests: fakeSkillManifests({ 1: { category: "scout" } }),
      readManifestFromDisk: () => null, // simulate missing file
    },
  });
  assert.deepEqual(steps[0].params, { foo: "bar", baz: 42 });
});

test("kitRunner.readManifestFromDisk: rejects path traversal in slug", () => {
  assert.equal(kitRunner.readManifestFromDisk("../../../etc/passwd"), null);
  assert.equal(kitRunner.readManifestFromDisk("a/b"), null);
  assert.equal(kitRunner.readManifestFromDisk(""), null);
});
