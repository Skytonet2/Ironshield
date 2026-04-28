// backend/__tests__/kits.realtor.test.js
// Manifest validity + skill-availability check for the Realtor Kit.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const skills = require("../services/skills");

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "kits", "realtor.json"), "utf8")
);

test("realtor kit: manifest core fields", () => {
  assert.equal(manifest.slug, "realtor");
  assert.equal(manifest.vertical, "realestate");
  assert.ok(Array.isArray(manifest.bundled_skills));
  assert.ok(manifest.bundled_skills.length >= 5);
});

test("realtor kit: every bundled builtin skill is registered", () => {
  for (const cat of manifest.bundled_skills) {
    const c = skills.classifyCategory(cat);
    assert.ok(c, `unrunnable category: ${cat}`);
    if (c.kind !== "builtin") continue;
    assert.ok(skills.get(c.key), `builtin skill not registered: ${c.key}`);
  }
});

test("realtor kit: revenue split sums to 10000 bps", () => {
  const s = manifest.revenue_split_bps;
  assert.equal(s.kit_curator + s.agent_owner + s.platform, 10000);
});

test("realtor kit: required connectors reference real connector names", () => {
  const connectors = require("../connectors");
  const names = new Set(connectors.list().map((c) => c.name));
  for (const c of manifest.required_connectors || []) {
    assert.ok(names.has(c), `required connector not registered: ${c}`);
  }
  for (const c of manifest.optional_connectors || []) {
    assert.ok(names.has(c), `optional connector not registered: ${c}`);
  }
});

test("realtor kit: preset_config_schema is JSON-Schema-shaped", () => {
  const s = manifest.preset_config_schema;
  assert.equal(s.type, "object");
  assert.ok(Array.isArray(s.required) && s.required.length > 0);
  assert.equal(typeof s.properties, "object");
});
