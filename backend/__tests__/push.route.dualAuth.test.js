// backend/__tests__/push.route.dualAuth.test.js
// Phase C.2: end-to-end proof that /api/push/* now accepts both NEAR
// and Sui auth. Uses require.cache injection to stub requireAnyWallet
// + the DB + pushNotify so we exercise the express plumbing without
// a real wallet, signature, or Postgres.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const http = require("node:http");
const express = require("express");

// ── module-cache stubs ────────────────────────────────────────────
const root = path.resolve(__dirname, "..");
const dispatcherPath = path.join(root, "middleware", "requireAnyWallet.js");
const dbPath = path.join(root, "db", "client.js");
const pushNotifyPath = path.join(root, "services", "pushNotify.js");
const feedHelpersPath = path.join(root, "services", "feedHelpers.js");

// Track what wallet the upstream stub set, so the route handler picks it up.
let __chainSeenByDispatcher = null;
let __walletSeenByDispatcher = null;

function installStubs({ chainBehavior } = {}) {
  // chainBehavior: ({ chain, address }) => "ok" | { error, code }
  require.cache[dispatcherPath] = {
    id: dispatcherPath,
    filename: dispatcherPath,
    loaded: true,
    exports: function stubDispatcher(req, res, next) {
      const chain = String(req.header("x-wallet-chain") || "").toLowerCase().trim() || "near";
      const wallet = req.header("x-wallet") || "";
      const verdict = chainBehavior({ chain, address: wallet });
      if (verdict !== "ok") {
        return res.status(401).json({ ...verdict });
      }
      __chainSeenByDispatcher = chain;
      __walletSeenByDispatcher = wallet;
      req.wallet = wallet;
      req.walletChain = chain;
      if (chain === "sui") {
        req.identity = { chain, address: wallet, wallet };
      }
      next();
    },
  };

  // Fake DB — minimal surface push.route.js exercises.
  let pushedSubscriptions = [];
  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true,
    exports: {
      query: async (text, params) => {
        if (text.startsWith("INSERT INTO feed_push_subscriptions")) {
          pushedSubscriptions.push({ user_id: params[0], endpoint: params[1] });
          return { rows: [], rowCount: 1 };
        }
        if (text.startsWith("SELECT COUNT(*)")) {
          const n = pushedSubscriptions.filter((s) => s.user_id === params[0]).length;
          return { rows: [{ n }], rowCount: 1 };
        }
        if (text.startsWith("DELETE FROM feed_push_subscriptions")) {
          pushedSubscriptions = pushedSubscriptions.filter((s) => s.endpoint !== params[0]);
          return { rows: [], rowCount: 1 };
        }
        throw new Error("unexpected query: " + text);
      },
      __pushedSubscriptions: () => pushedSubscriptions,
    },
  };

  // Fake feedHelpers.getOrCreateUser — derive a synthetic user_id from wallet.
  require.cache[feedHelpersPath] = {
    id: feedHelpersPath, filename: feedHelpersPath, loaded: true,
    exports: {
      getOrCreateUser: async (wallet) => ({ id: `user:${wallet}`, wallet_address: wallet }),
    },
  };

  // Fake pushNotify
  let pushedNotifications = [];
  require.cache[pushNotifyPath] = {
    id: pushNotifyPath, filename: pushNotifyPath, loaded: true,
    exports: {
      notifyUser: async (user_id, payload) => { pushedNotifications.push({ user_id, payload }); },
      __pushed: () => pushedNotifications,
    },
  };

  // Force a fresh require of the route module so it picks up the stubbed deps.
  const routePath = path.join(root, "routes", "push.route.js");
  delete require.cache[routePath];
  const router = require(routePath);

  const app = express();
  app.use(express.json());
  app.use("/api/push", router);
  return app;
}

function clearStubs() {
  delete require.cache[dispatcherPath];
  delete require.cache[dbPath];
  delete require.cache[pushNotifyPath];
  delete require.cache[feedHelpersPath];
  delete require.cache[path.join(root, "routes", "push.route.js")];
  __chainSeenByDispatcher = null;
  __walletSeenByDispatcher = null;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function request(server, { method, path: url, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request(
      {
        method,
        host: "127.0.0.1",
        port,
        path: url,
        headers: { "content-type": "application/json", ...headers },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try { json = JSON.parse(text); } catch { /* non-JSON ok */ }
          resolve({ status: res.statusCode, body: json, raw: text });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

test("NEAR client (no chain header) can /subscribe through dual-auth dispatcher", async (t) => {
  const app = installStubs({ chainBehavior: () => "ok" });
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => server.close());

  const res = await request(server, {
    method: "POST",
    path: "/api/push/subscribe",
    headers: { "x-wallet": "alice.near" },
    body: { subscription: { endpoint: "https://push.example/abc", keys: { p256dh: "x", auth: "y" } } },
  });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(__chainSeenByDispatcher, "near");
  assert.equal(__walletSeenByDispatcher, "alice.near");
});

test("Sui client (x-wallet-chain: sui) can /subscribe through dual-auth dispatcher", async (t) => {
  const app = installStubs({ chainBehavior: () => "ok" });
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => server.close());

  const suiAddr = "0x" + "a".repeat(64);
  const res = await request(server, {
    method: "POST",
    path: "/api/push/subscribe",
    headers: { "x-wallet-chain": "sui", "x-wallet": suiAddr },
    body: { subscription: { endpoint: "https://push.example/sui", keys: { p256dh: "x", auth: "y" } } },
  });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(__chainSeenByDispatcher, "sui");
  assert.equal(__walletSeenByDispatcher, suiAddr);
});

test("auth failure from dispatcher short-circuits before route handler", async (t) => {
  const app = installStubs({
    chainBehavior: () => ({ error: "bad sig", code: "bad-sig" }),
  });
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => server.close());

  const res = await request(server, {
    method: "POST",
    path: "/api/push/subscribe",
    headers: { "x-wallet": "alice.near" },
    body: { subscription: { endpoint: "https://push.example/abc" } },
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.code, "bad-sig");
});

test("/test endpoint returns 409 when no subscriptions exist for caller", async (t) => {
  const app = installStubs({ chainBehavior: () => "ok" });
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => server.close());

  const res = await request(server, {
    method: "POST",
    path: "/api/push/test",
    headers: { "x-wallet": "alice.near" },
  });

  assert.equal(res.status, 409);
  assert.equal(res.body.reason, "no_subscriptions");
});

test("Sui client can subscribe then test then unsubscribe end-to-end", async (t) => {
  const app = installStubs({ chainBehavior: () => "ok" });
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => server.close());

  const suiAddr = "0x" + "b".repeat(64);
  const headers = { "x-wallet-chain": "sui", "x-wallet": suiAddr };
  const endpoint = "https://push.example/sui-2";

  // 1. Subscribe
  let res = await request(server, {
    method: "POST",
    path: "/api/push/subscribe",
    headers,
    body: { subscription: { endpoint, keys: { p256dh: "x", auth: "y" } } },
  });
  assert.equal(res.status, 200);

  // 2. Test fires
  res = await request(server, {
    method: "POST",
    path: "/api/push/test",
    headers,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.pushedTo, 1);

  // 3. Unsubscribe
  res = await request(server, {
    method: "POST",
    path: "/api/push/unsubscribe",
    headers,
    body: { endpoint },
  });
  assert.equal(res.status, 200);
});
