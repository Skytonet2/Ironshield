// backend/__tests__/skillManifests.test.js
//
// Unit tests for the Tier 5 additions to skillManifests:
//   - upsertManifest with name + description (slice 1 mirror columns)
//   - setNameAndDescription (slice 2 backfill helper)
//   - setLifecycleStatus (slice 3 admin moderation)
//   - pinVersion (slice 3 active-version pin, transactional)
//
// Mocks the db client. No Postgres required. Mirrors the require.cache
// hijack pattern from agentState.test.js.

const test   = require("node:test");
const assert = require("node:assert/strict");
const path   = require("node:path");

const clientPath = path.resolve(__dirname, "..", "db", "client.js");

// In-memory model: rows keyed by `${skill_id}:${version}`. Each row
// has the columns we touch in the helpers under test.
const rows = new Map();
let queryLog = [];

function reset() {
  rows.clear();
  queryLog = [];
}

function selectRows(filterFn) {
  return [...rows.values()].filter(filterFn);
}

const fakeDb = {
  async query(sql, params = []) {
    queryLog.push({ sql: sql.replace(/\s+/g, " ").trim(), params });

    // INSERT ... ON CONFLICT ... DO UPDATE — the upsertManifest path.
    if (/^INSERT INTO skill_runtime_manifests/.test(sql.trim())) {
      const [skill_id, version, category, vertical_tags, prompt_fragment,
             tool_manifest_json, required_connectors, io_schema_json,
             manifest_hash, status, name, description] = params;
      const key = `${skill_id}:${version}`;
      const prior = rows.get(key);
      const row = {
        id: prior?.id ?? rows.size + 1,
        skill_id, version, category,
        vertical_tags,
        prompt_fragment,
        tool_manifest_json,
        required_connectors,
        io_schema_json,
        manifest_hash,
        status,
        // The COALESCE rule: don't clobber populated values with NULL.
        name:        name        ?? prior?.name        ?? null,
        description: description ?? prior?.description ?? null,
        lifecycle_status: prior?.lifecycle_status ?? "internal",
        deployed_at: new Date(),
      };
      rows.set(key, row);
      return { rows: [{ id: row.id, manifest_hash: row.manifest_hash, deployed_at: row.deployed_at }] };
    }

    // setNameAndDescription
    if (/^UPDATE skill_runtime_manifests\s+SET name = \$3,\s+description = \$4/.test(sql.trim())) {
      const [skill_id, version, name, description] = params;
      const key = `${skill_id}:${version}`;
      const row = rows.get(key);
      if (!row) return { rows: [] };
      row.name = name;
      row.description = description;
      return { rows: [{ id: row.id, name: row.name, description: row.description }] };
    }

    // setLifecycleStatus
    if (/^UPDATE skill_runtime_manifests\s+SET lifecycle_status = \$3/.test(sql.trim())) {
      const [skill_id, version, lifecycle_status] = params;
      const key = `${skill_id}:${version}`;
      const row = rows.get(key);
      if (!row) return { rows: [] };
      row.lifecycle_status = lifecycle_status;
      return { rows: [{ id: row.id, lifecycle_status: row.lifecycle_status }] };
    }

    // listManifests / queries with various WHERE — return everything.
    if (/^SELECT/i.test(sql.trim())) {
      return { rows: [] };
    }
    throw new Error("unexpected SQL: " + sql.slice(0, 80));
  },
  // Minimal transaction shim that gives the callback a `client` with a
  // `query` method that delegates to fakeDb.query — good enough to
  // exercise the pin-version logic without a real Postgres tx.
  async transaction(fn) {
    const client = {
      async query(sql, params) {
        // Custom handlers for the two pin-specific UPDATEs.
        if (/^SELECT id FROM skill_runtime_manifests WHERE skill_id = \$1 AND version = \$2/.test(sql.trim())) {
          const [skill_id, version] = params;
          const row = rows.get(`${skill_id}:${version}`);
          return { rows: row ? [{ id: row.id }] : [] };
        }
        if (/^UPDATE skill_runtime_manifests\s+SET status = 'inactive'/.test(sql.trim())) {
          const [skill_id, keep] = params;
          for (const r of rows.values()) {
            if (String(r.skill_id) === String(skill_id) && r.version !== keep && r.status === "active") {
              r.status = "inactive";
            }
          }
          return { rows: [] };
        }
        if (/^UPDATE skill_runtime_manifests\s+SET status = 'active'/.test(sql.trim())) {
          const [skill_id, version] = params;
          const row = rows.get(`${skill_id}:${version}`);
          if (!row) return { rows: [] };
          row.status = "active";
          return { rows: [{ id: row.id, version: row.version, status: row.status }] };
        }
        return fakeDb.query(sql, params);
      },
    };
    return fn(client);
  },
};

require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true,
  exports: fakeDb,
};

// Now require the module under test — the require.cache stub is
// resolved by the relative `../db/client` import inside the module.
const sm = require("../services/skillManifests");

// ── upsertManifest with name + description ───────────────────────────
test("upsertManifest accepts name and description", async () => {
  reset();
  const r = await sm.upsertManifest({
    skill_id: 42,
    version: "1.0.0",
    category: "builtin:test",
    prompt_fragment: "hello",
    name: "Test Skill",
    description: "A test skill.",
  });
  assert.ok(r.id);
  const stored = rows.get("42:1.0.0");
  assert.equal(stored.name, "Test Skill");
  assert.equal(stored.description, "A test skill.");
});

test("upsertManifest preserves existing name/description on a NULL upsert", async () => {
  reset();
  await sm.upsertManifest({
    skill_id: 1, version: "1.0.0", category: "x",
    prompt_fragment: "p", name: "Original", description: "First desc",
  });
  // Re-upsert without name/description (e.g. a seeder that doesn't
  // know the metadata yet). The COALESCE-on-conflict path means the
  // earlier values must persist.
  await sm.upsertManifest({
    skill_id: 1, version: "1.0.0", category: "x",
    prompt_fragment: "p2",
  });
  assert.equal(rows.get("1:1.0.0").name, "Original");
  assert.equal(rows.get("1:1.0.0").description, "First desc");
  // Verify the prompt_fragment DID change so we know the upsert ran.
  assert.equal(rows.get("1:1.0.0").prompt_fragment, "p2");
});

// ── setNameAndDescription ────────────────────────────────────────────
test("setNameAndDescription updates a row", async () => {
  reset();
  await sm.upsertManifest({
    skill_id: 7, version: "1.0.0", category: "x", prompt_fragment: "p",
  });
  const r = await sm.setNameAndDescription(7, "1.0.0", { name: "N", description: "D" });
  assert.equal(r.name, "N");
  assert.equal(r.description, "D");
});

test("setNameAndDescription on missing row returns null", async () => {
  reset();
  const r = await sm.setNameAndDescription(999, "1.0.0", { name: "N", description: "D" });
  assert.equal(r, null);
});

// ── setLifecycleStatus ───────────────────────────────────────────────
test("setLifecycleStatus rejects invalid values", async () => {
  reset();
  await assert.rejects(
    () => sm.setLifecycleStatus(1, "1.0.0", "bogus"),
    /Invalid lifecycle_status/
  );
});

test("setLifecycleStatus persists a valid value", async () => {
  reset();
  await sm.upsertManifest({
    skill_id: 11, version: "1.0.0", category: "x", prompt_fragment: "p",
  });
  const r = await sm.setLifecycleStatus(11, "1.0.0", "public");
  assert.equal(r.lifecycle_status, "public");
});

test("setLifecycleStatus on missing row returns null", async () => {
  reset();
  const r = await sm.setLifecycleStatus(404, "1.0.0", "public");
  assert.equal(r, null);
});

// ── pinVersion ───────────────────────────────────────────────────────
test("pinVersion promotes one and demotes others atomically", async () => {
  reset();
  // Three versions of the same skill: v1 + v2 active, v3 inactive.
  await sm.upsertManifest({ skill_id: 5, version: "1.0.0", category: "x", prompt_fragment: "p", status: "active" });
  await sm.upsertManifest({ skill_id: 5, version: "1.1.0", category: "x", prompt_fragment: "p", status: "active" });
  await sm.upsertManifest({ skill_id: 5, version: "2.0.0", category: "x", prompt_fragment: "p", status: "inactive" });

  // Pin 2.0.0 → 1.0.0 + 1.1.0 demote, 2.0.0 promotes.
  const r = await sm.pinVersion(5, "2.0.0");
  assert.equal(r.status, "active");
  assert.equal(r.version, "2.0.0");
  assert.equal(rows.get("5:1.0.0").status, "inactive");
  assert.equal(rows.get("5:1.1.0").status, "inactive");
  assert.equal(rows.get("5:2.0.0").status, "active");
});

test("pinVersion on missing row returns null without writing", async () => {
  reset();
  await sm.upsertManifest({ skill_id: 6, version: "1.0.0", category: "x", prompt_fragment: "p", status: "active" });
  const r = await sm.pinVersion(6, "9.9.9");
  assert.equal(r, null);
  // The pre-existing version is untouched.
  assert.equal(rows.get("6:1.0.0").status, "active");
});
