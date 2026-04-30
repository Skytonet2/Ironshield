// backend/__tests__/skillsCatalog.test.js
//
// Route-level tests for the Tier 5 catalog surface. Stands up the
// router with a fake db so we can exercise:
//   - GET /catalog — input validation + sort/cursor handling
//   - GET /authors — sort/window param handling
//   - GET /:skill_id/versions — listing
//   - GET /:skill_id/versions/:version — single fetch + 404
//   - GET /:skill_id/diff — field-by-field diff logic
//
// We don't try to test the SQL itself (FTS, joins, GROUP BY) — that
// would need a real Postgres. The fake db captures the SQL strings
// + params so we can assert the *shape* of what the route fires.

const test    = require("node:test");
const assert  = require("node:assert/strict");
const path    = require("node:path");
const http    = require("node:http");
const express = require("express");

const clientPath = path.resolve(__dirname, "..", "db", "client.js");

let stubResponses = [];     // queue of { rows: [...] } responses
let queryLog = [];

const fakeDb = {
  async query(sql, params = []) {
    queryLog.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
    if (stubResponses.length === 0) return { rows: [] };
    return stubResponses.shift();
  },
};

require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true,
  exports: fakeDb,
};

const router = require("../routes/skillsCatalog.route");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/skills", router);
  return app;
}

async function startServer() {
  const app = makeApp();
  const server = http.createServer(app);
  await new Promise((res) => server.listen(0, res));
  const port = server.address().port;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

function reset() {
  stubResponses = [];
  queryLog = [];
}

// ── /catalog ─────────────────────────────────────────────────────────
test("/catalog with no q defaults to newest sort and applies public lifecycle filter", async () => {
  reset();
  stubResponses.push({ rows: [] });
  const { base, close } = await startServer();
  try {
    const r = await fetch(`${base}/api/skills/catalog`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.deepEqual(j, { rows: [], nextCursor: null });
    // First param is the lifecycles array.
    assert.deepEqual(queryLog[0].params[0], ["curated", "public"]);
    // No q present → ts_rank should NOT appear in the ORDER BY.
    assert.ok(!/ts_rank/.test(queryLog[0].sql));
    // Default sort is newest → ORDER BY m.deployed_at DESC.
    assert.ok(/ORDER BY m\.deployed_at DESC/.test(queryLog[0].sql));
  } finally { await close(); }
});

test("/catalog with q switches to relevance sort and pushes q param", async () => {
  reset();
  stubResponses.push({ rows: [] });
  const { base, close } = await startServer();
  try {
    const r = await fetch(`${base}/api/skills/catalog?q=wallet+watch`);
    assert.equal(r.status, 200);
    // q is the 2nd param (index 1) — lifecycles is param 1.
    assert.equal(queryLog[0].params[1], "wallet watch");
    assert.ok(/websearch_to_tsquery/.test(queryLog[0].sql));
    assert.ok(/ts_rank/.test(queryLog[0].sql));
  } finally { await close(); }
});

test("/catalog respects vertical filter via && array overlap", async () => {
  reset();
  stubResponses.push({ rows: [] });
  const { base, close } = await startServer();
  try {
    await fetch(`${base}/api/skills/catalog?vertical=defi,scams`);
    assert.deepEqual(queryLog[0].params[1], ["defi", "scams"]);
    assert.ok(/m\.vertical_tags && \$2/.test(queryLog[0].sql));
  } finally { await close(); }
});

test("/catalog clamps limit to MAX_LIMIT (50)", async () => {
  reset();
  stubResponses.push({ rows: [] });
  const { base, close } = await startServer();
  try {
    await fetch(`${base}/api/skills/catalog?limit=9999`);
    // The last param is limit + 1 = 51.
    const last = queryLog[0].params[queryLog[0].params.length - 1];
    assert.equal(last, 51);
  } finally { await close(); }
});

test("/catalog returns hasMore + nextCursor when over the limit", async () => {
  reset();
  // Stub returns 25 rows for a request asking for limit=24 (so limit+1 = 25).
  const fakeRows = Array.from({ length: 25 }, (_, i) => ({
    id: 100 - i,
    skill_id: i,
    version: "1.0.0",
    name: `S${i}`,
    description: "",
    category: "builtin:x",
    vertical_tags: [],
    required_connectors: [],
    lifecycle_status: "public",
    manifest_hash: "hash" + i,
    deployed_at: new Date(),
    avg_rating: 0,
    review_count: 0,
    install_count: 0,
    earnings_yocto: "0",
  }));
  stubResponses.push({ rows: fakeRows });
  const { base, close } = await startServer();
  try {
    const r = await fetch(`${base}/api/skills/catalog?limit=24`);
    const j = await r.json();
    assert.equal(j.rows.length, 24);
    assert.equal(j.nextCursor, j.rows[j.rows.length - 1].id);
  } finally { await close(); }
});

// ── /authors ─────────────────────────────────────────────────────────
test("/authors defaults to earnings sort + all-time window", async () => {
  reset();
  stubResponses.push({ rows: [] });
  const { base, close } = await startServer();
  try {
    const r = await fetch(`${base}/api/skills/authors`);
    const j = await r.json();
    assert.equal(j.sort, "earnings");
    assert.equal(j.window, "all");
    // SQL should NOT include the 30d filter when window=all.
    assert.ok(!/INTERVAL '30 days'\s*\)::numeric/.test(queryLog[0].sql) || /sold_at >= NOW\(\) - INTERVAL '30 days'\)::numeric/.test(queryLog[0].sql));
    // Order by earnings_yocto first.
    assert.ok(/ORDER BY earnings_yocto DESC/.test(queryLog[0].sql));
  } finally { await close(); }
});

test("/authors with sort=sales orders by sales", async () => {
  reset();
  stubResponses.push({ rows: [] });
  const { base, close } = await startServer();
  try {
    await fetch(`${base}/api/skills/authors?sort=sales`);
    assert.ok(/ORDER BY sales DESC/.test(queryLog[0].sql));
  } finally { await close(); }
});

// ── /:skill_id/versions ──────────────────────────────────────────────
test("/:skill_id/versions rejects non-numeric skill_id", async () => {
  reset();
  const { base, close } = await startServer();
  try {
    const r = await fetch(`${base}/api/skills/abc/versions`);
    assert.equal(r.status, 400);
  } finally { await close(); }
});

test("/:skill_id/versions returns rows from the SQL response", async () => {
  reset();
  stubResponses.push({ rows: [
    { id: 1, skill_id: 42, version: "1.0.0", name: "X" },
    { id: 2, skill_id: 42, version: "1.1.0", name: "X" },
  ]});
  const { base, close } = await startServer();
  try {
    const r = await fetch(`${base}/api/skills/42/versions`);
    const j = await r.json();
    assert.equal(j.rows.length, 2);
    assert.equal(queryLog[0].params[0], 42);
  } finally { await close(); }
});

test("/:skill_id/versions/:version 404s on missing row", async () => {
  reset();
  stubResponses.push({ rows: [] });
  const { base, close } = await startServer();
  try {
    const r = await fetch(`${base}/api/skills/42/versions/9.9.9`);
    assert.equal(r.status, 404);
  } finally { await close(); }
});

// ── /:skill_id/diff ──────────────────────────────────────────────────
test("/:skill_id/diff requires from + to", async () => {
  reset();
  const { base, close } = await startServer();
  try {
    const r = await fetch(`${base}/api/skills/42/diff?from=1.0.0`);
    assert.equal(r.status, 400);
    const j = await r.json();
    assert.match(j.error, /from and to/);
  } finally { await close(); }
});

test("/:skill_id/diff rejects from === to", async () => {
  reset();
  const { base, close } = await startServer();
  try {
    const r = await fetch(`${base}/api/skills/42/diff?from=1.0.0&to=1.0.0`);
    assert.equal(r.status, 400);
  } finally { await close(); }
});

test("/:skill_id/diff produces field-by-field changes", async () => {
  reset();
  stubResponses.push({ rows: [
    {
      version: "1.0.0",
      name: "Old",
      description: "v1 desc",
      category: "builtin:test",
      vertical_tags: ["a", "b"],
      prompt_fragment: "old prompt",
      tool_manifest: [{ tool: "x" }],
      required_connectors: ["telegram"],
      io_schema: { in: "string" },
      manifest_hash: "h1",
      status: "active",
      lifecycle_status: "curated",
      deployed_at: new Date("2026-04-01"),
    },
    {
      version: "2.0.0",
      name: "New",
      description: "v1 desc",   // unchanged
      category: "builtin:test", // unchanged
      vertical_tags: ["b", "a"], // same set, different order → unchanged
      prompt_fragment: "new prompt",
      tool_manifest: [{ tool: "x" }, { tool: "y" }],
      required_connectors: ["telegram", "x"],
      io_schema: { in: "string", out: "json" },
      manifest_hash: "h2",
      status: "active",
      lifecycle_status: "public",
      deployed_at: new Date("2026-04-15"),
    },
  ]});
  const { base, close } = await startServer();
  try {
    const r = await fetch(`${base}/api/skills/42/diff?from=1.0.0&to=2.0.0`);
    assert.equal(r.status, 200);
    const j = await r.json();
    // name + description: name changed, description unchanged.
    assert.deepEqual(j.diff.name, { from: "Old", to: "New" });
    assert.equal(j.diff.description, null);
    // Category unchanged.
    assert.equal(j.diff.category, null);
    // vertical_tags: same set, different order → unchanged.
    assert.equal(j.diff.vertical_tags, null);
    // prompt_fragment changed.
    assert.deepEqual(j.diff.prompt_fragment, { from: "old prompt", to: "new prompt" });
    // tool_manifest changed (length differs).
    assert.ok(j.diff.tool_manifest);
    // required_connectors changed.
    assert.ok(j.diff.required_connectors);
    // io_schema changed.
    assert.ok(j.diff.io_schema);
    // manifest_hash + status + lifecycle_status.
    assert.deepEqual(j.diff.manifest_hash, { from: "h1", to: "h2" });
    assert.equal(j.diff.status, null);
    assert.deepEqual(j.diff.lifecycle_status, { from: "curated", to: "public" });
  } finally { await close(); }
});

test("/:skill_id/diff 404s when one version missing", async () => {
  reset();
  // Only one row returned — diff requires both.
  stubResponses.push({ rows: [{ version: "1.0.0", name: "X" }] });
  const { base, close } = await startServer();
  try {
    const r = await fetch(`${base}/api/skills/42/diff?from=1.0.0&to=2.0.0`);
    assert.equal(r.status, 404);
  } finally { await close(); }
});
