// backend/middleware/requireSuiWallet.js
// Phase A Sui signed-message auth middleware.
//
// This file is intentionally not mounted on production routes yet. It
// mirrors requireWallet's nonce/replay behavior while verifying Sui
// personal-message signatures. See docs/SUI_AUTH_CONTRACT.md.

const crypto = require("crypto");
const db = require("../db/client");

const AUTH_DOMAIN = "azuka-sui-auth:v1";
const NONCE_TTL_MS = 5 * 60 * 1000;
const SUI_CHAIN = "sui";
const SUI_ADDRESS_RE = /^0x[0-9a-f]{64}$/;

function buildMessage(method, path, rawBody) {
  const bodyHex = crypto.createHash("sha256").update(rawBody || "").digest("hex");
  return `${AUTH_DOMAIN}\n${String(method).toUpperCase()}\n${path}\n${bodyHex}`;
}

function decodeBase64Url(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function normalizeSuiAddress(address) {
  const value = String(address || "").trim().toLowerCase();
  return SUI_ADDRESS_RE.test(value) ? value : null;
}

async function defaultVerifySuiSignature({ message, signature, address }) {
  let verifyPersonalMessageSignature;
  try {
    ({ verifyPersonalMessageSignature } = await import("@mysten/sui/verify"));
  } catch (err) {
    const e = new Error("Sui verifier unavailable; install @mysten/sui before mounting requireSuiWallet");
    e.code = "SUI_VERIFY_UNAVAILABLE";
    e.cause = err;
    throw e;
  }

  try {
    await verifyPersonalMessageSignature(Buffer.from(message, "utf8"), signature, { address });
    return true;
  } catch {
    return false;
  }
}

const reject = (res, code, error) => res.status(401).json({ error, code });

function makeRequireSuiWallet({
  db: dbClient = db,
  verifySuiSignature = defaultVerifySuiSignature,
} = {}) {
  return async function requireSuiWallet(req, res, next) {
    const chain = String(req.header("x-wallet-chain") || "").toLowerCase().trim();
    const address = normalizeSuiAddress(req.header("x-wallet"));
    const nonceB64 = req.header("x-nonce");
    const signature = req.header("x-signature");

    if (chain !== SUI_CHAIN) {
      return reject(res, "bad-chain", "x-wallet-chain must be sui");
    }
    if (!address) {
      return reject(res, "bad-wallet", "x-wallet must be a full Sui address");
    }
    if (!nonceB64 || !signature) {
      return reject(res, "missing-sig", "missing signature headers");
    }

    let nonceBytes;
    try {
      nonceBytes = decodeBase64Url(nonceB64);
      if (nonceBytes.length !== 32) throw new Error();
    } catch {
      return reject(res, "bad-nonce", "malformed nonce");
    }

    const row = (await dbClient.query(
      "SELECT issued_at, used_at FROM auth_nonces WHERE nonce = $1",
      [nonceB64],
    )).rows[0];
    if (!row) return reject(res, "bad-nonce", "unknown nonce");
    if (row.used_at) return reject(res, "replay", "nonce already used");
    if (Date.now() - new Date(row.issued_at).getTime() > NONCE_TTL_MS) {
      return reject(res, "expired-nonce", "nonce expired");
    }

    const message = buildMessage(req.method, req.originalUrl, req.rawBody);
    let valid = false;
    try {
      valid = await verifySuiSignature({ message, signature, address });
    } catch (err) {
      if (err?.code === "SUI_VERIFY_UNAVAILABLE") {
        console.warn("[requireSuiWallet] verifier unavailable:", err.message);
        return res.status(503).json({ error: "sui auth verifier unavailable" });
      }
      console.warn("[requireSuiWallet] signature verification failed:", err?.message || err);
      valid = false;
    }
    if (!valid) return reject(res, "bad-sig", "signature verification failed");

    const upd = await dbClient.query(
      "UPDATE auth_nonces SET used_at = NOW(), wallet = $1 WHERE nonce = $2 AND used_at IS NULL",
      [address, nonceB64],
    );
    if (upd.rowCount === 0) return reject(res, "replay", "nonce raced");

    req.wallet = address;
    req.walletChain = SUI_CHAIN;
    req.identity = { chain: SUI_CHAIN, address, wallet: address };
    next();
  };
}

module.exports = Object.assign(makeRequireSuiWallet(), {
  AUTH_DOMAIN,
  NONCE_TTL_MS,
  SUI_CHAIN,
  buildMessage,
  defaultVerifySuiSignature,
  makeRequireSuiWallet,
  normalizeSuiAddress,
});
