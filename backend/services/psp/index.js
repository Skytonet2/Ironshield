// backend/services/psp/index.js
//
// Provider-agnostic façade for fiat payment-service-providers. The route
// handler imports `getProvider()` and calls .initialize / .verify /
// .verifyWebhookSignature without caring whether Paystack or Flutterwave
// is wired in.
//
// Selectable via PSP_PROVIDER=paystack (default) | flutterwave (TODO).
// Adding Flutterwave is a config flip + a sibling adapter file with the
// same shape as paystack.js.

const paystack = require("./paystack");

const PROVIDERS = { paystack };

function getProvider(name) {
  const key = (name || process.env.PSP_PROVIDER || "paystack").toLowerCase();
  const p = PROVIDERS[key];
  if (!p) throw new Error(`Unknown PSP provider: ${key}`);
  return p;
}

module.exports = { getProvider, PROVIDERS };
