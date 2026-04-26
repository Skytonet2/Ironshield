// backend/__tests__/rateLimit.test.js
// Unit tests for the tier-based rateLimit middleware (Day 2.3).
// Asserts the same property scripts/smoke-ratelimit.js checks against
// a deployed backend (21st-25th call returns 429), but in-process — no
// DB or wallet required.

const test = require("node:test");
const assert = require("node:assert/strict");

const rl = require("../services/rateLimiter");

const makeReq = ({ wallet = "alice.near", ip = "1.2.3.4" } = {}) => ({ wallet, ip });
function makeRes() {
  const r = {
    statusCode: 200, body: null, headers: {},
    status(c) { r.statusCode = c; return r; },
    json(b)   { r.body = b; return r; },
    set(k, v) { r.headers[k] = v; return r; },
  };
  return r;
}

// The middleware is sync (no awaits inside), so `next` fires synchronously
// before mw() returns. We capture whether next() was called via a flag.
function run(mw, req) {
  const res = makeRes();
  let nexted = false;
  mw(req, res, () => { nexted = true; });
  return { res, nexted };
}

test("rateLimit('ai'): 21st call returns 429 with retryAfterMs", () => {
  rl._reset();
  const mw = rl.rateLimit("ai");
  let allowed = 0, blocked = 0;
  for (let i = 0; i < 25; i++) {
    const { res, nexted } = run(mw, makeReq());
    if (nexted) allowed++;
    else {
      blocked++;
      assert.equal(res.statusCode, 429);
      assert.equal(res.body.error, "rate-limited");
      assert.ok(res.body.retryAfterMs > 0);
      assert.ok(res.headers["Retry-After"]);
    }
  }
  assert.equal(allowed, 20, "first 20 calls should pass");
  assert.equal(blocked, 5,  "calls 21-25 should be blocked");
});

test("rateLimit('ai'): different wallets get separate buckets", () => {
  rl._reset();
  const mw = rl.rateLimit("ai");
  for (let i = 0; i < 20; i++) run(mw, makeReq({ wallet: "alice.near" }));
  const { nexted } = run(mw, makeReq({ wallet: "bob.near" }));
  assert.ok(nexted, "bob's first call should pass even after alice exhausts");
});

test("rateLimit('nonce'): 60/min/IP, IP-keyed (no wallet)", () => {
  rl._reset();
  const mw = rl.rateLimit("nonce");
  let allowed = 0;
  for (let i = 0; i < 65; i++) {
    const { nexted } = run(mw, makeReq({ wallet: undefined, ip: "9.9.9.9" }));
    if (nexted) allowed++;
  }
  assert.equal(allowed, 60, "first 60 calls per IP pass; 5 over block");
});

test("tierProbe doesn't consume", () => {
  rl._reset();
  for (let i = 0; i < 100; i++) {
    const r = rl.tierProbe("ai", "alice.near");
    assert.equal(r.allowed, true);
  }
});

test("unknown tier name throws on rateLimit creation", () => {
  assert.throws(() => rl.rateLimit("does-not-exist"), /unknown rate-limit tier/);
});
