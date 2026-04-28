// backend/__tests__/connectors.framework.test.js
// Unit tests for the connector dispatcher (Phase 10 Tier 4).

const test = require("node:test");
const assert = require("node:assert/strict");

const connectors = require("../connectors");

function fakeConnector(over = {}) {
  return {
    name: over.name || "fake",
    capabilities: over.capabilities || ["read"],
    rate_limits: over.rate_limits || { per_minute: 1000, scope: "platform" },
    auth_method: over.auth_method || "api_key",
    invoke: over.invoke || (async (action, ctx) => ({ action, ctx })),
  };
}

test("register: rejects missing name / capabilities / invoke", () => {
  connectors._reset();
  assert.throws(() => connectors.register({}), /string `name`/);
  assert.throws(
    () => connectors.register({ name: "x", capabilities: [], auth_method: "api_key", invoke: () => {} }),
    /capabilities/
  );
  assert.throws(
    () => connectors.register({ name: "x", capabilities: ["read"], auth_method: "api_key" }),
    /invoke/
  );
  assert.throws(
    () => connectors.register({ name: "x", capabilities: ["read"], auth_method: "weird", invoke: () => {} }),
    /auth_method/
  );
});

test("register: rejects duplicate names", () => {
  connectors._reset();
  connectors.register(fakeConnector({ name: "dupe" }));
  assert.throws(() => connectors.register(fakeConnector({ name: "dupe" })), /already registered/);
});

test("invoke: forwards (action, ctx) to the registered module", async () => {
  connectors._reset();
  let received = null;
  connectors.register(fakeConnector({
    name: "echo",
    invoke: async (action, ctx) => { received = { action, ctx }; return "ok"; },
  }));
  const out = await connectors.invoke("echo", "ping", { wallet: "alice.near", params: { x: 1 } });
  assert.equal(out, "ok");
  assert.equal(received.action, "ping");
  assert.equal(received.ctx.wallet, "alice.near");
  assert.deepEqual(received.ctx.params, { x: 1 });
});

test("invoke: throws on unknown connector", async () => {
  connectors._reset();
  await assert.rejects(() => connectors.invoke("ghost", "noop", {}), /unknown connector/);
});

test("list: returns name/capabilities/auth_method for each registered", () => {
  connectors._reset();
  connectors.register(fakeConnector({ name: "a", capabilities: ["read"] }));
  connectors.register(fakeConnector({ name: "b", capabilities: ["write", "monitor"], auth_method: "oauth" }));
  const ls = connectors.list();
  const byName = Object.fromEntries(ls.map((m) => [m.name, m]));
  assert.deepEqual(byName.a.capabilities, ["read"]);
  assert.equal(byName.b.auth_method, "oauth");
  assert.deepEqual(byName.b.capabilities, ["write", "monitor"]);
});
