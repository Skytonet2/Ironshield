// backend/__tests__/agentMatcher.test.js
//
// Pure ranking + SQL-shape tests for the agent-economy feed matcher.
// matchAgents() is run against a fake db.query so we never touch
// Postgres — the goal is to verify ordering invariants, vertical
// alias expansion, and the geo-filter contract.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  expandVertical,
  buildMatcherSql,
  rankRows,
  matchAgents,
  SORT_MODES,
} = require("../services/agentMatcher");

// ── Fixture rows — shaped like buildMatcherSql's projection. ──────────
const ROWS = [
  // High-rep automotive specialist with cheap fee.
  {
    deployment_id: 1, agent_owner_wallet: "topgun.near", kit_slug: "car-sales",
    kit_vertical: "car-sales", reputation_score: 9000, missions_completed: 50,
    missions_failed: 2, success_rate_bps: 9600, fee_yocto: "1000000000000000000000",
  },
  // Mid-rep, fast (lots of missions), expensive.
  {
    deployment_id: 2, agent_owner_wallet: "speed.near", kit_slug: "car-sales",
    kit_vertical: "car-sales", reputation_score: 4000, missions_completed: 80,
    missions_failed: 8, success_rate_bps: 9000, fee_yocto: "9000000000000000000000",
  },
  // New & rising: low mission count, high success rate.
  {
    deployment_id: 3, agent_owner_wallet: "newkid.near", kit_slug: "car-sales",
    kit_vertical: "car-sales", reputation_score: 800, missions_completed: 5,
    missions_failed: 0, success_rate_bps: 10000, fee_yocto: "2000000000000000000000",
  },
  // Stale: many failures, low rep, no fee on file.
  {
    deployment_id: 4, agent_owner_wallet: "stale.near", kit_slug: "car-sales",
    kit_vertical: "car-sales", reputation_score: 100, missions_completed: 12,
    missions_failed: 10, success_rate_bps: 1500, fee_yocto: null,
  },
  // Zero-mission: no signal yet, gets dropped from "new" but kept in
  // "reputation" tail.
  {
    deployment_id: 5, agent_owner_wallet: "fresh.near", kit_slug: "car-sales",
    kit_vertical: "car-sales", reputation_score: 0, missions_completed: 0,
    missions_failed: 0, success_rate_bps: 0, fee_yocto: "500000000000000000000",
  },
];

test("expandVertical maps canonical → aliases used by Kit fixtures", () => {
  const a = expandVertical("automotive");
  assert.ok(a.includes("automotive"));
  assert.ok(a.includes("car-sales"));
  assert.ok(a.includes("car_sales"));
});

test("expandVertical falls back to [canonical] for unknown verticals", () => {
  assert.deepEqual(expandVertical("aerospace"), ["aerospace"]);
});

test("SORT_MODES enumerates exactly the modes the route accepts", () => {
  assert.deepEqual(SORT_MODES.sort(), ["cheap", "fast", "local", "new", "reputation"].sort());
});

test("buildMatcherSql defaults to reputation order with 1 param", () => {
  const { sql, params } = buildMatcherSql({
    verticals: ["car-sales"], geo: null, sort: "reputation", limit: 10,
  });
  assert.match(sql, /ak\.vertical = ANY\(\$1\)/);
  assert.match(sql, /ORDER BY reputation_score DESC/);
  assert.equal(params.length, 2); // verticals + limit
  assert.equal(params[1], 10);
});

test("buildMatcherSql injects an EXISTS subquery when geo is set", () => {
  const { sql, params } = buildMatcherSql({
    verticals: ["car-sales"], geo: "Minna", sort: "reputation", limit: 10,
  });
  assert.match(sql, /EXISTS \(\s*SELECT 1 FROM missions/);
  assert.match(sql, /inputs_json::text ILIKE/);
  // verticals, geo, limit
  assert.equal(params.length, 3);
  assert.equal(params[1], "%Minna%");
});

test("buildMatcherSql adds the BETWEEN 1 AND 10 mission filter for sort=new", () => {
  const { sql } = buildMatcherSql({
    verticals: ["car-sales"], geo: null, sort: "new", limit: 10,
  });
  assert.match(sql, /COALESCE\(rc\.missions_completed, 0\) BETWEEN 1 AND 10/);
  assert.match(sql, /ORDER BY success_rate_bps DESC/);
});

test("buildMatcherSql sorts by fee_yocto ASC NULLS LAST for sort=cheap", () => {
  const { sql } = buildMatcherSql({
    verticals: ["car-sales"], geo: null, sort: "cheap", limit: 10,
  });
  assert.match(sql, /ORDER BY fee_yocto ASC NULLS LAST/);
});

test("rankRows reputation: top-rep first, ties broken by missions_completed", () => {
  const r = rankRows(ROWS, "reputation");
  assert.equal(r[0].agent_owner_wallet, "topgun.near");
  assert.equal(r[1].agent_owner_wallet, "speed.near");
  assert.equal(r[r.length - 1].agent_owner_wallet, "fresh.near");
});

test("rankRows fast: highest missions_completed first regardless of rep", () => {
  const r = rankRows(ROWS, "fast");
  assert.equal(r[0].agent_owner_wallet, "speed.near");
  assert.equal(r[1].agent_owner_wallet, "topgun.near");
});

test("rankRows cheap: lowest fee_yocto first, null fees last", () => {
  const r = rankRows(ROWS, "cheap");
  assert.equal(r[0].agent_owner_wallet, "fresh.near");      // 500e18
  assert.equal(r[1].agent_owner_wallet, "topgun.near");     // 1000e18
  assert.equal(r[r.length - 1].agent_owner_wallet, "stale.near"); // null
});

test("rankRows new: filters to missions in [1,10] and ranks by success_rate", () => {
  const r = rankRows(ROWS, "new");
  // Eligible: newkid (5) and stale (12 — excluded). speed (80 — excluded).
  // topgun (50 — excluded). fresh (0 — excluded).
  const wallets = r.map((x) => x.agent_owner_wallet);
  assert.deepEqual(wallets, ["newkid.near"]);
});

test("rankRows local: behaves like reputation (geo filter happens upstream)", () => {
  const r = rankRows(ROWS, "local");
  assert.equal(r[0].agent_owner_wallet, "topgun.near");
});

test("matchAgents returns empty for missing vertical without touching db", async () => {
  let called = false;
  const fakeDb = { query: async () => { called = true; return { rows: [] }; } };
  const r = await matchAgents({ vertical: null, db: fakeDb });
  assert.deepEqual(r, []);
  assert.equal(called, false);
});

test("matchAgents passes expanded vertical aliases as the first param", async () => {
  let captured;
  const fakeDb = {
    query: async (sql, params) => { captured = { sql, params }; return { rows: ROWS }; },
  };
  const r = await matchAgents({ vertical: "automotive", db: fakeDb });
  assert.ok(Array.isArray(captured.params[0]));
  assert.ok(captured.params[0].includes("car-sales"));
  assert.equal(r.length, ROWS.length);
});

test("matchAgents falls back to reputation sort on unknown sort string", async () => {
  let captured;
  const fakeDb = {
    query: async (sql, params) => { captured = { sql, params }; return { rows: [] }; },
  };
  await matchAgents({ vertical: "automotive", sort: "lolwut", db: fakeDb });
  assert.match(captured.sql, /ORDER BY reputation_score DESC/);
});

test("matchAgents caps limit at 100", async () => {
  let captured;
  const fakeDb = {
    query: async (sql, params) => { captured = { sql, params }; return { rows: [] }; },
  };
  await matchAgents({ vertical: "automotive", limit: 9999, db: fakeDb });
  assert.equal(captured.params[captured.params.length - 1], 100);
});
