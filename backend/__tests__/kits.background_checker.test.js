// backend/__tests__/kits.background_checker.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const skills = require("../services/skills");

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "kits", "background_checker.json"), "utf8")
);

test("background_checker kit: manifest core fields", () => {
  assert.equal(manifest.slug, "background_checker");
  assert.equal(manifest.vertical, "reputation");
  assert.ok(manifest.bundled_skills.includes("builtin:scam_detect"));
  assert.ok(manifest.bundled_skills.includes("builtin:report_gen"));
});

test("background_checker kit: every bundled builtin skill is registered", () => {
  for (const cat of manifest.bundled_skills) {
    const c = skills.classifyCategory(cat);
    assert.ok(c, `unrunnable category: ${cat}`);
    if (c.kind === "builtin") assert.ok(skills.get(c.key), `not registered: ${c.key}`);
  }
});

test("background_checker kit: revenue split sums to 10000 bps", () => {
  const s = manifest.revenue_split_bps;
  assert.equal(s.kit_curator + s.agent_owner + s.platform, 10000);
});

test("background_checker kit: connectors reference registered names", () => {
  const connectors = require("../connectors");
  const names = new Set(connectors.list().map((c) => c.name));
  for (const c of [...(manifest.required_connectors || []), ...(manifest.optional_connectors || [])]) {
    assert.ok(names.has(c), `connector not registered: ${c}`);
  }
});

test("background_checker kit: depth enum is quick/standard/deep", () => {
  const depthEnum = manifest.preset_config_schema.properties.depth.enum;
  assert.deepEqual(depthEnum.sort(), ["deep", "quick", "standard"]);
});

test("scam_detect: rejects without subject + evidence", async () => {
  const sd = require("../services/skills/scam_detect");
  await assert.rejects(
    () => sd.execute({ params: {}, agent: async () => ({ reply: "{}" }) }),
    /required/
  );
});

test("report_gen: rejects without subject + bundle", async () => {
  const rg = require("../services/skills/report_gen");
  await assert.rejects(
    () => rg.execute({ params: { subject: "x" }, agent: async () => ({ reply: "" }) }),
    /required/
  );
});
