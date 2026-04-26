// backend/middleware/requireWallet.js
// NEP-413 signed-message auth middleware. Spec: docs/auth-contract.md.
// Replaces the unsigned x-wallet header gate from feedHelpers.js.

const crypto = require("crypto");
const { PublicKey } = require("near-api-js/lib/utils/key_pair");
const db = require("../db/client");
const sessionToken = require("../services/sessionToken");

const RECIPIENT     = "ironshield.near";
const NONCE_TTL_MS  = 5 * 60 * 1000;
const KEY_CACHE_TTL = 60 * 1000;
const NEAR_RPC      = process.env.NEAR_RPC_URL || "https://rpc.fastnear.com";
const NEP413_PREFIX = 2_147_484_061;

// In-memory access-key cache. Process-local; multi-instance deploys each
// hold their own — fine, the on-chain truth is the source. Stale-on-error
// behaviour lives below.
const keyCache = new Map();

// Build the signed `message` string per docs/auth-contract.md §2.3.
// Domain-tagged so a future v2 sig can never satisfy v1 verification.
function buildMessage(method, path, rawBody) {
  const bodyHex = crypto.createHash("sha256").update(rawBody || "").digest("hex");
  return `ironshield-auth:v1\n${String(method).toUpperCase()}\n${path}\n${bodyHex}`;
}

// Hand-rolled NEP-413 SignMessageParams borsh encoding. The struct is
// fixed-shape and tiny; pulling in the borsh package for ten lines of
// length-prefixed-string encoding would be a speculative dependency.
function nep413Bytes({ message, nonce, recipient }) {
  const msg = Buffer.from(message, "utf8");
  const rec = Buffer.from(recipient, "utf8");
  const out = Buffer.alloc(4 + 4 + msg.length + 32 + 4 + rec.length + 1);
  let o = 0;
  out.writeUInt32LE(NEP413_PREFIX, o);    o += 4;
  out.writeUInt32LE(msg.length, o);       o += 4;
  msg.copy(out, o);                       o += msg.length;
  Buffer.from(nonce).copy(out, o);        o += 32;
  out.writeUInt32LE(rec.length, o);       o += 4;
  rec.copy(out, o);                       o += rec.length;
  out.writeUInt8(0, o);  // callbackUrl: None
  return out;
}

function verifySignature({ message, nonceBytes, publicKey, signature, recipient = RECIPIENT }) {
  const payload = nep413Bytes({ message, nonce: nonceBytes, recipient });
  const digest  = crypto.createHash("sha256").update(payload).digest();
  let pk;
  try { pk = PublicKey.from(publicKey); } catch { return false; }
  try { return pk.verify(new Uint8Array(digest), new Uint8Array(signature)); }
  catch { return false; }
}

async function fetchAccessKeysRpc(accountId) {
  const r = await fetch(NEAR_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "query",
      params: { request_type: "view_access_key_list", finality: "final", account_id: accountId },
    }),
  });
  if (!r.ok) throw new Error(`rpc ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "rpc error");
  return (j.result?.keys || []).map((k) => k.public_key);
}

async function getRegisteredKeys(accountId, fetcher = fetchAccessKeysRpc) {
  const cached = keyCache.get(accountId);
  if (cached && Date.now() - cached.fetchedAt < KEY_CACHE_TTL) return cached.keys;
  try {
    const keys = await fetcher(accountId);
    keyCache.set(accountId, { keys, fetchedAt: Date.now() });
    return keys;
  } catch (err) {
    if (cached) return cached.keys;  // stale-on-error
    throw err;
  }
}

const reject = (res, code, error) => res.status(401).json({ error, code });

function decodeBase64Url(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function makeRequireWallet({ db: dbClient = db, fetchKeys = getRegisteredKeys, allowToken = true } = {}) {
  return async function requireWallet(req, res, next) {
    // Day 5.6 — try Bearer JWT first. Clients that have signed in once
    // via /api/auth/login present the token here and skip the per-call
    // NEP-413 sign + nonce dance entirely. /api/auth/login itself is
    // built with allowToken=false so it always demands a fresh sig.
    if (allowToken) {
      const auth = req.header("authorization");
      if (auth && /^Bearer\s+/i.test(auth)) {
        const token = auth.replace(/^Bearer\s+/i, "").trim();
        const verified = sessionToken.verify(token);
        if (verified) {
          req.wallet = verified.wallet;
          return next();
        }
        // Sender claimed a Bearer; treat a bad one as an active failure
        // (distinct code so the client can clear stale storage and
        // fall back to signing).
        return reject(res, "bad-token", "session token invalid or expired");
      }
    }

    const wallet    = req.header("x-wallet");
    const publicKey = req.header("x-public-key");
    const nonceB64  = req.header("x-nonce");
    const sigB64    = req.header("x-signature");
    if (!wallet || !publicKey || !nonceB64 || !sigB64) {
      return reject(res, "missing-sig", "missing signature headers");
    }

    let nonceBytes, sigBytes;
    try {
      nonceBytes = decodeBase64Url(nonceB64);
      if (nonceBytes.length !== 32) throw new Error();
    } catch { return reject(res, "bad-nonce", "malformed nonce"); }
    try {
      sigBytes = Buffer.from(sigB64, "base64");
      if (sigBytes.length !== 64) throw new Error();
    } catch { return reject(res, "bad-sig", "malformed signature"); }

    const row = (await dbClient.query(
      "SELECT issued_at, used_at FROM auth_nonces WHERE nonce = $1",
      [nonceB64]
    )).rows[0];
    if (!row) return reject(res, "bad-nonce", "unknown nonce");
    if (row.used_at) return reject(res, "replay", "nonce already used");
    if (Date.now() - new Date(row.issued_at).getTime() > NONCE_TTL_MS) {
      return reject(res, "expired-nonce", "nonce expired");
    }

    const accountId = String(wallet).toLowerCase().trim();
    const message   = buildMessage(req.method, req.originalUrl, req.rawBody);
    if (!verifySignature({ message, nonceBytes, publicKey, signature: sigBytes })) {
      return reject(res, "bad-sig", "signature verification failed");
    }

    let keys;
    try { keys = await fetchKeys(accountId); }
    catch (err) {
      console.warn("[requireWallet] access-key lookup failed:", err.message);
      return res.status(503).json({ error: "auth lookup unavailable" });
    }
    if (!keys.includes(publicKey)) return reject(res, "bad-key", "public key not registered for wallet");

    const upd = await dbClient.query(
      "UPDATE auth_nonces SET used_at = NOW(), wallet = $1 WHERE nonce = $2 AND used_at IS NULL",
      [accountId, nonceB64]
    );
    if (upd.rowCount === 0) return reject(res, "replay", "nonce raced");

    req.wallet = accountId;
    next();
  };
}

module.exports = Object.assign(makeRequireWallet(), {
  makeRequireWallet, buildMessage, nep413Bytes, verifySignature, RECIPIENT, NONCE_TTL_MS,
});
