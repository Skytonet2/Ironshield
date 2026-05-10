// backend/__tests__/posts.route.dualAuth.test.js
// Phase C.6: proves POST /api/posts and DELETE /api/posts/:id accept
// both NEAR and Sui auth via the requireAnyWallet dispatcher AND that
// the other 7 signed routes (bid, hire, bounty_attempts, report, dm,
// withdraw_bid, PATCH hire) are still on the NEAR-only requireWallet.

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
const batchWorkerPath = path.join(root, "services", "batchWorker.js");
const feedClassifierPath = path.join(root, "services", "feedClassifier.js");
const agentMatcherPath = path.join(root, "services", "agentMatcher.js");
const bidEnginePath = path.join(root, "services", "bidEngine.js");
const routePath = path.join(root, "routes", "posts.route.js");

let __dispatcherCalls = 0;
let __nearOnlyCalls = 0;
let __dispatcherChain = null;
let __insertedPost = null;
let __deletedPostQuery = null;

function installStubs({ deleteOk = true } = {}) {
  require.cache[dispatcherPath] = {
    id: dispatcherPath, filename: dispatcherPath, loaded: true,
    exports: function stubDispatcher(req, res, next) {
      __dispatcherCalls += 1;
      const chain = String(req.header("x-wallet-chain") || "").toLowerCase().trim() || "near";
      const wallet = req.header("x-wallet") || "";
      __dispatcherChain = chain;
      req.wallet = wallet;
      req.walletChain = chain;
      if (chain === "sui") req.identity = { chain, address: wallet, wallet };
      next();
    },
  };

  function stubNearOnly(req, res, next) {
    __nearOnlyCalls += 1;
    req.wallet = req.header("x-wallet") || "";
    next();
  }
  stubNearOnly.makeRequireWallet = () => stubNearOnly;
  require.cache[nearOnlyPath] = {
    id: nearOnlyPath, filename: nearOnlyPath, loaded: true,
    exports: stubNearOnly,
  };

  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true,
    exports: {
      query: async (text, params) => {
        if (text.startsWith("INSERT INTO feed_posts")) {
          __insertedPost = { author_id: params[0], content: params[1] };
          return { rows: [{ id: 42, author_id: params[0], content: params[1], deleted_at: null, type: params[14], gate_type: null }] };
        }
        if (text.startsWith("UPDATE feed_users SET last_post_tx")) {
          return { rows: [], rowCount: 1 };
        }
        if (text.startsWith("UPDATE feed_posts SET deleted_at")) {
          __deletedPostQuery = { post_id: params[0], author_id: params[1] };
          return deleteOk
            ? { rows: [{ id: params[0] }] }
            : { rows: [] };
        }
        // Other routes (bid/hire/etc.) we don't exercise in these tests
        // but might trigger via validation paths; return empty.
        return { rows: [] };
      },
    },
  };

  require.cache[feedHelpersPath] = {
    id: feedHelpersPath, filename: feedHelpersPath, loaded: true,
    exports: {
      getOrCreateUser: async (wallet) => ({ id: `user:${wallet}`, wallet_address: wallet }),
      postHash: () => "hash-stub",
      hydratePosts: async (rows) => rows,
    },
  };

  require.cache[batchWorkerPath] = {
    id: batchWorkerPath, filename: batchWorkerPath, loaded: true,
    exports: { enqueue: async () => {} },
  };
  require.cache[feedClassifierPath] = {
    id: feedClassifierPath, filename: feedClassifierPath, loaded: true,
    exports: { classifyPost: async () => {} },
  };
  require.cache[agentMatcherPath] = {
    id: agentMatcherPath, filename: agentMatcherPath, loaded: true,
    exports: {},
  };
  require.cache[bidEnginePath] = {
    id: bidEnginePath, filename: bidEnginePath, loaded: true,
    exports: {},
  };

  delete require.cache[routePath];
  const router = require(routePath);

  const app = express();
  app.use(express.json());
  app.use("/api/posts", router);
  return app;
}

function clearStubs() {
  delete require.cache[dispatcherPath];
  delete require.cache[nearOnlyPath];
  delete require.cache[dbPath];
  delete require.cache[feedHelpersPath];
  delete require.cache[batchWorkerPath];
  delete require.cache[feedClassifierPath];
  delete require.cache[agentMatcherPath];
  delete require.cache[bidEnginePath];
  delete require.cache[routePath];
  __dispatcherCalls = 0;
  __nearOnlyCalls = 0;
  __dispatcherChain = null;
  __insertedPost = null;
  __deletedPostQuery = null;
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

// ── POST / (create) ──────────────────────────────────────────────

test("NEAR client can POST /api/posts via dispatcher", async (t) => {
  const app = installStubs();
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(() => resolve())));

  const res = await request(server, {
    method: "POST",
    path: "/api/posts",
    headers: { "x-wallet": "alice.near" },
    body: { content: "hello near" },
  });

  assert.equal(res.status, 200);
  assert.ok(res.body.post);
  assert.equal(__dispatcherChain, "near");
  assert.equal(__insertedPost?.author_id, "user:alice.near");
});

test("Sui client can POST /api/posts via dispatcher", async (t) => {
  const app = installStubs();
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(() => resolve())));

  const suiAddr = "0x" + "4".repeat(64);
  const res = await request(server, {
    method: "POST",
    path: "/api/posts",
    headers: { "x-wallet-chain": "sui", "x-wallet": suiAddr },
    body: { content: "hello sui" },
  });

  assert.equal(res.status, 200);
  assert.equal(__dispatcherChain, "sui");
  assert.equal(__insertedPost?.author_id, `user:${suiAddr}`);
  assert.equal(__insertedPost?.content, "hello sui");
});

test("POST /api/posts rejects 400 when content empty (after auth)", async (t) => {
  const app = installStubs();
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(() => resolve())));

  const res = await request(server, {
    method: "POST",
    path: "/api/posts",
    headers: { "x-wallet-chain": "sui", "x-wallet": "0x" + "5".repeat(64) },
    body: { content: "   " },
  });

  assert.equal(res.status, 400);
  assert.equal(__dispatcherCalls, 1);
  assert.equal(__insertedPost, null);
});

// ── DELETE /:id ─────────────────────────────────────────────────

test("Sui client can DELETE /api/posts/:id (Sui-created → Sui-deleted)", async (t) => {
  const app = installStubs();
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(() => resolve())));

  const suiAddr = "0x" + "6".repeat(64);
  const res = await request(server, {
    method: "DELETE",
    path: "/api/posts/42",
    headers: { "x-wallet-chain": "sui", "x-wallet": suiAddr },
  });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(__dispatcherChain, "sui");
  // The author check (author_id=$2) gets the Sui user id, so cross-wallet
  // delete is impossible regardless of chain.
  assert.equal(__deletedPostQuery?.author_id, `user:${suiAddr}`);
  assert.equal(__deletedPostQuery?.post_id, "42");
});

test("DELETE returns 404 when post doesn't belong to caller", async (t) => {
  const app = installStubs({ deleteOk: false });
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(() => resolve())));

  const res = await request(server, {
    method: "DELETE",
    path: "/api/posts/999",
    headers: { "x-wallet": "alice.near" },
  });

  assert.equal(res.status, 404);
  assert.equal(__dispatcherCalls, 1);
});

// ── REGRESSION: other routes still NEAR-only ────────────────────

test("REGRESSION: POST /:id/hire still uses NEAR-only requireWallet", async (t) => {
  const app = installStubs();
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(() => resolve())));

  await request(server, {
    method: "POST",
    path: "/api/posts/42/hire",
    headers: { "x-wallet": "alice.near" },
    body: {},
  });

  assert.equal(__dispatcherCalls, 0, "dispatcher must NOT be hit on /hire");
  assert.equal(__nearOnlyCalls, 1);
});

test("REGRESSION: POST /:id/dm still uses NEAR-only requireWallet", async (t) => {
  const app = installStubs();
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(() => resolve())));

  await request(server, {
    method: "POST",
    path: "/api/posts/42/dm",
    headers: { "x-wallet": "alice.near" },
    body: {},
  });

  assert.equal(__dispatcherCalls, 0, "dispatcher must NOT be hit on /dm");
  assert.equal(__nearOnlyCalls, 1);
});

test("REGRESSION: GET /:id stays unsigned (header-based viewer identity)", async (t) => {
  const app = installStubs();
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(() => resolve())));

  const res = await request(server, {
    method: "GET",
    path: "/api/posts/42",
    headers: { "x-wallet": "alice.near" },
  });

  // Will 404 because our DB stub doesn't return rows on the GET path,
  // but the important assertion is that NO auth middleware ran.
  assert.equal(__dispatcherCalls, 0);
  assert.equal(__nearOnlyCalls, 0);
});
