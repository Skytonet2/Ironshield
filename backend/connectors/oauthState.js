// backend/connectors/oauthState.js
//
// Tiny signed-cookie store for OAuth round-trips. The /start endpoint
// signs a payload binding wallet + connector + a random state nonce
// (and a PKCE verifier when the provider needs one), drops it into a
// httpOnly cookie scoped to /api/connectors, and redirects the user to
// the provider. The /callback endpoint reads the cookie back, verifies
// the HMAC, and only then exchanges the code.
//
// Why a cookie and not a DB row: the wallet is server-known at /start
// (NEP-413 signed) but the OAuth callback is a top-level GET from the
// provider — no sig headers, no session token. The cookie carries the
// binding through the redirect with same-domain SameSite=Lax delivery.
//
// HMAC key: OAUTH_STATE_SECRET in prod; falls back to
// CUSTODIAL_ENCRYPT_KEY so a misconfigured deploy still works (with
// a warning) instead of bricking the connect flow.

const crypto = require("crypto");

const COOKIE_NAME = "__ironshield_oauth";
const TTL_MS      = 10 * 60 * 1000; // 10 min — comfortably longer than any sane OAuth flow

// Where to send the user back after the OAuth callback finishes. The
// backend lives on a different host from the frontend, so a relative
// redirect (the obvious "/connectors?connected=x") would land on the
// backend's URL → 404. FRONTEND_URL must be the absolute frontend
// origin (e.g. https://azuka.pages.dev). Trailing slash trimmed.
const FRONTEND_URL = (process.env.FRONTEND_URL || "https://azuka.pages.dev").replace(/\/$/, "");
function frontendRedirect(path) {
  if (!path.startsWith("/")) path = `/${path}`;
  return `${FRONTEND_URL}${path}`;
}

function _key() {
  const k = process.env.OAUTH_STATE_SECRET || process.env.CUSTODIAL_ENCRYPT_KEY;
  if (!k) throw new Error("oauthState: OAUTH_STATE_SECRET (or CUSTODIAL_ENCRYPT_KEY) must be set");
  return crypto.createHash("sha256").update(k).digest();
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

/** Sign a payload object → "<b64url(json)>.<b64url(hmac)>". */
function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const mac  = crypto.createHmac("sha256", _key()).update(body).digest();
  return `${body}.${b64url(mac)}`;
}

/** Verify and return payload, or null on tamper / expiry / format error. */
function verify(token) {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const mac  = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", _key()).update(body).digest();
  let received;
  try { received = fromB64url(mac); } catch { return null; }
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;
  let payload;
  try { payload = JSON.parse(fromB64url(body).toString("utf8")); } catch { return null; }
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  return payload;
}

/** Generate the random pieces a fresh OAuth attempt needs. */
function fresh({ wallet, connector, withPkce = false }) {
  const state = b64url(crypto.randomBytes(24));
  let verifier = null, challenge = null;
  if (withPkce) {
    verifier  = b64url(crypto.randomBytes(32));
    challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  }
  const payload = { wallet, connector, state, verifier, exp: Date.now() + TTL_MS };
  return { state, verifier, challenge, cookie: sign(payload), payload };
}

/** Express helpers: set cookie on res / read cookie from req.
 *
 *  Uses res.append (Express 4) instead of res.setHeader so any prior
 *  Set-Cookie header on the response (e.g. a session cookie set by
 *  upstream middleware) survives — setHeader would clobber it. */
function setCookie(res, value) {
  // SameSite=Lax so the cookie survives the provider's GET redirect
  // back to our callback. Path scoped to /api/connectors so it doesn't
  // leak into unrelated routes.
  const secure = process.env.NODE_ENV === "production";
  const parts = [
    `${COOKIE_NAME}=${value}`,
    "Path=/api/connectors",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(TTL_MS / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}
function clearCookie(res) {
  const secure = process.env.NODE_ENV === "production";
  const parts = [
    `${COOKIE_NAME}=`,
    "Path=/api/connectors",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}
function readCookie(req) {
  const raw = req.headers?.cookie || "";
  for (const seg of raw.split(";")) {
    const eq = seg.indexOf("=");
    if (eq < 0) continue;
    const k = seg.slice(0, eq).trim();
    if (k === COOKIE_NAME) return seg.slice(eq + 1).trim();
  }
  return null;
}

module.exports = {
  COOKIE_NAME, TTL_MS, FRONTEND_URL,
  sign, verify, fresh,
  setCookie, clearCookie, readCookie,
  frontendRedirect,
};
