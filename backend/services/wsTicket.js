// backend/services/wsTicket.js
// Stateless HMAC ticket for binding a WebSocket socket to a verified
// wallet. Issued only after a NEP-413-signed REST call (see
// /api/auth/ws-ticket); verified inline on the WS auth handshake.
//
// Format: `<wallet>.<expMs>.<base64url(hmacSha256(secret, wallet+":"+expMs))>`
// The ticket is short-lived (default 60s) — long enough to survive
// the WS open round-trip, short enough that a leak doesn't grant a
// permanent channel. Each WS reconnect mints a fresh ticket.
//
// Secret: WS_TICKET_SECRET env var. If unset we fall back to a
// process-local random secret and log a warning — this means tickets
// don't survive a backend restart, which is fine in dev. Prod must
// set the env var or every reconnect after a deploy fails verify.

const crypto = require("crypto");

const TTL_MS = 60 * 1000;

let SECRET = process.env.WS_TICKET_SECRET || "";
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString("base64url");
  console.warn(
    "[wsTicket] WS_TICKET_SECRET unset — using process-local secret. " +
    "Tickets will not survive a restart. Set WS_TICKET_SECRET in prod."
  );
}

function sign(wallet, expMs) {
  return crypto
    .createHmac("sha256", SECRET)
    .update(`${wallet}:${expMs}`)
    .digest("base64url");
}

function issue(wallet) {
  const expMs = Date.now() + TTL_MS;
  const sig = sign(wallet, expMs);
  return { ticket: `${wallet}.${expMs}.${sig}`, expMs };
}

function verify(ticket) {
  if (typeof ticket !== "string") return null;
  const parts = ticket.split(".");
  // Wallets can contain dots (e.g. `alice.near`), so rejoin all but the
  // last two segments as the wallet portion.
  if (parts.length < 3) return null;
  const sig = parts[parts.length - 1];
  const expMs = Number(parts[parts.length - 2]);
  const wallet = parts.slice(0, parts.length - 2).join(".");
  if (!wallet || !Number.isFinite(expMs)) return null;
  if (Date.now() > expMs) return null;
  const expected = sign(wallet, expMs);
  // timingSafeEqual throws on length mismatch
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  return { wallet, expMs };
}

module.exports = { issue, verify, TTL_MS };
