// backend/__tests__/connectorRefresh.test.js
//
// Unit-tests the worker by mocking credentialStore + the connector
// dispatcher. We don't touch the real DB or fire HTTP — both are
// covered separately.

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.CUSTODIAL_ENCRYPT_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const credentialStore = require("../connectors/credentialStore");
const connectors      = require("../connectors");
const refresher       = require("../services/connectorRefresh");

function withStubs(stubs, fn) {
  const orig = {};
  for (const [k, v] of Object.entries(stubs.cred || {})) {
    orig[`cred.${k}`] = credentialStore[k];
    credentialStore[k] = v;
  }
  for (const [k, v] of Object.entries(stubs.conn || {})) {
    orig[`conn.${k}`] = connectors[k];
    connectors[k] = v;
  }
  return Promise.resolve(fn()).finally(() => {
    for (const key of Object.keys(orig)) {
      const [bucket, name] = key.split(".");
      (bucket === "cred" ? credentialStore : connectors)[name] = orig[key];
    }
  });
}

test("connectorRefresh: skips connectors without a refresh() implementation", async () => {
  let upsertCalls = 0;
  await withStubs(
    {
      cred: {
        findExpiring: async () => [{ user_wallet: "alice.near", connector_name: "linkedin", expires_at: new Date() }],
        upsert:       async () => { upsertCalls++; },
      },
      conn: {
        // The real linkedin connector doesn't expose refresh — this fakes
        // get() returning a connector whose refresh is missing.
        get: () => ({ name: "linkedin", invoke: async () => null }),
      },
    },
    async () => {
      await refresher._tick();
      assert.equal(upsertCalls, 0, "no refresh, no upsert");
    }
  );
});

test("connectorRefresh: calls refresh() and upserts the new payload", async () => {
  const calls = { refresh: 0, upsert: 0 };
  let upsertedWith;
  await withStubs(
    {
      cred: {
        findExpiring: async () => [
          { user_wallet: "alice.near", connector_name: "x", expires_at: new Date(Date.now() + 60_000) },
        ],
        upsert: async (args) => { calls.upsert++; upsertedWith = args; },
      },
      conn: {
        get: (name) => name !== "x" ? null : ({
          name: "x",
          invoke: async () => null,
          refresh: async ({ wallet }) => {
            calls.refresh++;
            assert.equal(wallet, "alice.near");
            return {
              payload: { access_token: "new-tok", refresh_token: "new-refresh" },
              expiresAt: new Date(Date.now() + 7200_000).toISOString(),
            };
          },
        }),
      },
    },
    async () => {
      await refresher._tick();
      assert.equal(calls.refresh, 1);
      assert.equal(calls.upsert, 1);
      assert.equal(upsertedWith.wallet, "alice.near");
      assert.equal(upsertedWith.connector, "x");
      assert.equal(upsertedWith.payload.access_token, "new-tok");
      assert.ok(upsertedWith.expiresAt);
    }
  );
});

test("connectorRefresh: one failing row doesn't stop the rest", async () => {
  const upsertedConnectors = [];
  await withStubs(
    {
      cred: {
        findExpiring: async () => [
          { user_wallet: "alice.near", connector_name: "x",        expires_at: new Date() },
          { user_wallet: "bob.near",   connector_name: "facebook", expires_at: new Date() },
        ],
        upsert: async (args) => { upsertedConnectors.push(args.connector); },
      },
      conn: {
        get: (name) => {
          if (name === "x") {
            return { name: "x", invoke: async () => null, refresh: async () => { throw new Error("upstream 401"); } };
          }
          if (name === "facebook") {
            return {
              name: "facebook",
              invoke: async () => null,
              refresh: async () => ({ payload: { access_token: "fb-new" }, expiresAt: null }),
            };
          }
          return null;
        },
      },
    },
    async () => {
      await refresher._tick();
      assert.deepEqual(upsertedConnectors, ["facebook"], "facebook still refreshed despite x throwing");
    }
  );
});
