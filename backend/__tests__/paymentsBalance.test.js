// backend/__tests__/paymentsBalance.test.js
//
// Static regression for the chip 2 thin-slice surface:
//   - GET /agent/balance is wallet-guarded (no public read of holdings).
//   - The handler returns the {near_yocto, usdc_base, decimals} shape
//     that the dashboard Wallet panel formatters expect.
//
// We mock balanceLookup via the require.cache hijack used in
// agentState.test.js so the test runs without RPC access.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const lookupPath = path.resolve(__dirname, "..", "services", "balanceLookup.js");
require.cache[lookupPath] = {
  id: lookupPath, filename: lookupPath, loaded: true,
  exports: {
    getAgentBalance: async (accountId) => ({
      account_id:    accountId,
      near_yocto:    "12345000000000000000000000",  // 12.345 NEAR
      near_decimals: 24,
      usdc_base:     "5500000",                    // 5.50 USDC
      usdc_decimals: 6,
    }),
  },
};

const requireWallet = require("../middleware/requireWallet");
const router = require("../routes/payments.route");

test("payments.route — every non-webhook, non-public-token endpoint is wallet-guarded", () => {
  // Two kinds of routes on this router authenticate WITHOUT a wallet
  // signature, both by design:
  //
  //   1. Webhooks. Authenticated by HMAC over `{timestamp}.{raw_body}`
  //      (PingPay) or HMAC-SHA512 over the raw body (Paystack). The
  //      HMAC check lives inside the handler, not as middleware.
  //
  //   2. Paystack `/psp/session/:reference` GET. The reference is a
  //      96-bit unguessable token (see buildReference() — 16 hex char
  //      randomBytes + timestamp). Buyers reach this from a Paystack
  //      redirect URL and don't have a wallet linked yet at that point.
  //      Note this is INTENTIONALLY different from PingPay's
  //      `/pingpay/session/:id` GET, which IS wallet-authed because
  //      that surface is reached from inside the deploy wizard where
  //      the buyer's already signed in.
  //
  // Every OTHER route on this router must run requireWallet first.
  const isWebhook       = (p) => /\/webhook(\/|$)/.test(p || "");
  const isPublicSession = (p, m) => m === "get" && /^\/psp\/session\//.test(p || "");
  const offenders = [];
  for (const layer of router.stack) {
    if (!layer.route) continue;
    if (isWebhook(layer.route.path)) continue;
    for (const method of Object.keys(layer.route.methods)) {
      if (isPublicSession(layer.route.path, method)) continue;
      const guarded = layer.route.stack.some((l) => l.handle === requireWallet);
      if (!guarded) offenders.push(`${method} ${layer.route.path} not guarded`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join("; "));
});

test("payments.route — GET /agent/balance returns base-unit shape from req.wallet", async () => {
  const layer = router.stack.find(
    (l) => l.route?.path === "/agent/balance" && l.route?.methods?.get
  );
  assert.ok(layer, "no GET /agent/balance layer");
  // Last in the layer's mini-stack is the handler itself; the
  // requireWallet hop runs first in real Express but we bypass it
  // here and inject req.wallet directly to test the handler.
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  let body, status = 200;
  await handler(
    { wallet: "agent.near" },
    {
      status(c) { status = c; return this; },
      json(b)   { body = b; },
    }
  );
  assert.equal(status, 200);
  assert.equal(body.account_id, "agent.near");
  assert.equal(body.near_yocto, "12345000000000000000000000");
  assert.equal(body.near_decimals, 24);
  assert.equal(body.usdc_base, "5500000");
  assert.equal(body.usdc_decimals, 6);
});
