// backend/services/pingpay/checkout.js
//
// Thin HTTP wrapper around PingPay's hosted-checkout endpoints, plus
// the HMAC verifier for inbound webhooks. Everything else lives one
// layer up (routes/payments.route.js owns request shape; missionSettlement
// owns DB state transitions).
//
// Env:
//   PINGPAY_PUBLISHABLE_KEY   — pk_test_* or pk_live_*. Sent as
//                               x-publishable-key on every outbound call.
//   PINGPAY_WEBHOOK_SECRET    — used to HMAC-SHA256 the
//                               `{timestamp}.{raw_body}` envelope on
//                               inbound webhooks.
//   PINGPAY_BASE_URL          — defaults to https://pay.pingpay.io/api;
//                               override in tests / preview.
//
// Why expose the http client as a swappable property: the tests need
// to stub fetch without monkey-patching the global. See
// backend/__tests__/pingpayCheckout.test.js.

"use strict";

const crypto = require("crypto");

const DEFAULT_BASE_URL = "https://pay.pingpay.io/api";
// Webhook freshness window. PingPay retries with exponential backoff
// up to 6 attempts within ~30s of the first ack window, so anything
// older than 5 min is ~certainly a replay attempt.
const WEBHOOK_MAX_SKEW_MS = 5 * 60 * 1000;

function publishableKey() {
  return String(process.env.PINGPAY_PUBLISHABLE_KEY || "").trim();
}
function webhookSecret() {
  return String(process.env.PINGPAY_WEBHOOK_SECRET || "");
}
function baseUrl() {
  return String(process.env.PINGPAY_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

// ── HTTP ─────────────────────────────────────────────────────────
// Test injection point: tests overwrite module.exports.httpClient with a
// stub (object exposing fetch(url, init)). Default uses global fetch.
const httpClient = {
  async fetch(url, init) {
    return globalThis.fetch(url, init);
  },
};

async function callPingPay(method, path, body) {
  const key = publishableKey();
  if (!key) {
    const e = new Error("PINGPAY_PUBLISHABLE_KEY not configured");
    e.code = "PINGPAY_UNCONFIGURED";
    throw e;
  }
  const url = `${baseUrl()}${path}`;
  const init = {
    method,
    headers: {
      "x-publishable-key": key,
      "accept":            "application/json",
    },
  };
  if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const r = await module.exports.httpClient.fetch(url, init);
  let json;
  try { json = await r.json(); }
  catch { json = {}; }

  if (!r.ok) {
    const err = new Error(json?.message || `PingPay ${method} ${path} failed: HTTP ${r.status}`);
    err.code = json?.code || "PINGPAY_HTTP_ERROR";
    err.status = r.status;
    throw err;
  }
  return json;
}

// ── Public API ───────────────────────────────────────────────────

/** Create a hosted-checkout session.
 *  PingPay returns { sessionId, sessionUrl, status, ... }. */
async function createSession({
  amountUsd,
  successUrl,
  cancelUrl,
  metadata = {},
  description,
}) {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error("amountUsd must be a positive number");
  }
  if (!successUrl || !cancelUrl) {
    throw new Error("successUrl + cancelUrl required");
  }
  // Numeric amount with two-decimal precision. PingPay docs accept
  // either a number or a string; sending a string-fixed avoids
  // float-edge displays like 12.7400000001.
  const amount = Number(amountUsd).toFixed(2);
  return callPingPay("POST", "/checkout/sessions", {
    amount,
    currency: "USD",
    successUrl,
    cancelUrl,
    metadata,
    description: description || undefined,
  });
}

/** Read the current state of a session — used by the success page to
 *  confirm COMPLETED before letting the buyer move on. */
async function getSession(sessionId) {
  if (!sessionId) throw new Error("sessionId required");
  return callPingPay("GET", `/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

// ── Webhook verification ─────────────────────────────────────────

/** Parse the `x-ping-signature` header. PingPay's documented format
 *  is `t=<unix-seconds>,v1=<hex-hmac>`; we accept both that and a
 *  bare hex digest (older sandbox builds) so test fixtures keep
 *  working. Returns { timestamp, signature } or null on parse fail. */
function parseSignatureHeader(headerVal) {
  if (!headerVal) return null;
  const raw = String(headerVal).trim();
  if (/^[a-f0-9]{64}$/i.test(raw)) {
    return { timestamp: null, signature: raw.toLowerCase() };
  }
  const parts = Object.fromEntries(
    raw.split(",").map((kv) => {
      const i = kv.indexOf("=");
      if (i < 0) return [kv.trim(), ""];
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );
  const t  = parts.t;
  const v1 = parts.v1 || parts.signature;
  if (!t || !v1) return null;
  return { timestamp: t, signature: String(v1).toLowerCase() };
}

/** Verify a webhook. rawBody must be the exact bytes the upstream
 *  signed (Buffer or string). Returns true iff:
 *    - the secret is configured,
 *    - the header parses,
 *    - the timestamp (if present) is within the skew window,
 *    - HMAC-SHA256 over `${timestamp}.${rawBody}` (or rawBody alone
 *      when there is no timestamp) matches the supplied signature.
 *  Uses crypto.timingSafeEqual to avoid leaking byte-by-byte
 *  comparison timing.
 */
function verifyWebhookSignature(rawBody, headerVal, { now = Date.now } = {}) {
  const secret = webhookSecret();
  if (!secret) return false;
  const parsed = parseSignatureHeader(headerVal);
  if (!parsed) return false;

  if (parsed.timestamp) {
    const tsMs = Number(parsed.timestamp) * 1000;
    if (!Number.isFinite(tsMs)) return false;
    if (Math.abs(now() - tsMs) > WEBHOOK_MAX_SKEW_MS) return false;
  }

  const bodyStr = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody || "");
  const signedPayload = parsed.timestamp
    ? `${parsed.timestamp}.${bodyStr}`
    : bodyStr;
  const expected = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parsed.signature, "hex");
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  createSession,
  getSession,
  verifyWebhookSignature,
  parseSignatureHeader,
  WEBHOOK_MAX_SKEW_MS,
  httpClient,
};
