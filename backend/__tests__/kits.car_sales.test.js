// backend/__tests__/kits.car_sales.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const skills = require("../services/skills");

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "kits", "car_sales.json"), "utf8")
);

test("car_sales kit: manifest core fields", () => {
  assert.equal(manifest.slug, "car_sales");
  assert.equal(manifest.vertical, "commerce");
  assert.ok(manifest.bundled_skills.includes("builtin:verifier_scam"));
  assert.ok(!manifest.bundled_skills.includes("builtin:verifier_listing"),
    "car_sales should use verifier_scam, not verifier_listing");
});

test("car_sales kit: every bundled builtin skill is registered", () => {
  for (const entry of manifest.bundled_skills) {
    const cat = typeof entry === "string" ? entry : entry.skill;
    const c = skills.classifyCategory(cat);
    assert.ok(c, `unrunnable category: ${cat}`);
    if (c.kind === "builtin") assert.ok(skills.get(c.key), `not registered: ${c.key}`);
  }
});

test("car_sales kit: revenue split sums to 10000 bps", () => {
  const s = manifest.revenue_split_bps;
  assert.equal(s.kit_curator + s.agent_owner + s.platform, 10000);
});

test("car_sales kit: connectors reference registered names", () => {
  const connectors = require("../connectors");
  const names = new Set(connectors.list().map((c) => c.name));
  for (const c of [...(manifest.required_connectors || []), ...(manifest.optional_connectors || [])]) {
    assert.ok(names.has(c), `connector not registered: ${c}`);
  }
});

test("car_sales kit: preset schema requires model + year + price + location", () => {
  const req = manifest.preset_config_schema.required;
  for (const f of ["model", "year_range", "price_floor", "location"]) {
    assert.ok(req.includes(f), `missing required field: ${f}`);
  }
});
