// backend/__tests__/tips.route.dualAuth.test.js
// Phase C.5: proves POST /api/tips accepts both NEAR and Sui auth
// via the requireAnyWallet dispatcher. Same require.cache injection
// pattern as the prior pilot tests.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const http = require("node:http");
const express = require("express");

const root = path.resolve(__dirname, "..");
const dispatcherPath = path.join(root, "middleware", "requireAnyWallet.js");
const dbPath = path.join(root, "db", "client.js");
const feedHelpersPath = path.join(root, "services", "feedHelpers.js");
const pushNotifyPath = path.join(root, "services", "pushNotify.js");
const routePath = path.join(root, "routes", "tips.route.js");

let __dispatcherCalls = 0;
let __dispatcherChain = null;
let __insertedTip = null;

function installStubs({ dispatcher = "ok", postLookup = { exists: true, authorId: "user:bob.near" } } = {}) {
  require.cache[dispatcherPath] = {
    id: dispatcherPath, filename: dispatcherPath, loaded: true,
    exports: function stubDispatcher(req, res, next) {
      __dispatcherCalls += 1;
      if (dispatcher !== "ok") return res.status(401).json(dispatcher);
      const chain = String(req.header("x-wallet-chain") || "").toLowerCase().trim() || "near";
      const wallet = req.header("x-wallet") || "";
      __dispatcherChain = chain;
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
        if (text.startsWith("SELECT id, author_id FROM feed_posts")) {
          return postLookup.exists
            ? { rows: [{ id: params[0], author_id: postLookup.authorId }] }
            : { rows: [] };
        }
        if (text.startsWith("\n      SELECT 1 FROM feed_tips") || text.includes("SELECT 1 FROM feed_tips")) {
          return { rows: [] }; // no dupe
        }
        if (text.startsWith("\n      INSERT INTO feed_tips") || text.includes("INSERT INTO feed_tips")) {
          __insertedTip = {
            post_id: params[0],
            tipper_id: params[1],
            author_id: params[2],
            token_contract: params[3],
            tx_hash: params[11],
          };
          return { rows: [{ id: 999, created_at: new Date() }] };
        }
        throw new Error("unexpected query: " + text.slice(0, 60));
      },
    },
  };

  require.cache[feedHelpersPath] = {
    id: feedHelpersPath, filename: feedHelpersPath, loaded: true,
    exports: {
      // Mark created_at to "long ago" so isSeasoned() returns true and
      // the seasoned-vs-fresh branch is exercised consistently.
      getOrCreateUser: async (wallet) => ({
        id: `user:${wallet}`,
        wallet_address: wallet,
        created_at: new Date(Date.now() - 30 * 86400 * 1000),
      }),
    },
  };

  require.cache[pushNotifyPath] = {
    id: pushNotifyPath, filename: pushNotifyPath, loaded: true,
    exports: {
      createAndPush: async () => {},
    },
  };

  delete require.cache[routePath];
  const router = require(routePath);

  const app = express();
  app.use(express.json());
  app.use("/api/tips", router);
  return app;
}

function clearStubs() {
  delete require.cache[dispatcherPath];
  delete require.cache[dbPath];
  delete require.cache[feedHelpersPath];
  delete require.cache[pushNotifyPath];
  delete require.cache[routePath];
  __dispatcherCalls = 0;
  __dispatcherChain = null;
  __insertedTip = null;
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

const validBody = {
  postId: "post-1",
  tokenContract: "wrap.near",
  tokenSymbol: "wNEAR",
  tokenDecimals: 24,
  amountBase: "1000000000000000000000000",
  amountHuman: "1.0",
  amountUsd: "5.0",
  txHash: "near-tx-abc",
};

test("NEAR client can POST /api/tips via dispatcher", async (t) => {
  const app = installStubs();
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => server.close());

  const res = await request(server, {
    method: "POST",
    path: "/api/tips",
    headers: { "x-wallet": "alice.near" },
    body: validBody,
  });

  assert.equal(res.status, 200);
  assert.ok(res.body.ok);
  assert.equal(__dispatcherChain, "near");
  assert.equal(__insertedTip?.tipper_id, "user:alice.near");
  assert.equal(__insertedTip?.tx_hash, "near-tx-abc");
});

test("Sui client can POST /api/tips via dispatcher (Sui txHash stored opaquely)", async (t) => {
  const app = installStubs();
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => server.close());

  const suiAddr = "0x" + "1".repeat(64);
  const suiTip = {
    ...validBody,
    tokenContract: "0x2::sui::SUI",
    tokenSymbol: "SUI",
    tokenDecimals: 9,
    amountBase: "1000000000",
    txHash: "sui-tx-xyz",
  };

  const res = await request(server, {
    method: "POST",
    path: "/api/tips",
    headers: { "x-wallet-chain": "sui", "x-wallet": suiAddr },
    body: suiTip,
  });

  assert.equal(res.status, 200);
  assert.equal(__dispatcherChain, "sui");
  assert.equal(__insertedTip?.tipper_id, `user:${suiAddr}`);
  assert.equal(__insertedTip?.token_contract, "0x2::sui::SUI");
  assert.equal(__insertedTip?.tx_hash, "sui-tx-xyz");
});

test("/api/tips rejects 400 when required body fields missing (after auth)", async (t) => {
  const app = installStubs();
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => server.close());

  const res = await request(server, {
    method: "POST",
    path: "/api/tips",
    headers: { "x-wallet-chain": "sui", "x-wallet": "0x" + "2".repeat(64) },
    body: { postId: "p1" }, // missing tokenContract + amountBase
  });

  assert.equal(res.status, 400);
  assert.equal(__dispatcherCalls, 1, "auth should have run");
  assert.equal(__insertedTip, null, "tip should NOT have been inserted");
});

test("/api/tips returns 404 when post does not exist (after auth)", async (t) => {
  const app = installStubs({ postLookup: { exists: false } });
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => server.close());

  const res = await request(server, {
    method: "POST",
    path: "/api/tips",
    headers: { "x-wallet-chain": "sui", "x-wallet": "0x" + "3".repeat(64) },
    body: validBody,
  });

  assert.equal(res.status, 404);
  assert.equal(__dispatcherCalls, 1);
  assert.equal(__insertedTip, null);
});

test("/api/tips auth failure short-circuits before any DB write", async (t) => {
  const app = installStubs({
    dispatcher: { error: "bad sig", code: "bad-sig" },
  });
  t.after(() => clearStubs());
  const server = await listen(app);
  t.after(() => server.close());

  const res = await request(server, {
    method: "POST",
    path: "/api/tips",
    headers: { "x-wallet": "alice.near" },
    body: validBody,
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.code, "bad-sig");
  assert.equal(__insertedTip, null);
});
