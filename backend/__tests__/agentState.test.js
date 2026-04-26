// backend/__tests__/agentState.test.js
// Unit tests for the agent_state KV wrapper. Mocks the db client so
// tests run without Postgres.

const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

// Hijack the relative require("./client") inside agentState.js by
// mutating Module._cache after our own resolution.
const path = require("node:path");
const clientPath = path.resolve(__dirname, "..", "db", "client.js");

const fakeRows = new Map();
const fakeDb = {
  async query(sql, params) {
    if (sql.startsWith("SELECT value FROM agent_state")) {
      const r = fakeRows.get(params[0]);
      return { rows: r === undefined ? [] : [{ value: r }] };
    }
    if (sql.startsWith("INSERT INTO agent_state")) {
      fakeRows.set(params[0], JSON.parse(params[1]));
      return { rowCount: 1 };
    }
    throw new Error("unexpected: " + sql);
  },
};

require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true,
  exports: fakeDb,
};

const agentState = require("../db/agentState");

test("set then get round-trips JSONB", async () => {
  fakeRows.clear();
  await agentState.set("activePrompt", { content: "hi", proposalId: 7 });
  const v = await agentState.get("activePrompt");
  assert.deepEqual(v, { content: "hi", proposalId: 7 });
});

test("get on missing key returns null", async () => {
  fakeRows.clear();
  const v = await agentState.get("does-not-exist");
  assert.equal(v, null);
});

test("getCached returns null on cold cache and primes async", async () => {
  fakeRows.clear();
  fakeRows.set("activeMission", { content: "scan posts" });
  // First call: cold cache → null, but kicks off background refresh.
  assert.equal(agentState.getCached("activeMission", 60_000), null);
  // Wait a tick for the inflight read to land.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  // Second call within TTL serves from cache.
  assert.deepEqual(agentState.getCached("activeMission", 60_000), { content: "scan posts" });
});

test("set busts the cache so the next read sees the new value", async () => {
  fakeRows.clear();
  fakeRows.set("activePrompt", { content: "v1" });
  // Prime cache.
  await agentState.prime("activePrompt");
  assert.deepEqual(agentState.getCached("activePrompt", 60_000), { content: "v1" });
  // Set a new value — also writes through the fake db AND clears cache.
  await agentState.set("activePrompt", { content: "v2" });
  // Cold cache after set; next call returns null and refreshes.
  assert.equal(agentState.getCached("activePrompt", 60_000), null);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(agentState.getCached("activePrompt", 60_000), { content: "v2" });
});

test("prime() awaits and stores synchronously-readable value", async () => {
  fakeRows.clear();
  fakeRows.set("listenerState", { lastSeenId: 42 });
  await agentState.prime("listenerState");
  assert.deepEqual(agentState.getCached("listenerState", 60_000), { lastSeenId: 42 });
});
