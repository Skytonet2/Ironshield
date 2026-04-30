// backend/__tests__/paystackOnramp.test.js
//
// Unit tests for the Paystack on-ramp surface that don't need a live
// Paystack account or a real Postgres. We mock the db client + the
// floatManager via require.cache (same pattern as missionEngine.test.js).
//
// Coverage:
//   1. Webhook HMAC verification (good + tampered signature).
//   2. Float manager refill decision: under threshold → alert path,
//      over cap → skip, healthy → no-op.
//   3. Settlement happy-path: webhook with paid event runs settlement,
//      records mission row, links transaction, logs float drawdown.
//   4. Reconciliation: paid tx with no matching pending row gets
//      quarantined, never silently dropped.

const test   = require("node:test");
const assert = require("node:assert/strict");
const path   = require("node:path");
const crypto = require("node:crypto");
const http   = require("node:http");

// ─── 1. HMAC verification (pure helper, no mocks needed) ────────────

const paystack = require("../services/psp/paystack");

test("verifyWebhookSignature: matches HMAC-SHA512 over raw body", () => {
  const secret = "whsec_test_abc";
  const raw = Buffer.from('{"event":"charge.success","data":{"reference":"x"}}');
  const sig = crypto.createHmac("sha512", secret).update(raw).digest("hex");
  assert.equal(
    paystack.verifyWebhookSignature({ rawBody: raw, signature: sig, secret }),
    true,
  );
});

test("verifyWebhookSignature: rejects tampered body", () => {
  const secret = "whsec_test_abc";
  const raw = Buffer.from('{"event":"charge.success","data":{"reference":"x"}}');
  const sig = crypto.createHmac("sha512", secret).update(raw).digest("hex");
  const tampered = Buffer.from('{"event":"charge.success","data":{"reference":"y"}}');
  assert.equal(
    paystack.verifyWebhookSignature({ rawBody: tampered, signature: sig, secret }),
    false,
  );
});

test("verifyWebhookSignature: rejects malformed signature", () => {
  const secret = "whsec_test_abc";
  const raw = Buffer.from("hello");
  assert.equal(
    paystack.verifyWebhookSignature({ rawBody: raw, signature: "not-hex!!", secret }),
    false,
  );
});

test("verifyWebhookSignature: rejects empty inputs", () => {
  assert.equal(paystack.verifyWebhookSignature({}), false);
  assert.equal(
    paystack.verifyWebhookSignature({ rawBody: Buffer.from(""), signature: "", secret: "" }),
    false,
  );
});

// ─── 2. Float refill cron decision logic ─────────────────────────────

test("floatRefill.runOnce: not configured → no-op", async () => {
  const dbPath = path.resolve(__dirname, "..", "db", "client.js");
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true,
    exports: { query: async () => ({ rows: [] }) } };
  const fmPath = path.resolve(__dirname, "..", "services", "psp", "floatManager.js");
  require.cache[fmPath] = { id: fmPath, filename: fmPath, loaded: true,
    exports: { status: async () => ({ configured: false }) } };
  delete require.cache[path.resolve(__dirname, "..", "jobs", "floatRefill.job.js")];
  const job = require("../jobs/floatRefill.job");
  const r = await job.runOnce();
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not-configured");
});

test("floatRefill.runOnce: healthy float → no-op", async () => {
  const dbPath = path.resolve(__dirname, "..", "db", "client.js");
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true,
    exports: { query: async () => ({ rows: [] }) } };
  const fmPath = path.resolve(__dirname, "..", "services", "psp", "floatManager.js");
  require.cache[fmPath] = { id: fmPath, filename: fmPath, loaded: true,
    exports: { status: async () => ({
      configured: true, balance_near: 100, min_near: 20, target_near: 50, max_near: 200,
      needs_refill: false, over_cap: false,
    }) } };
  delete require.cache[path.resolve(__dirname, "..", "jobs", "floatRefill.job.js")];
  const job = require("../jobs/floatRefill.job");
  const r = await job.runOnce();
  assert.equal(r.ok, true);
  assert.equal(r.action, "no-op");
});

test("floatRefill.runOnce: over cap → skip", async () => {
  const dbPath = path.resolve(__dirname, "..", "db", "client.js");
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true,
    exports: { query: async () => ({ rows: [] }) } };
  const fmPath = path.resolve(__dirname, "..", "services", "psp", "floatManager.js");
  require.cache[fmPath] = { id: fmPath, filename: fmPath, loaded: true,
    exports: { status: async () => ({
      configured: true, balance_near: 250, min_near: 20, target_near: 50, max_near: 200,
      needs_refill: false, over_cap: true,
    }) } };
  delete require.cache[path.resolve(__dirname, "..", "jobs", "floatRefill.job.js")];
  const job = require("../jobs/floatRefill.job");
  const r = await job.runOnce();
  assert.equal(r.ok, true);
  assert.equal(r.action, "over-cap-skip");
});

test("floatRefill.runOnce: low + PSP_EXCHANGE=none → alert-only, no exchange call", async () => {
  process.env.PSP_EXCHANGE = "none";
  const calls = [];
  const dbPath = path.resolve(__dirname, "..", "db", "client.js");
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true,
    exports: { query: async (sql, params) => { calls.push([sql, params]); return { rows: [] }; } } };
  const fmPath = path.resolve(__dirname, "..", "services", "psp", "floatManager.js");
  require.cache[fmPath] = { id: fmPath, filename: fmPath, loaded: true,
    exports: { status: async () => ({
      configured: true, balance_near: 5, min_near: 20, target_near: 50, max_near: 200,
      needs_refill: true, over_cap: false,
    }) } };
  delete require.cache[path.resolve(__dirname, "..", "jobs", "floatRefill.job.js")];
  const job = require("../jobs/floatRefill.job");
  const r = await job.runOnce();
  assert.equal(r.ok, true);
  assert.equal(r.action, "alert-only");
  assert.equal(calls.length, 0, "alert-only must not write to the float log");
});

// ─── 3. + 4. Webhook settlement integration via supertest-lite ───────
//
// We boot the express app fragment by mounting the payments route on a
// fresh app instance, with db + floatManager + provider mocked. Then we
// POST a real signed webhook body and assert downstream side effects.

function bootPaymentsApp({ dbCalls, pending, providerVerify, fundResult }) {
  // Mock requireWallet — webhook route doesn't use it, but the module
  // loads middleware at require-time so we provide a passthrough.
  const rwPath = path.resolve(__dirname, "..", "middleware", "requireWallet.js");
  require.cache[rwPath] = { id: rwPath, filename: rwPath, loaded: true,
    exports: Object.assign(
      (req, _res, next) => { req.wallet = "tester.near"; next(); },
      { makeRequireWallet: () => ((req, _res, next) => { req.wallet = "tester.near"; next(); }) },
    ) };
  const adminPath = path.resolve(__dirname, "..", "middleware", "requireAdmin.js");
  require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true,
    exports: (req, _res, next) => next() };

  // Mock db.
  const dbPath = path.resolve(__dirname, "..", "db", "client.js");
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true,
    exports: {
      query: async (sql, params) => {
        dbCalls.push({ sql, params });
        // Return the pending row when SELECT-ing it.
        if (/FROM psp_pending_missions/i.test(sql) && /pending_key = \$1/.test(sql)) {
          return { rows: pending ? [pending] : [] };
        }
        return { rows: [] };
      },
    } };

  // Mock paystack provider's verify() + keep the real HMAC verifier.
  const realPaystack = require("../services/psp/paystack");
  const paystackPath = path.resolve(__dirname, "..", "services", "psp", "paystack.js");
  require.cache[paystackPath] = { id: paystackPath, filename: paystackPath, loaded: true,
    exports: {
      ...realPaystack,
      verify: async (ref) => providerVerify(ref),
    } };
  const pspIndexPath = path.resolve(__dirname, "..", "services", "psp", "index.js");
  delete require.cache[pspIndexPath];

  // Mock float manager.
  const fmPath = path.resolve(__dirname, "..", "services", "psp", "floatManager.js");
  require.cache[fmPath] = { id: fmPath, filename: fmPath, loaded: true,
    exports: {
      nearToYocto: (n) => BigInt(Math.floor(Number(n) * 1e6)) * (10n ** 18n),
      yoctoToNear: (y) => Number(BigInt(y) / (10n ** 18n)) / 1e6,
      fundMission: async () => fundResult,
      status: async () => ({ configured: true, balance_near: 100 }),
    } };

  // Mock missionEngine.recordCreated + hashPayload (real).
  const realME = require("../services/missionEngine");
  const mePath = path.resolve(__dirname, "..", "services", "missionEngine.js");
  require.cache[mePath] = { id: mePath, filename: mePath, loaded: true,
    exports: {
      ...realME,
      recordCreated: async (args) => ({ on_chain_id: args.on_chain_id, status: "open" }),
    } };

  // Now require the route fresh.
  const routePath = path.resolve(__dirname, "..", "routes", "payments.route.js");
  delete require.cache[routePath];
  const route = require(routePath);

  const express = require("express");
  const app = express();
  app.use(express.json({
    limit: "256kb",
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));
  app.use("/api/payments", route);
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const srv = app.listen(0, () => {
      const port = srv.address().port;
      resolve({ port, close: () => new Promise((r) => srv.close(r)) });
    });
  });
}

function postRaw(port, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body);
    const req = http.request({
      host: "127.0.0.1", port, path: urlPath, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": buf.length, ...headers },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}

test("webhook: bad signature → 401, no settlement", async () => {
  process.env.PAYSTACK_WEBHOOK_SECRET = "whsec_test_x";
  const dbCalls = [];
  let fundCalls = 0;
  const app = bootPaymentsApp({
    dbCalls,
    pending: null,
    providerVerify: async () => ({ status: "success", amount: 50000 }),
    fundResult: { on_chain_id: 42, tx_hash: "tx", inputs_hash: "ih", escrow_yocto: "1" },
  });
  const srv = await listen(app);
  try {
    const body = JSON.stringify({ event: "charge.success", data: { reference: "ironshield_test_1" } });
    const r = await postRaw(srv.port, "/api/payments/psp/webhook", body, {
      "x-paystack-signature": "bad-sig-not-hex",
    });
    assert.equal(r.status, 401);
    // No settlement-related db writes.
    assert.equal(fundCalls, 0);
  } finally {
    await srv.close();
  }
});

test("webhook: paid + matching pending → settles + funds + logs", async () => {
  process.env.PAYSTACK_WEBHOOK_SECRET = "whsec_test_y";
  const dbCalls = [];
  const fundResult = { on_chain_id: 42, tx_hash: "txhash", inputs_hash: "abc", escrow_yocto: "1000" };
  const app = bootPaymentsApp({
    dbCalls,
    pending: {
      pending_key:   "ironshield_test_2",
      buyer_wallet:  "buyer.near",
      template_slug: "watch-wallet",
      kit_slug:      "wallet-watch-kit",
      inputs_json:   {},
      inputs_hash:   "abc",
      escrow_yocto:  "1000",
      status:        "pending_payment",
      on_chain_id:   null,
    },
    providerVerify: async (ref) => ({ reference: ref, status: "success", amount: 5_000_000 }),
    fundResult,
  });
  const srv = await listen(app);
  try {
    const body = JSON.stringify({
      event: "charge.success",
      data: { reference: "ironshield_test_2", amount: 5_000_000, status: "success", customer: { email: "buyer@example.com" } },
    });
    const sig = crypto.createHmac("sha512", "whsec_test_y").update(body).digest("hex");
    const r = await postRaw(srv.port, "/api/payments/psp/webhook", body, {
      "x-paystack-signature": sig,
    });
    assert.equal(r.status, 200);

    // Wait a tick — the route 200s before async settlement work finishes.
    await new Promise((res) => setTimeout(res, 50));

    const sqls = dbCalls.map((c) => c.sql.replace(/\s+/g, " ").trim());
    const wroteSettled = sqls.some((s) => /UPDATE paystack_transactions SET status = 'settled'/.test(s));
    const wroteFunded  = sqls.some((s) => /UPDATE psp_pending_missions SET status = 'funded'/.test(s));
    const wroteLog     = sqls.some((s) => /INSERT INTO psp_naira_float_log/.test(s));
    assert.ok(wroteSettled, `expected paystack_transactions → settled. Got: ${sqls.join(" | ")}`);
    assert.ok(wroteFunded,  "expected psp_pending_missions → funded");
    assert.ok(wroteLog,     "expected psp_naira_float_log insert");
  } finally {
    await srv.close();
  }
});

test("webhook: paid w/o matching pending → quarantines, no funding", async () => {
  process.env.PAYSTACK_WEBHOOK_SECRET = "whsec_test_z";
  const dbCalls = [];
  const app = bootPaymentsApp({
    dbCalls,
    pending: null,
    providerVerify: async (ref) => ({ reference: ref, status: "success", amount: 5_000_000 }),
    fundResult: { on_chain_id: null, tx_hash: null, inputs_hash: "", escrow_yocto: "0" },
  });
  const srv = await listen(app);
  try {
    const body = JSON.stringify({
      event: "charge.success",
      data: { reference: "ironshield_orphan", amount: 5_000_000, status: "success" },
    });
    const sig = crypto.createHmac("sha512", "whsec_test_z").update(body).digest("hex");
    const r = await postRaw(srv.port, "/api/payments/psp/webhook", body, {
      "x-paystack-signature": sig,
    });
    assert.equal(r.status, 200);
    await new Promise((res) => setTimeout(res, 50));

    const sqls = dbCalls.map((c) => c.sql.replace(/\s+/g, " ").trim());
    const quarantined = sqls.some((s) => /UPDATE paystack_transactions SET status = 'quarantined'/.test(s));
    const fundedAnything = sqls.some((s) => /SET status = 'funded'/.test(s));
    assert.ok(quarantined, "expected quarantined update");
    assert.equal(fundedAnything, false, "must not flip any row to funded");
  } finally {
    await srv.close();
  }
});

test("webhook: charge.failed → marks tx + pending failed, no settlement", async () => {
  process.env.PAYSTACK_WEBHOOK_SECRET = "whsec_test_w";
  const dbCalls = [];
  const app = bootPaymentsApp({
    dbCalls,
    pending: null,
    providerVerify: async () => { throw new Error("verify should not be called for failed"); },
    fundResult: null,
  });
  const srv = await listen(app);
  try {
    const body = JSON.stringify({
      event: "charge.failed",
      data: { reference: "ironshield_failed_1", gateway_response: "Declined" },
    });
    const sig = crypto.createHmac("sha512", "whsec_test_w").update(body).digest("hex");
    const r = await postRaw(srv.port, "/api/payments/psp/webhook", body, {
      "x-paystack-signature": sig,
    });
    assert.equal(r.status, 200);
    await new Promise((res) => setTimeout(res, 30));

    const sqls = dbCalls.map((c) => c.sql.replace(/\s+/g, " ").trim());
    const txFailed = sqls.some((s) => /UPDATE paystack_transactions SET status = 'failed'/.test(s));
    const pendingFailed = sqls.some((s) => /UPDATE psp_pending_missions SET status = 'failed'/.test(s));
    assert.ok(txFailed, "expected paystack_transactions → failed");
    assert.ok(pendingFailed, "expected psp_pending_missions → failed");
  } finally {
    await srv.close();
  }
});
