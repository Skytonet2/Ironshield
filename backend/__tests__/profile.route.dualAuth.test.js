// backend/__tests__/profile.route.dualAuth.test.js
// Phase C.4: proves /api/profile/dm-pubkey and /grant-delegate accept
// both NEAR and Sui auth, AND that /onboard / PATCH / / /upload are
// still on the NEAR-only requireWallet middleware (regression guard
// against accidental over-rollout).

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const http = require("node:http");
const express = require("express");

const root = path.resolve(__dirname, "..");
const dispatcherPath = path.join(root, "middleware", "requireAnyWallet.js");
const nearOnlyPath = path.join(root, "middleware", "requireWallet.js");
const dbPath = path.join(root, "db", "client.js");
const feedHelpersPath = path.join(root, "services", "feedHelpers.js");
const routePath = path.join(root, "routes", "profile.route.js");

let __dispatcherCalls = 0;
let __nearOnlyCalls = 0;
let __dispatcherChain = null;
let __dispatcherWallet = null;
let __updatedDmPubkey = null;
let __updatedDelegatePubkey = null;
let __updatedOnboard = null;

function installStubs({ dispatcher = "ok", nearOnly = "ok" } = {}) {
  require.cache[dispatcherPath] = {
    id: dispatcherPath, filename: dispatcherPath, loaded: true,
    exports: function stubDispatcher(req, res, next) {
      __dispatcherCalls += 1;
      if (dispatcher !== "ok") return res.status(401).json(dispatcher);
      const chain = String(req.header("x-wallet-chain") || "").toLowerCase().trim() || "near";
      const wallet = req.header("x-wallet") || "";
      __dispatcherChain = chain;
      __dispatcherWallet = wallet;
      req.wallet = wallet;
      req.walletChain = chain;
      if (chain === "sui") req.identity = { chain, address: wallet, wallet };
      next();
    },
  };

  // The NEAR-only middleware exposes makeRequireWallet AND is itself a
  // function. profile.route.js destructures neither — it just imports the
  // default. Stub it as a callable (function) that bypasses sig checks.
  function stubNearOnly(req, res, next) {
    __nearOnlyCalls += 1;
    if (nearOnly !== "ok") return res.status(401).json(nearOnly);
    req.wallet = req.header("x-wallet") || "";
    next();
  }
  // Match the real export shape so any consumer using .makeRequireWallet
  // still works (profile.route.js doesn't, but be safe).
  stubNearOnly.makeRequireWallet = () => stubNearOnly;
  require.cache[nearOnlyPath] = {
    id: nearOnlyPath, filename: nearOnlyPath, loaded: true,
    exports: stubNearOnly,
  };

  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true,
    exports: {
      query: async (text, params) => {
        if (text.startsWith("UPDATE feed_users SET dm_pubkey")) {
          __updatedDmPubkey = { user_id: params[1], pubkey: params[0] };
          return { rows: [], rowCount: 1 };
        }
        if (text.startsWith("UPDATE feed_users SET delegate_pubkey")) {
          __updatedDelegatePubkey = { user_id: params[1], pubkey: params[0] };
          return { rows: [], rowCount: 1 };
        }
        if (text.startsWith("UPDATE feed_users SET\n         username")) {
          __updatedOnboard = { user_id: params[0], username: params[1] };
          return { rows: [{ id: params[0], username: params[1] }], rowCount: 1 };
        }
        throw new Error("unexpected query: " + text.slice(0, 60));
      },
    },
  };

  require.cache[feedHelpersPath] = {
    id: feedHelpersPath, filename: feedHelpersPath, loaded: true,
    exports: {
      getOrCreateUser: async (wallet) => ({ id: `user:${wallet}`, wallet_address: wallet }),
      hydratePosts: async (rows) => rows,
    },
  };

  delete require.cache[routePath];
  const router = require(routePath);

  const app = express();
  app.use(express.json());
  app.use("/api/profile", router);
  return app;
}

function clearStubs() {
  delete require.cache[dispatcherPath];
  delete require.cache[nearOnlyPath];
  delete require.cache[dbPath];
  delete require.cache[feedHelpersPath];
  delete require.cache[routePath];
  __dispatcherCalls = 0;
  __nearOnlyCalls = 0;
  __dispatcherChain = null;
  __dispatcherWallet = null;
  __updatedDmPubkey = null;
  __updatedDelegatePubkey = null;
  __updatedOnboard = null;
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

// ── /dm-pubkey ────────────────────────────────────────────────────

test("NEAR client can POST /dm-pubkey via dispatcher", async (t) => {
  const app = installStubs();
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => server.close());

  const res = await request(server, {
    method: "POST",
    path: "/api/profile/dm-pubkey",
    headers: { "x-wallet": "alice.near" },
    body: { pubkey: "near-pubkey-base64" },
  });

  assert.equal(res.status, 200);
  assert.equal(__dispatcherCalls, 1);
  assert.equal(__dispatcherChain, "near");
  assert.equal(__updatedDmPubkey?.pubkey, "near-pubkey-base64");
  assert.equal(__updatedDmPubkey?.user_id, "user:alice.near");
});

test("Sui client can POST /dm-pubkey via dispatcher", async (t) => {
  const app = installStubs();
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => server.close());

  const suiAddr = "0x" + "d".repeat(64);
  const res = await request(server, {
    method: "POST",
    path: "/api/profile/dm-pubkey",
    headers: { "x-wallet-chain": "sui", "x-wallet": suiAddr },
    body: { pubkey: "sui-pubkey-base64" },
  });

  assert.equal(res.status, 200);
  assert.equal(__dispatcherChain, "sui");
  assert.equal(__updatedDmPubkey?.user_id, `user:${suiAddr}`);
});

test("/dm-pubkey rejects when pubkey body field missing (after auth)", async (t) => {
  const app = installStubs();
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => server.close());

  const res = await request(server, {
    method: "POST",
    path: "/api/profile/dm-pubkey",
    headers: { "x-wallet-chain": "sui", "x-wallet": "0x" + "e".repeat(64) },
    body: {},
  });

  assert.equal(res.status, 400);
  assert.equal(res.body.error, "pubkey required");
  // Dispatcher was reached (auth succeeded), DB was not touched
  assert.equal(__dispatcherCalls, 1);
  assert.equal(__updatedDmPubkey, null);
});

// ── /grant-delegate ───────────────────────────────────────────────

test("NEAR client can POST /grant-delegate via dispatcher", async (t) => {
  const app = installStubs();
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => server.close());

  const res = await request(server, {
    method: "POST",
    path: "/api/profile/grant-delegate",
    headers: { "x-wallet": "alice.near" },
    body: { pubkey: "near-delegate" },
  });

  assert.equal(res.status, 200);
  assert.equal(__dispatcherChain, "near");
  assert.equal(__updatedDelegatePubkey?.pubkey, "near-delegate");
});

test("Sui client can POST /grant-delegate via dispatcher", async (t) => {
  const app = installStubs();
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => server.close());

  const suiAddr = "0x" + "f".repeat(64);
  const res = await request(server, {
    method: "POST",
    path: "/api/profile/grant-delegate",
    headers: { "x-wallet-chain": "sui", "x-wallet": suiAddr },
    body: { pubkey: "sui-delegate" },
  });

  assert.equal(res.status, 200);
  assert.equal(__dispatcherChain, "sui");
  assert.equal(__updatedDelegatePubkey?.user_id, `user:${suiAddr}`);
});

// ── Regression: /onboard still on NEAR-only ──────────────────────

test("/onboard is still on NEAR-only requireWallet (not the dispatcher)", async (t) => {
  const app = installStubs();
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => server.close());

  const res = await request(server, {
    method: "POST",
    path: "/api/profile/onboard",
    headers: { "x-wallet": "alice.near" },
    body: { username: "alicex", displayName: "Alice X" },
  });

  // Auth succeeded (stubbed), business logic ran
  assert.equal(res.status, 200);
  // Critically: dispatcher was NOT invoked, NEAR-only WAS
  assert.equal(__dispatcherCalls, 0, "dispatcher should NOT have been called for /onboard");
  assert.equal(__nearOnlyCalls, 1, "NEAR-only middleware should have handled /onboard");
});

test("/upload is still on NEAR-only requireWallet (not the dispatcher)", async (t) => {
  // Stub Cloudinary env so the route doesn't 503
  const prev = {
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  };
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "test-key";
  process.env.CLOUDINARY_API_SECRET = "test-secret";
  t.after(() => {
    if (prev.CLOUDINARY_CLOUD_NAME === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
    else process.env.CLOUDINARY_CLOUD_NAME = prev.CLOUDINARY_CLOUD_NAME;
    if (prev.CLOUDINARY_API_KEY === undefined) delete process.env.CLOUDINARY_API_KEY;
    else process.env.CLOUDINARY_API_KEY = prev.CLOUDINARY_API_KEY;
    if (prev.CLOUDINARY_API_SECRET === undefined) delete process.env.CLOUDINARY_API_SECRET;
    else process.env.CLOUDINARY_API_SECRET = prev.CLOUDINARY_API_SECRET;
  });

  const app = installStubs();
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => server.close());

  const res = await request(server, {
    method: "POST",
    path: "/api/profile/upload",
    headers: { "x-wallet": "alice.near" },
  });

  assert.equal(res.status, 200);
  assert.equal(__dispatcherCalls, 0, "dispatcher should NOT have been called for /upload");
  assert.equal(__nearOnlyCalls, 1);
});
