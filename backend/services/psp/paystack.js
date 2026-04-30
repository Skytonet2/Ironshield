// backend/services/psp/paystack.js
//
// Thin Paystack REST wrapper.  We touch exactly two endpoints:
//
//   POST /transaction/initialize  → returns a hosted-checkout URL the
//                                   buyer is redirected to.
//   GET  /transaction/verify/:ref → server-to-server confirmation that
//                                   a tx the webhook claims is paid is
//                                   actually paid (defense-in-depth —
//                                   webhooks can be replayed/forged
//                                   during incidents).
//
// HMAC-SHA512 webhook verification lives in the route, not here, so we
// can hash req.rawBody before any JSON parsing strips bytes.
//
// Test-key dev: PAYSTACK_SECRET_KEY=sk_test_... + PAYSTACK_WEBHOOK_SECRET
// (both shown on the Paystack dashboard). Live keys require an approved
// Nigerian merchant entity — gated by founder, see PR description.

const crypto = require("node:crypto");

const API_BASE = "https://api.paystack.co";

function getSecret() {
  const key = (process.env.PAYSTACK_SECRET_KEY || "").trim();
  if (!key) throw new Error("PAYSTACK_SECRET_KEY not set");
  return key;
}

async function paystackFetch(path, init = {}) {
  const url = API_BASE + path;
  const headers = {
    Authorization: `Bearer ${getSecret()}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(init.headers || {}),
  };
  // Node 20+ has global fetch; backend runs on Node 20 per Render config.
  const res = await fetch(url, { ...init, headers });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok || !body || body.status === false) {
    const msg = body?.message || `Paystack ${path} failed: HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

/** Initialize a Paystack transaction. amount_kobo is the integer amount
 *  in the smallest NGN unit (kobo = 1/100 of a naira). reference is our
 *  idempotency key — re-using one returns the existing transaction's
 *  URL, which is the property we lean on if /checkout retries. */
async function initialize({ amount_kobo, email, reference, callback_url, metadata }) {
  if (!Number.isInteger(amount_kobo) || amount_kobo <= 0) {
    throw new Error("amount_kobo must be a positive integer");
  }
  if (!email || !reference) throw new Error("email and reference required");
  const body = {
    amount: amount_kobo,
    email,
    reference,
    currency: "NGN",
    channels: ["card", "bank", "ussd", "bank_transfer", "qr"],
  };
  if (callback_url) body.callback_url = callback_url;
  if (metadata) body.metadata = metadata;
  const out = await paystackFetch("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return {
    authorization_url: out.data?.authorization_url,
    access_code:       out.data?.access_code,
    reference:         out.data?.reference || reference,
  };
}

/** Server-to-server verify. Always re-call this from the webhook before
 *  crediting — the webhook's HMAC alone is not sufficient (incidents +
 *  replays). Returns the canonical tx record from Paystack. */
async function verify(reference) {
  if (!reference) throw new Error("reference required");
  const out = await paystackFetch(
    `/transaction/verify/${encodeURIComponent(reference)}`,
  );
  return out.data || null;
}

/** Constant-time HMAC-SHA512 verify over the raw request body. Used by
 *  the webhook handler. Returns true iff the signature matches. */
function verifyWebhookSignature({ rawBody, signature, secret }) {
  if (!rawBody || !signature || !secret) return false;
  const computed = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(computed, "hex");
  let b;
  try { b = Buffer.from(String(signature), "hex"); }
  catch { return false; }
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  name: "paystack",
  supportedCurrencies: ["NGN"],
  supportedCountries:  ["NG"],
  initialize,
  verify,
  verifyWebhookSignature,
  // Paystack standard local-card fee is 1.5% + ₦100 (waived under ₦2500).
  // We don't charge it through to the buyer — it eats into our margin —
  // but the route exposes the math so the operator can budget.
  fee: ({ amount_kobo }) => {
    const pct = Math.floor(amount_kobo * 0.015);
    const flat = amount_kobo >= 250_000 ? 10_000 : 0; // ₦100 = 10000 kobo
    const total = pct + flat;
    // Paystack caps the local fee at ₦2000 (200000 kobo).
    return Math.min(total, 200_000);
  },
};
