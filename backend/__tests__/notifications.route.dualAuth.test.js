// backend/__tests__/notifications.route.dualAuth.test.js
// Phase C.3: end-to-end proof that POST /api/notifications/read-all
// accepts both NEAR and Sui auth via the requireAnyWallet dispatcher.
//
// Same pattern as push.route.dualAuth.test.js — require.cache injection
// stubs the dispatcher + db + feedHelpers; mounts the route on an
// ephemeral express app and fires real HTTP via node:http.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const http = require("node:http");
const express = require("express");

const root = path.resolve(__dirname, "..");
const dispatcherPath = path.join(root, "middleware", "requireAnyWallet.js");
const dbPath = path.join(root, "db", "client.js");
const feedHelpersPath = path.join(root, "services", "feedHelpers.js");
const routePath = path.join(root, "routes", "notifications.route.js");

let __chainSeen = null;
let __walletSeen = null;
let __markedReadFor = null;

function installStubs({ chainBehavior } = {}) {
  require.cache[dispatcherPath] = {
    id: dispatcherPath, filename: dispatcherPath, loaded: true,
    exports: function stubDispatcher(req, res, next) {
      const chain = String(req.header("x-wallet-chain") || "").toLowerCase().trim() || "near";
      const wallet = req.header("x-wallet") || "";
      const verdict = chainBehavior({ chain, address: wallet });
      if (verdict !== "ok") return res.status(401).json(verdict);
      __chainSeen = chain;
      __walletSeen = wallet;
      req.wallet = wallet;
      req.walletChain = chain;
      if (chain === "sui") req.identity = { chain, address: wallet, wallet };
      next();
    },
  };

  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true,
    exports: {
      query: async (text, params) => {
        if (text.startsWith("SELECT n.*")) {
          // GET / branch — return one mock notification row
          return { rows: [{ id: 1, user_id: params[0], created_at: new Date(), read_at: null }] };
        }
        if (text.startsWith("UPDATE feed_notifications SET read_at")) {
          __markedReadFor = params[0];
          return { rows: [], rowCount: 1 };
        }
        throw new Error("unexpected query: " + text);
      },
    },
  };

  require.cache[feedHelpersPath] = {
    id: feedHelpersPath, filename: feedHelpersPath, loaded: true,
    exports: {
      getOrCreateUser: async (wallet) => ({ id: `user:${wallet}`, wallet_address: wallet }),
    },
  };

  delete require.cache[routePath];
  const router = require(routePath);

  const app = express();
  app.use(express.json());
  app.use("/api/notifications", router);
  return app;
}

function clearStubs() {
  delete require.cache[dispatcherPath];
  delete require.cache[dbPath];
  delete require.cache[feedHelpersPath];
  delete require.cache[routePath];
  __chainSeen = null;
  __walletSeen = null;
  __markedReadFor = null;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function request(server, { method, path: url, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request(
      { method, host: "127.0.0.1", port, path: url, headers: { "content-type": "application/json", ...headers } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try { json = JSON.parse(text); } catch {}
          resolve({ status: res.statusCode, body: json });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

test("NEAR client (no chain header) can /read-all", async (t) => {
  const app = installStubs({ chainBehavior: () => "ok" });
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => server.close());

  const res = await request(server, {
    method: "POST",
    path: "/api/notifications/read-all",
    headers: { "x-wallet": "alice.near" },
  });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(__chainSeen, "near");
  assert.equal(__markedReadFor, "user:alice.near");
});

test("Sui client (x-wallet-chain: sui) can /read-all", async (t) => {
  const app = installStubs({ chainBehavior: () => "ok" });
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => server.close());

  const suiAddr = "0x" + "c".repeat(64);
  const res = await request(server, {
    method: "POST",
    path: "/api/notifications/read-all",
    headers: { "x-wallet-chain": "sui", "x-wallet": suiAddr },
  });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(__chainSeen, "sui");
  assert.equal(__markedReadFor, `user:${suiAddr}`);
});

test("auth failure short-circuits before route handler", async (t) => {
  const app = installStubs({
    chainBehavior: () => ({ error: "bad sig", code: "bad-sig" }),
  });
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => server.close());

  const res = await request(server, {
    method: "POST",
    path: "/api/notifications/read-all",
    headers: { "x-wallet": "alice.near" },
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.code, "bad-sig");
  assert.equal(__markedReadFor, null);
});

test("GET / remains unsigned (header-based identity, no dispatcher)", async (t) => {
  const app = installStubs({
    // If the dispatcher is hit on GET, this would refuse
    chainBehavior: () => ({ error: "should not hit", code: "wrong" }),
  });
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => server.close());

  const res = await request(server, {
    method: "GET",
    path: "/api/notifications/",
    headers: { "x-wallet": "alice.near" },
  });

  // GET is unsigned — should succeed without ever invoking the dispatcher
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.notifications));
  assert.equal(__chainSeen, null); // dispatcher was never called
});
