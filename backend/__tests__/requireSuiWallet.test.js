// backend/__tests__/requireSuiWallet.test.js
// Unit tests for the unmounted Phase A Sui auth middleware.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  makeRequireSuiWallet,
  buildMessage,
  normalizeSuiAddress,
  NONCE_TTL_MS,
} = require("../middleware/requireSuiWallet");

const SUI_ADDRESS = "0x" + "a".repeat(64);

function makeFakeDb() {
  const rows = new Map();
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
        r.used_at = new Date();
        r.wallet = wallet;
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
    statusCode: 200,
    body: null,
    status(c) { r.statusCode = c; return r; },
    json(b) { r.body = b; return r; },
  };
  return r;
}

function nextSpy() {
  const calls = [];
  const fn = (...args) => calls.push(args);
  fn.calls = calls;
  return fn;
}

const newNonceB64 = () => crypto.randomBytes(32).toString("base64url");

function headers({ address = SUI_ADDRESS, nonce = newNonceB64(), signature = "sig", chain = "sui" } = {}) {
  return {
    "x-wallet-chain": chain,
    "x-wallet": address,
    "x-nonce": nonce,
    "x-signature": signature,
  };
}

test("normalizeSuiAddress accepts full lower/upper Sui address only", () => {
  assert.equal(normalizeSuiAddress(SUI_ADDRESS.toUpperCase()), SUI_ADDRESS);
  assert.equal(normalizeSuiAddress("0xabc"), null);
  assert.equal(normalizeSuiAddress("alice.near"), null);
});

test("missing chain returns bad-chain", async () => {
  const mw = makeRequireSuiWallet({ db: makeFakeDb(), verifySuiSignature: async () => true });
  const req = makeReq({ headers: { "x-wallet": SUI_ADDRESS } });
  const res = makeRes();
  await mw(req, res, nextSpy());
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "bad-chain");
});

test("bad Sui address returns bad-wallet", async () => {
  const mw = makeRequireSuiWallet({ db: makeFakeDb(), verifySuiSignature: async () => true });
  const req = makeReq({ headers: headers({ address: "0xabc" }) });
  const res = makeRes();
  await mw(req, res, nextSpy());
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "bad-wallet");
});

test("nonce never issued returns bad-nonce", async () => {
  const mw = makeRequireSuiWallet({ db: makeFakeDb(), verifySuiSignature: async () => true });
  const req = makeReq({ headers: headers() });
  const res = makeRes();
  await mw(req, res, nextSpy());
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "bad-nonce");
});

test("expired nonce returns expired-nonce", async () => {
  const db = makeFakeDb();
  const nonce = newNonceB64();
  db.seed(nonce, { issuedAt: new Date(Date.now() - NONCE_TTL_MS - 1000) });
  const mw = makeRequireSuiWallet({ db, verifySuiSignature: async () => true });
  const res = makeRes();
  await mw(makeReq({ headers: headers({ nonce }) }), res, nextSpy());
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "expired-nonce");
});

test("used nonce returns replay", async () => {
  const db = makeFakeDb();
  const nonce = newNonceB64();
  db.seed(nonce, { usedAt: new Date() });
  const mw = makeRequireSuiWallet({ db, verifySuiSignature: async () => true });
  const res = makeRes();
  await mw(makeReq({ headers: headers({ nonce }) }), res, nextSpy());
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "replay");
});

test("verifier false returns bad-sig", async () => {
  const db = makeFakeDb();
  const nonce = newNonceB64();
  db.seed(nonce);
  const mw = makeRequireSuiWallet({ db, verifySuiSignature: async () => false });
  const res = makeRes();
  await mw(makeReq({ headers: headers({ nonce }) }), res, nextSpy());
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "bad-sig");
});

test("valid Sui signed request sets compatibility identity fields", async () => {
  const db = makeFakeDb();
  const nonce = newNonceB64();
  const body = JSON.stringify({ content: "hello sui" });
  db.seed(nonce);

  let observed;
  const mw = makeRequireSuiWallet({
    db,
    verifySuiSignature: async (input) => {
      observed = input;
      return input.signature === "valid-sig" && input.address === SUI_ADDRESS;
    },
  });

  const req = makeReq({
    body,
    headers: headers({ nonce, signature: "valid-sig", address: SUI_ADDRESS.toUpperCase() }),
  });
  const res = makeRes();
  const next = nextSpy();
  await mw(req, res, next);

  assert.equal(next.calls.length, 1);
  assert.equal(req.wallet, SUI_ADDRESS);
  assert.equal(req.walletChain, "sui");
  assert.deepEqual(req.identity, { chain: "sui", address: SUI_ADDRESS, wallet: SUI_ADDRESS });
  assert.equal(observed.message, buildMessage("POST", "/api/posts", Buffer.from(body)));
  assert.notEqual(db.rows.get(nonce).used_at, null);
  assert.equal(db.rows.get(nonce).wallet, SUI_ADDRESS);
});

test("second use of same nonce returns replay", async () => {
  const db = makeFakeDb();
  const nonce = newNonceB64();
  db.seed(nonce);
  const mw = makeRequireSuiWallet({ db, verifySuiSignature: async () => true });
  const h = headers({ nonce });

  await mw(makeReq({ headers: h }), makeRes(), nextSpy());
  const res2 = makeRes();
  await mw(makeReq({ headers: h }), res2, nextSpy());

  assert.equal(res2.statusCode, 401);
  assert.equal(res2.body.code, "replay");
});
