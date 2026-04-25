// backend/__tests__/requireWallet.test.js
// Unit tests for requireWallet middleware. Uses node:test (built-in,
// no jest dep). Mocks the Postgres client and the access-key fetcher
// so verification logic runs in isolation.
//
// Run: node --test backend/__tests__/requireWallet.test.js
//      (or `node --test backend/__tests__` for the whole dir)

const test     = require("node:test");
const assert   = require("node:assert/strict");
const crypto   = require("node:crypto");
const { KeyPair } = require("near-api-js");

const {
  makeRequireWallet,
  buildMessage,
  nep413Bytes,
  RECIPIENT,
  NONCE_TTL_MS,
} = require("../middleware/requireWallet");

// ── Test doubles ──────────────────────────────────────────────────────

function makeFakeDb() {
  const rows = new Map();   // nonce -> { issued_at, used_at, wallet }
  return {
    rows,
    seed(nonce, { issuedAt = new Date(), usedAt = null } = {}) {
      rows.set(nonce, { issued_at: issuedAt, used_at: usedAt, wallet: null });
    },
    async query(text, params) {
      if (text.startsWith("SELECT")) {
        const r = rows.get(params[0]);
        return { rows: r ? [{ issued_at: r.issued_at, used_at: r.used_at }] : [] };
      }
      if (text.startsWith("UPDATE")) {
        const [wallet, nonce] = params;
        const r = rows.get(nonce);
        if (!r || r.used_at) return { rowCount: 0 };
        r.used_at = new Date(); r.wallet = wallet;
        return { rowCount: 1 };
      }
      throw new Error("unexpected query: " + text);
    },
  };
}

function makeReq({ method = "POST", path = "/api/posts", body = "", headers = {} } = {}) {
  const lc = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    method,
    originalUrl: path,
    rawBody: Buffer.from(body),
    header: (name) => lc[name.toLowerCase()],
  };
}

function makeRes() {
  const r = {
    statusCode: 200, body: null,
    status(c) { r.statusCode = c; return r; },
    json(b)   { r.body = b; return r; },
  };
  return r;
}

function nextSpy() {
  const calls = [];
  const fn = (...args) => calls.push(args);
  fn.calls = calls;
  return fn;
}

// Sign a request the way the wallet would, via NEP-413.
function signRequest({ kp, method = "POST", path = "/api/posts", body = "", nonceB64 }) {
  const nonceBytes = Buffer.from(nonceB64.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - (nonceB64.length % 4)) % 4), "base64");
  const message = buildMessage(method, path, Buffer.from(body));
  const payload = nep413Bytes({ message, nonce: nonceBytes, recipient: RECIPIENT });
  const digest  = crypto.createHash("sha256").update(payload).digest();
  const { signature } = kp.sign(new Uint8Array(digest));
  return Buffer.from(signature).toString("base64");
}

const freshKp = () => KeyPair.fromRandom("ed25519");
const newNonceB64 = () => crypto.randomBytes(32).toString("base64url");

// Build a configured middleware with the supplied fakes.
function setup({ fetchKeysReturns } = {}) {
  const db = makeFakeDb();
  const fetchKeys = async () => fetchKeysReturns ?? [];
  const mw = makeRequireWallet({ db, fetchKeys });
  return { db, mw };
}

// ── Cases ─────────────────────────────────────────────────────────────

test("missing headers → 401 missing-sig", async () => {
  const { mw } = setup();
  const req = makeReq();
  const res = makeRes();
  const next = nextSpy();
  await mw(req, res, next);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "missing-sig");
  assert.equal(next.calls.length, 0);
});

test("nonce never issued → 401 bad-nonce", async () => {
  const kp = freshKp();
  const nonceB64 = newNonceB64();
  const sig = signRequest({ kp, nonceB64 });
  const { mw } = setup({ fetchKeysReturns: [kp.getPublicKey().toString()] });
  const req = makeReq({ headers: {
    "x-wallet": "alice.near",
    "x-public-key": kp.getPublicKey().toString(),
    "x-nonce": nonceB64,
    "x-signature": sig,
  }});
  const res = makeRes();
  await mw(req, res, nextSpy());
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "bad-nonce");
});

test("nonce expired → 401 expired-nonce", async () => {
  const kp = freshKp();
  const nonceB64 = newNonceB64();
  const sig = signRequest({ kp, nonceB64 });
  const { db, mw } = setup({ fetchKeysReturns: [kp.getPublicKey().toString()] });
  db.seed(nonceB64, { issuedAt: new Date(Date.now() - NONCE_TTL_MS - 1000) });
  const req = makeReq({ headers: {
    "x-wallet": "alice.near",
    "x-public-key": kp.getPublicKey().toString(),
    "x-nonce": nonceB64,
    "x-signature": sig,
  }});
  const res = makeRes();
  await mw(req, res, nextSpy());
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "expired-nonce");
});

test("nonce reused → 401 replay", async () => {
  const kp = freshKp();
  const nonceB64 = newNonceB64();
  const sig = signRequest({ kp, nonceB64 });
  const { db, mw } = setup({ fetchKeysReturns: [kp.getPublicKey().toString()] });
  db.seed(nonceB64, { usedAt: new Date() });
  const req = makeReq({ headers: {
    "x-wallet": "alice.near",
    "x-public-key": kp.getPublicKey().toString(),
    "x-nonce": nonceB64,
    "x-signature": sig,
  }});
  const res = makeRes();
  await mw(req, res, nextSpy());
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "replay");
});

test("sig mismatch → 401 bad-sig", async () => {
  const kp = freshKp();
  const nonceB64 = newNonceB64();
  // Sign over wrong path so the digest won't match what the server reproduces.
  const wrongSig = signRequest({ kp, path: "/api/posts/HIJACK", nonceB64 });
  const { db, mw } = setup({ fetchKeysReturns: [kp.getPublicKey().toString()] });
  db.seed(nonceB64);
  const req = makeReq({ headers: {
    "x-wallet": "alice.near",
    "x-public-key": kp.getPublicKey().toString(),
    "x-nonce": nonceB64,
    "x-signature": wrongSig,
  }});
  const res = makeRes();
  await mw(req, res, nextSpy());
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "bad-sig");
});

test("public key not registered → 401 bad-key", async () => {
  const kp = freshKp();
  const otherKp = freshKp();  // chain only knows otherKp
  const nonceB64 = newNonceB64();
  const sig = signRequest({ kp, nonceB64 });
  const { db, mw } = setup({ fetchKeysReturns: [otherKp.getPublicKey().toString()] });
  db.seed(nonceB64);
  const req = makeReq({ headers: {
    "x-wallet": "alice.near",
    "x-public-key": kp.getPublicKey().toString(),
    "x-nonce": nonceB64,
    "x-signature": sig,
  }});
  const res = makeRes();
  await mw(req, res, nextSpy());
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "bad-key");
});

test("valid signed request → next() called and req.wallet set", async () => {
  const kp = freshKp();
  const nonceB64 = newNonceB64();
  const body = JSON.stringify({ content: "hi" });
  const sig = signRequest({ kp, body, nonceB64 });
  const { db, mw } = setup({ fetchKeysReturns: [kp.getPublicKey().toString()] });
  db.seed(nonceB64);
  const req = makeReq({ body, headers: {
    "x-wallet": "Alice.NEAR",   // mixed case → middleware normalises
    "x-public-key": kp.getPublicKey().toString(),
    "x-nonce": nonceB64,
    "x-signature": sig,
  }});
  const res = makeRes();
  const next = nextSpy();
  await mw(req, res, next);
  assert.equal(next.calls.length, 1, "next() should be called once");
  assert.equal(req.wallet, "alice.near");
  assert.equal(res.body, null, "no response body when middleware passes");
  // Nonce is now consumed.
  assert.notEqual(db.rows.get(nonceB64).used_at, null);
});

test("second use of same nonce → 401 replay (atomic single-use)", async () => {
  const kp = freshKp();
  const nonceB64 = newNonceB64();
  const sig = signRequest({ kp, nonceB64 });
  const { db, mw } = setup({ fetchKeysReturns: [kp.getPublicKey().toString()] });
  db.seed(nonceB64);
  const headers = {
    "x-wallet": "alice.near",
    "x-public-key": kp.getPublicKey().toString(),
    "x-nonce": nonceB64,
    "x-signature": sig,
  };
  // First call succeeds.
  await mw(makeReq({ headers }), makeRes(), nextSpy());
  // Second call with the same nonce + sig.
  const res2 = makeRes();
  await mw(makeReq({ headers }), res2, nextSpy());
  assert.equal(res2.statusCode, 401);
  assert.equal(res2.body.code, "replay");
});
