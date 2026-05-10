// backend/__tests__/requireAnyWallet.test.js
// Unit tests for the Phase C dual-auth dispatcher.

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeRequireAnyWallet } = require("../middleware/requireAnyWallet");

function makeReq({ chain, body = "" } = {}) {
  const headers = {};
  if (chain) headers["x-wallet-chain"] = chain;
  return {
    method: "POST",
    originalUrl: "/api/posts",
    rawBody: Buffer.from(body),
    header: (name) => headers[name.toLowerCase()],
  };
}

function makeRes() {
  const r = {
    statusCode: 200,
    body: null,
    status(c) { r.statusCode = c; return r; },
    json(b) { r.body = b; return r; },
  };
  return r;
}

function spy() {
  const calls = [];
  const fn = (...args) => calls.push(args);
  fn.calls = calls;
  return fn;
}

function fakeNearMiddleware(behavior) {
  // behavior: "ok" | "fail-401"
  return (req, res, next) => {
    if (behavior === "fail-401") {
      res.status(401).json({ error: "near sig bad", code: "bad-sig" });
      return;
    }
    req.wallet = "alice.near";
    next();
  };
}

function fakeSuiMiddleware(behavior) {
  return (req, res, next) => {
    if (behavior === "fail-401") {
      res.status(401).json({ error: "sui sig bad", code: "bad-sig" });
      return;
    }
    const addr = "0x" + "a".repeat(64);
    req.wallet = addr;
    req.walletChain = "sui";
    req.identity = { chain: "sui", address: addr, wallet: addr };
    next();
  };
}

test("missing chain header → NEAR path; sets req.wallet + req.walletChain='near'", async () => {
  const mw = makeRequireAnyWallet({
    requireNear: fakeNearMiddleware("ok"),
    requireSui: fakeSuiMiddleware("ok"),
  });
  const req = makeReq();
  const res = makeRes();
  const next = spy();
  await mw(req, res, next);
  assert.equal(next.calls.length, 1);
  assert.equal(req.wallet, "alice.near");
  assert.equal(req.walletChain, "near");
  assert.equal(req.identity, undefined); // NEAR path leaves identity undefined for back-compat
});

test("x-wallet-chain: near → NEAR path", async () => {
  const mw = makeRequireAnyWallet({
    requireNear: fakeNearMiddleware("ok"),
    requireSui: fakeSuiMiddleware("ok"),
  });
  const req = makeReq({ chain: "near" });
  const res = makeRes();
  const next = spy();
  await mw(req, res, next);
  assert.equal(next.calls.length, 1);
  assert.equal(req.walletChain, "near");
});

test("x-wallet-chain: sui → Sui path; sets identity object", async () => {
  const mw = makeRequireAnyWallet({
    requireNear: fakeNearMiddleware("ok"),
    requireSui: fakeSuiMiddleware("ok"),
  });
  const req = makeReq({ chain: "sui" });
  const res = makeRes();
  const next = spy();
  await mw(req, res, next);
  assert.equal(next.calls.length, 1);
  assert.equal(req.walletChain, "sui");
  assert.ok(req.identity);
  assert.equal(req.identity.chain, "sui");
});

test("x-wallet-chain: SUI (uppercase) is normalized", async () => {
  const mw = makeRequireAnyWallet({
    requireNear: fakeNearMiddleware("ok"),
    requireSui: fakeSuiMiddleware("ok"),
  });
  const req = makeReq({ chain: "SUI" });
  const res = makeRes();
  const next = spy();
  await mw(req, res, next);
  assert.equal(next.calls.length, 1);
  assert.equal(req.walletChain, "sui");
});

test("unsupported chain returns 401 bad-chain without invoking either verifier", async () => {
  const sui = spy();
  const near = spy();
  const mw = makeRequireAnyWallet({
    requireNear: (...a) => { near(...a); a[2](); },
    requireSui: (...a) => { sui(...a); a[2](); },
  });
  const req = makeReq({ chain: "ethereum" });
  const res = makeRes();
  await mw(req, res, spy());
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "bad-chain");
  assert.equal(near.calls.length, 0);
  assert.equal(sui.calls.length, 0);
});

test("Sui verifier failure propagates (401 from inner middleware)", async () => {
  const mw = makeRequireAnyWallet({
    requireNear: fakeNearMiddleware("ok"),
    requireSui: fakeSuiMiddleware("fail-401"),
  });
  const req = makeReq({ chain: "sui" });
  const res = makeRes();
  const next = spy();
  await mw(req, res, next);
  assert.equal(res.statusCode, 401);
  assert.equal(next.calls.length, 0);
});

test("NEAR verifier failure propagates (no chain header)", async () => {
  const mw = makeRequireAnyWallet({
    requireNear: fakeNearMiddleware("fail-401"),
    requireSui: fakeSuiMiddleware("ok"),
  });
  const req = makeReq();
  const res = makeRes();
  const next = spy();
  await mw(req, res, next);
  assert.equal(res.statusCode, 401);
  assert.equal(next.calls.length, 0);
});

test("AUTH_DISABLE_NEAR=true rejects NEAR path with 401 near-disabled", async () => {
  const near = spy();
  const mw = makeRequireAnyWallet({
    requireNear: (...a) => { near(...a); a[2](); },
    requireSui: fakeSuiMiddleware("ok"),
    nearDisabled: true,
  });
  const req = makeReq();
  const res = makeRes();
  await mw(req, res, spy());
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "near-disabled");
  assert.equal(near.calls.length, 0);
});

test("AUTH_DISABLE_NEAR=true still routes Sui requests through Sui verifier", async () => {
  const mw = makeRequireAnyWallet({
    requireNear: fakeNearMiddleware("ok"),
    requireSui: fakeSuiMiddleware("ok"),
    nearDisabled: true,
  });
  const req = makeReq({ chain: "sui" });
  const res = makeRes();
  const next = spy();
  await mw(req, res, next);
  assert.equal(next.calls.length, 1);
  assert.equal(req.walletChain, "sui");
});
