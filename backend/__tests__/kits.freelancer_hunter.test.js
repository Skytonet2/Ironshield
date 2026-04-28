// backend/__tests__/kits.freelancer_hunter.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const skills = require("../services/skills");

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "kits", "freelancer_hunter.json"), "utf8")
);

test("freelancer_hunter kit: manifest core fields", () => {
  assert.equal(manifest.slug, "freelancer_hunter");
  assert.equal(manifest.vertical, "lead_gen");
  assert.deepEqual(manifest.bundled_skills.sort(), [
    "builtin:outreach_dm",
    "builtin:pitch_gen",
    "builtin:scout_tg",
    "builtin:scout_x",
  ]);
});

test("freelancer_hunter kit: every bundled builtin skill is registered", () => {
  for (const cat of manifest.bundled_skills) {
    const c = skills.classifyCategory(cat);
    assert.ok(c, `unrunnable category: ${cat}`);
    if (c.kind === "builtin") assert.ok(skills.get(c.key), `not registered: ${c.key}`);
  }
});

test("freelancer_hunter kit: revenue split sums to 10000 bps", () => {
  const s = manifest.revenue_split_bps;
  assert.equal(s.kit_curator + s.agent_owner + s.platform, 10000);
});

test("freelancer_hunter kit: connectors reference registered names", () => {
  const connectors = require("../connectors");
  const names = new Set(connectors.list().map((c) => c.name));
  for (const c of [...(manifest.required_connectors || []), ...(manifest.optional_connectors || [])]) {
    assert.ok(names.has(c), `connector not registered: ${c}`);
  }
});

test("scout_tg: degraded shape when buffer is empty", async () => {
  const scoutTg = require("../services/skills/scout_tg");
  // Force-empty the buffer to ensure deterministic test output even
  // if some other test bus-emitted into it.
  scoutTg._buffer.length = 0;
  const out = await scoutTg.execute({ params: {} });
  assert.equal(out.source, "tg");
  assert.equal(out.degraded, true);
  assert.match(out.reason, /no inbound TG events/);
});
