// backend/__tests__/importSkillManifests.test.js
//
// Tests for the bulk skill-manifest CLI. The pure helpers
// (validateManifest, findDuplicates, classifyChange, parseArgs,
// loadManifestsFromDir) are exercised directly. `run()` is exercised
// against an in-memory fake of skillManifests so the full
// orchestration — load → validate → dedupe → classify → write — is
// covered without standing up Postgres.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Stub the db client before requiring anything that pulls it in.
const clientPath = path.resolve(__dirname, "..", "db", "client.js");
require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true,
  exports: {
    query: async () => ({ rows: [] }),
    transaction: async (fn) => fn({ query: async () => ({ rows: [] }) }),
    pool: { connect: async () => ({ release: () => {}, query: async () => ({ rows: [] }) }) },
    close: async () => {},
  },
};

const cli = require("../scripts/import-skill-manifests");
const skillManifests = require("../services/skillManifests");

const VALID_BODY = {
  skill_id: 12,
  version: "1.0.0",
  category: "outreach",
  prompt_fragment: "You are a wallet-watch agent.",
  vertical_tags: ["crypto"],
  tool_manifest: [{ name: "fetch_wallet" }],
  required_connectors: ["telegram"],
  io_schema: { type: "object" },
  status: "curated",
};

test("validateManifest: accepts a complete valid manifest", () => {
  const out = cli.validateManifest(VALID_BODY, "/tmp/x.json");
  assert.equal(out.skill_id, 12);
  assert.equal(out.version, "1.0.0");
  assert.equal(out.status, "curated");
});

test("validateManifest: fills defaults when optional fields omitted", () => {
  const minimal = {
    skill_id: 1,
    version: "1",
    category: "scout",
    prompt_fragment: "p",
  };
  const out = cli.validateManifest(minimal);
  assert.deepEqual(out.vertical_tags, []);
  assert.deepEqual(out.tool_manifest, []);
  assert.deepEqual(out.required_connectors, []);
  assert.deepEqual(out.io_schema, {});
  assert.equal(out.status, "internal");
});

test("validateManifest: rejects non-object input", () => {
  assert.throws(() => cli.validateManifest(null), /must be a JSON object/);
  assert.throws(() => cli.validateManifest([]), /must be a JSON object/);
  assert.throws(() => cli.validateManifest("hi"), /must be a JSON object/);
});

test("validateManifest: rejects missing required fields", () => {
  for (const f of cli.REQUIRED_FIELDS) {
    const body = { ...VALID_BODY };
    delete body[f];
    assert.throws(() => cli.validateManifest(body), new RegExp(`missing required field "${f}"`));
  }
});

test("validateManifest: rejects negative or non-integer skill_id", () => {
  assert.throws(() => cli.validateManifest({ ...VALID_BODY, skill_id: -1 }), /non-negative integer/);
  assert.throws(() => cli.validateManifest({ ...VALID_BODY, skill_id: 1.5 }), /non-negative integer/);
  assert.throws(() => cli.validateManifest({ ...VALID_BODY, skill_id: "12" }), /non-negative integer/);
});

test("validateManifest: rejects empty version / category", () => {
  assert.throws(() => cli.validateManifest({ ...VALID_BODY, version: "" }), /version must/);
  assert.throws(() => cli.validateManifest({ ...VALID_BODY, version: "  " }), /version must/);
  assert.throws(() => cli.validateManifest({ ...VALID_BODY, category: "" }), /category must/);
});

test("validateManifest: rejects malformed array fields", () => {
  assert.throws(
    () => cli.validateManifest({ ...VALID_BODY, vertical_tags: ["ok", 7] }),
    /vertical_tags must be an array of strings/,
  );
  assert.throws(
    () => cli.validateManifest({ ...VALID_BODY, required_connectors: [null] }),
    /required_connectors must be an array of strings/,
  );
  assert.throws(
    () => cli.validateManifest({ ...VALID_BODY, tool_manifest: "not an array" }),
    /tool_manifest must be an array/,
  );
});

test("validateManifest: rejects io_schema that isn't a plain object", () => {
  assert.throws(() => cli.validateManifest({ ...VALID_BODY, io_schema: [] }), /io_schema must be an object/);
  assert.throws(() => cli.validateManifest({ ...VALID_BODY, io_schema: null }), /io_schema must be an object/);
});

test("validateManifest: rejects unknown status values", () => {
  assert.throws(
    () => cli.validateManifest({ ...VALID_BODY, status: "approved" }),
    /status "approved" not in/,
  );
});

test("findDuplicates: clean batch returns []", () => {
  const items = [
    { source: "a.json", manifest: { skill_id: 1, version: "1" } },
    { source: "b.json", manifest: { skill_id: 1, version: "2" } },
    { source: "c.json", manifest: { skill_id: 2, version: "1" } },
  ];
  assert.deepEqual(cli.findDuplicates(items), []);
});

test("findDuplicates: same (skill_id, version) across files is reported", () => {
  const items = [
    { source: "a.json", manifest: { skill_id: 1, version: "1" } },
    { source: "b.json", manifest: { skill_id: 1, version: "1" } },
  ];
  const dups = cli.findDuplicates(items);
  assert.equal(dups.length, 1);
  assert.equal(dups[0].key, "1@1");
  assert.deepEqual(dups[0].sources, ["a.json", "b.json"]);
});

test("classifyChange: no DB row → create", () => {
  assert.equal(cli.classifyChange(VALID_BODY, null), "create");
  assert.equal(cli.classifyChange(VALID_BODY, undefined), "create");
});

test("classifyChange: matching hash + status → unchanged", () => {
  // Compute the hash exactly the way upsertManifest does, so we can
  // construct a fake DB row that should classify as "unchanged".
  const body = {
    prompt_fragment:     VALID_BODY.prompt_fragment,
    tool_manifest:       VALID_BODY.tool_manifest,
    required_connectors: VALID_BODY.required_connectors,
    io_schema:           VALID_BODY.io_schema,
  };
  const hash = skillManifests.computeManifestHash(body);
  const dbRow = { manifest_hash: hash, status: VALID_BODY.status };
  assert.equal(cli.classifyChange(VALID_BODY, dbRow), "unchanged");
});

test("classifyChange: different hash → update", () => {
  const dbRow = { manifest_hash: "deadbeef", status: VALID_BODY.status };
  assert.equal(cli.classifyChange(VALID_BODY, dbRow), "update");
});

test("classifyChange: matching hash but different status → update", () => {
  // status flip alone (e.g., curated → public) needs an upsert call so
  // the schema's status column actually changes.
  const body = {
    prompt_fragment:     VALID_BODY.prompt_fragment,
    tool_manifest:       VALID_BODY.tool_manifest,
    required_connectors: VALID_BODY.required_connectors,
    io_schema:           VALID_BODY.io_schema,
  };
  const hash = skillManifests.computeManifestHash(body);
  const dbRow = { manifest_hash: hash, status: "internal" };
  assert.equal(cli.classifyChange(VALID_BODY, dbRow), "update");
});

test("parseArgs: positional dir + --dry-run", () => {
  assert.deepEqual(
    cli.parseArgs(["./manifests", "--dry-run"]),
    { dir: "./manifests", dryRun: true, help: false },
  );
});

test("parseArgs: --help wins", () => {
  const a = cli.parseArgs(["--help"]);
  assert.equal(a.help, true);
});

test("parseArgs: no dir defaults to null (run() injects ./skill-manifests)", () => {
  const a = cli.parseArgs([]);
  assert.equal(a.dir, null);
  assert.equal(a.dryRun, false);
});

// ── Filesystem-touching helper ────────────────────────────────────────
function makeManifestDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-manifests-"));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), JSON.stringify(body));
  }
  return dir;
}

test("loadManifestsFromDir: ignores non-json files and sorts results", () => {
  const dir = makeManifestDir({
    "b.json": { skill_id: 2, version: "1", category: "x", prompt_fragment: "p" },
    "a.json": { skill_id: 1, version: "1", category: "x", prompt_fragment: "p" },
    "readme.md": "ignored",
  });
  const items = cli.loadManifestsFromDir(dir);
  assert.equal(items.length, 2);
  // sorted alphabetically by filename → a.json first
  assert.equal(items[0].manifest.skill_id, 1);
  assert.equal(items[1].manifest.skill_id, 2);
});

test("loadManifestsFromDir: surfaces JSON parse errors with the file path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-manifests-"));
  fs.writeFileSync(path.join(dir, "bad.json"), "{ not valid json");
  assert.throws(
    () => cli.loadManifestsFromDir(dir),
    /bad\.json: invalid JSON/,
  );
});

test("loadManifestsFromDir: rejects non-existent path", () => {
  assert.throws(
    () => cli.loadManifestsFromDir("/nonexistent/dir/that/should/not/exist"),
    /Not a directory/,
  );
});

// ── End-to-end run() against a fake DB ────────────────────────────────
function fakeSkillManifests({ existing = [] } = {}) {
  const map = new Map();
  for (const r of existing) map.set(`${r.skill_id}@${r.version}`, r);
  const calls = { upsert: [] };
  return {
    calls,
    computeManifestHash: skillManifests.computeManifestHash,
    getManifest: async (skill_id, version) => map.get(`${skill_id}@${version}`) || null,
    upsertManifest: async (m) => {
      calls.upsert.push(m);
      return { id: 1, manifest_hash: "abc123def456", deployed_at: new Date().toISOString() };
    },
  };
}

test("run: dry-run does not call upsert and exits 0", async () => {
  const dir = makeManifestDir({
    "a.json": VALID_BODY,
  });
  const fakeSm = fakeSkillManifests();
  const out = await cli.run(
    { dir, dryRun: true },
    { skillManifests: fakeSm, log: () => {}, err: () => {} },
  );
  assert.equal(out.exitCode, 0);
  assert.equal(fakeSm.calls.upsert.length, 0);
  assert.equal(out.summary.create, 1);
});

test("run: writes create + update, skips unchanged", async () => {
  // VALID_BODY is "unchanged" if existing has matching hash + status.
  const matchingHash = skillManifests.computeManifestHash({
    prompt_fragment:     VALID_BODY.prompt_fragment,
    tool_manifest:       VALID_BODY.tool_manifest,
    required_connectors: VALID_BODY.required_connectors,
    io_schema:           VALID_BODY.io_schema,
  });
  const dir = makeManifestDir({
    "a-new.json":       { ...VALID_BODY, skill_id: 100 },
    "b-changed.json":   { ...VALID_BODY, skill_id: 200 },
    "c-unchanged.json": { ...VALID_BODY, skill_id: 300 },
  });
  const fakeSm = fakeSkillManifests({
    existing: [
      // skill 200: hash differs → update
      { skill_id: 200, version: VALID_BODY.version, manifest_hash: "old", status: VALID_BODY.status },
      // skill 300: hash + status match → unchanged
      { skill_id: 300, version: VALID_BODY.version, manifest_hash: matchingHash, status: VALID_BODY.status },
    ],
  });
  const out = await cli.run(
    { dir, dryRun: false },
    { skillManifests: fakeSm, log: () => {}, err: () => {} },
  );
  assert.equal(out.exitCode, 0);
  assert.equal(fakeSm.calls.upsert.length, 2);                 // 100 + 200
  assert.deepEqual(
    fakeSm.calls.upsert.map((m) => m.skill_id).sort(),
    [100, 200],
  );
  assert.equal(out.summary.create, 1);
  assert.equal(out.summary.update, 1);
  assert.equal(out.summary.unchanged, 1);
  assert.equal(out.summary.written, 2);
});

test("run: duplicate (skill_id, version) across files exits 1 with no writes", async () => {
  const dir = makeManifestDir({
    "a.json": VALID_BODY,
    "b.json": VALID_BODY, // identical key → duplicate
  });
  const fakeSm = fakeSkillManifests();
  const out = await cli.run(
    { dir, dryRun: false },
    { skillManifests: fakeSm, log: () => {}, err: () => {} },
  );
  assert.equal(out.exitCode, 1);
  assert.equal(fakeSm.calls.upsert.length, 0);
});

test("run: per-row upsert failure surfaces in summary and exits 2", async () => {
  const dir = makeManifestDir({
    "a.json": { ...VALID_BODY, skill_id: 1 },
    "b.json": { ...VALID_BODY, skill_id: 2 },
  });
  const fakeSm = fakeSkillManifests();
  const realUpsert = fakeSm.upsertManifest;
  fakeSm.upsertManifest = async (m) => {
    if (m.skill_id === 2) throw new Error("simulated FK violation");
    return realUpsert(m);
  };
  const out = await cli.run(
    { dir, dryRun: false },
    { skillManifests: fakeSm, log: () => {}, err: () => {} },
  );
  assert.equal(out.exitCode, 2);
  assert.equal(out.summary.written, 1);
  assert.equal(out.summary.failed, 1);
});
