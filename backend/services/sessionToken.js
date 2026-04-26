// backend/services/sessionToken.js
//
// Stateless HMAC session token. Day 5.6 added these to kill the
// "popup on every action" UX: instead of NEP-413 signing every
// mutating REST call, the client signs once via /api/auth/login,
// receives a 24h token, and presents it as `Authorization: Bearer
// <token>` on subsequent calls. requireWallet accepts the token in
// place of the signature headers.
//
// Format: `<wallet>.<expMs>.<base64url(hmacSha256(secret, domain+":"+wallet+":"+expMs))>`
//
// Domain tag prevents cross-use with WS tickets (which use the same
// secret material). A leaked WS ticket can't be replayed as a session
// token and vice versa.
//
// Secret: reuses WS_TICKET_SECRET (already provisioned on Render in
// Day 5.5). Sharing the secret is safe given the domain tag — both
// artifacts are server-issued and have the same threat model.

const crypto = require("crypto");

const TTL_MS = 24 * 60 * 60 * 1000;
const DOMAIN = "session:v1";

let SECRET = process.env.WS_TICKET_SECRET || "";
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString("base64url");
  console.warn(
    "[sessionToken] WS_TICKET_SECRET unset — using process-local secret. " +
    "Tokens won't survive a restart. Set WS_TICKET_SECRET in prod."
  );
}

function sign(wallet, expMs) {
  return crypto
    .createHmac("sha256", SECRET)
    .update(`${DOMAIN}:${wallet}:${expMs}`)
    .digest("base64url");
}

function issue(wallet) {
  const expMs = Date.now() + TTL_MS;
  const sig = sign(wallet, expMs);
  return { token: `${wallet}.${expMs}.${sig}`, expMs };
}

function verify(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  // Wallets like alice.near contain dots — last two segments are
  // exp + sig, the rest is the wallet.
  if (parts.length < 3) return null;
  const sig = parts[parts.length - 1];
  const expMs = Number(parts[parts.length - 2]);
  const wallet = parts.slice(0, parts.length - 2).join(".");
  if (!wallet || !Number.isFinite(expMs)) return null;
  if (Date.now() > expMs) return null;
  const expected = sign(wallet, expMs);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  return { wallet, expMs };
}

module.exports = { issue, verify, TTL_MS };
