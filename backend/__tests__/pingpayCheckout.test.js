// backend/__tests__/pingpayCheckout.test.js
//
// Covers:
//   - HMAC webhook signature verification (good, tampered body,
//     stale timestamp, missing secret, bare-hex variant).
//   - PingPay createSession + getSession HTTP wiring (mock fetch).
//   - missionSettlement state transitions through the webhook path:
//     createPending → applyWebhookEvent(completed) → attachOnChainId,
//     plus duplicate-webhook idempotency.
//
// Pattern: mutate require.cache[<absolute path>] BEFORE first require()
// of the module under test, so the production code's require("./client")
// resolves to our fake. Same idiom as agentState.test.js.

"use strict";

const test    = require("node:test");
const assert  = require("node:assert/strict");
const path    = require("node:path");
const crypto  = require("node:crypto");

// ── Stub the db client BEFORE loading anything that touches it.
const dbClientPath = path.resolve(__dirname, "..", "db", "client.js");

function makeFakeDb() {
  // Two-table in-memory store: pending_missions + pingpay_payments.
  // Auto-incrementing ids so the route handlers can reference rows by
  // surrogate key the same way real Postgres would.
  const state = {
    pending: new Map(),       // id -> row
    payments: new Map(),      // session_id -> row
    nextPendingId: 1,
    nextPaymentId: 1,
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  async function query(sql, params = []) {
    const s = sql.trim();

    // ── pending_missions inserts ──
    if (/^INSERT INTO pending_missions/i.test(s)) {
      const id = state.nextPendingId++;
      const [
        poster_wallet, template_slug, kit_slug,
        inputs_json, inputs_hash, escrow_amount_usd,
        pingpay_session_id,
      ] = params;
      const row = {
        id,
        poster_wallet,
        template_slug,
        kit_slug,
        inputs_json: typeof inputs_json === "string" ? JSON.parse(inputs_json) : inputs_json,
        inputs_hash,
        escrow_amount_usd,
        pingpay_session_id,
        pingpay_status: "PENDING",
        status: "pending_payment",
        escrow_yocto: null,
        resolved_on_chain_id: null,
        created_at: new Date(),
        updated_at: new Date(),
        funded_at: null,
        signed_at: null,
      };
      state.pending.set(id, row);
      return { rows: [clone(row)], rowCount: 1 };
    }

    // ── pingpay_payments inserts ──
    if (/^INSERT INTO pingpay_payments/i.test(s)) {
      const [session_id, pending_mission_id, amount_usd] = params;
      if (state.payments.has(session_id)) return { rows: [], rowCount: 0 };
      state.payments.set(session_id, {
        id: state.nextPaymentId++,
        session_id,
        pending_mission_id,
        amount_usd,
        amount_yocto: null,
        status: "PENDING",
        raw_event_json: null,
        created_at: new Date(),
        completed_at: null,
      });
      return { rows: [], rowCount: 1 };
    }

    // ── pingpay_payments updates ──
    if (/^UPDATE pingpay_payments/i.test(s)) {
      const [session_id, raw, status, amount_yocto] = params;
      const p = state.payments.get(session_id);
      if (!p) return { rows: [], rowCount: 0 };
      p.raw_event_json = JSON.parse(raw);
      if (status) p.status = status;
      if (amount_yocto != null) p.amount_yocto = amount_yocto;
      if (status === "COMPLETED" && !p.completed_at) p.completed_at = new Date();
      return { rows: [], rowCount: 1 };
    }

    // ── pending_missions: flip pending_payment → funded ──
    if (/^UPDATE pending_missions\s+SET status\s*=\s*'funded'/i.test(s)) {
      const [session_id, amount_yocto] = params;
      const row = [...state.pending.values()].find((r) => r.pingpay_session_id === session_id);
      if (!row || row.status !== "pending_payment") return { rows: [], rowCount: 0 };
      row.status = "funded";
      row.pingpay_status = "COMPLETED";
      row.funded_at = new Date();
      row.updated_at = new Date();
      if (amount_yocto != null) row.escrow_yocto = amount_yocto;
      return { rows: [clone(row)], rowCount: 1 };
    }

    // ── pending_missions: attach on-chain id (signed) ──
    if (/^UPDATE pending_missions\s+SET\s+status\s*=\s*'signed'/i.test(s)) {
      const onChainId = params[0];
      const id        = params[1];
      const guard     = params[2];
      const row = state.pending.get(id);
      if (!row) return { rows: [], rowCount: 0 };
      if (!["funded", "pending_payment"].includes(row.status)) return { rows: [], rowCount: 0 };
      if (guard && row.poster_wallet !== guard) return { rows: [], rowCount: 0 };
      row.status = "signed";
      row.resolved_on_chain_id = onChainId;
      row.signed_at = new Date();
      row.updated_at = new Date();
      return { rows: [clone(row)], rowCount: 1 };
    }

    // ── selects ──
    if (/^SELECT \* FROM pending_missions WHERE pingpay_session_id/i.test(s)) {
      const session_id = params[0];
      const row = [...state.pending.values()].find((r) => r.pingpay_session_id === session_id);
      return { rows: row ? [clone(row)] : [] };
    }
    if (/^SELECT \* FROM pending_missions WHERE id/i.test(s)) {
      const row = state.pending.get(Number(params[0]));
      return { rows: row ? [clone(row)] : [] };
    }

    throw new Error(`unmocked SQL: ${s.slice(0, 80)}`);
  }

  return { query, _state: state };
}

const fakeDb = makeFakeDb();
require.cache[dbClientPath] = {
  id: dbClientPath, filename: dbClientPath, loaded: true,
  exports: fakeDb,
};

// Now load the modules under test.
const checkout   = require("../services/pingpay/checkout");
const settlement = require("../services/pingpay/missionSettlement");

// ── Helper: deterministic webhook signing ──
const SECRET = "whsec_test_constant";
function sign({ body, ts }) {
  const payload = ts ? `${ts}.${body}` : body;
  return crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
}

// ────────────────────────────────────────────────────────────────
// Webhook signature verification
// ────────────────────────────────────────────────────────────────

test("verifyWebhookSignature accepts a freshly-signed body with t=,v1=", () => {
  process.env.PINGPAY_WEBHOOK_SECRET = SECRET;
  const ts   = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "sess_x", status: "COMPLETED" } } });
  const sig  = `t=${ts},v1=${sign({ body, ts })}`;
  assert.equal(checkout.verifyWebhookSignature(body, sig), true);
});

test("verifyWebhookSignature rejects a tampered body", () => {
  process.env.PINGPAY_WEBHOOK_SECRET = SECRET;
  const ts   = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "sess_x" } } });
  const sig  = `t=${ts},v1=${sign({ body, ts })}`;
  const tampered = body.replace("sess_x", "sess_y");
  assert.equal(checkout.verifyWebhookSignature(tampered, sig), false);
});

test("verifyWebhookSignature rejects a stale timestamp (>5min)", () => {
  process.env.PINGPAY_WEBHOOK_SECRET = SECRET;
  const ts   = String(Math.floor(Date.now() / 1000) - 60 * 60); // 1h old
  const body = JSON.stringify({ type: "checkout.session.completed" });
  const sig  = `t=${ts},v1=${sign({ body, ts })}`;
  assert.equal(checkout.verifyWebhookSignature(body, sig), false);
});

test("verifyWebhookSignature rejects when secret is unset", () => {
  delete process.env.PINGPAY_WEBHOOK_SECRET;
  const body = "{}";
  const sig  = `t=${Math.floor(Date.now() / 1000)},v1=${"a".repeat(64)}`;
  assert.equal(checkout.verifyWebhookSignature(body, sig), false);
});

test("verifyWebhookSignature accepts the bare-hex sandbox variant", () => {
  process.env.PINGPAY_WEBHOOK_SECRET = SECRET;
  const body = "ping";
  const bare = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  assert.equal(checkout.verifyWebhookSignature(body, bare), true);
});

test("verifyWebhookSignature rejects malformed headers", () => {
  process.env.PINGPAY_WEBHOOK_SECRET = SECRET;
  assert.equal(checkout.verifyWebhookSignature("{}", ""), false);
  assert.equal(checkout.verifyWebhookSignature("{}", "garbage"), false);
  assert.equal(checkout.verifyWebhookSignature("{}", "t=abc,v1=def"), false);
});

// ────────────────────────────────────────────────────────────────
// PingPay HTTP wrapper
// ────────────────────────────────────────────────────────────────

test("createSession POSTs JSON with the publishable key and parses response", async () => {
  process.env.PINGPAY_PUBLISHABLE_KEY = "pk_test_abc";
  process.env.PINGPAY_BASE_URL        = "https://pay.test/api";

  let captured;
  checkout.httpClient.fetch = async (url, init) => {
    captured = { url, init };
    return new Response(JSON.stringify({
      sessionId: "sess_123",
      sessionUrl: "https://pay.test/checkout/sess_123",
      status: "PENDING",
    }), { status: 200, headers: { "content-type": "application/json" } });
  };

  const out = await checkout.createSession({
    amountUsd: 12.34,
    successUrl: "https://app.test/payments/success",
    cancelUrl:  "https://app.test/payments/cancel",
    metadata:   { poster_wallet: "alice.near" },
  });
  assert.equal(out.sessionId, "sess_123");
  assert.equal(captured.url, "https://pay.test/api/checkout/sessions");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers["x-publishable-key"], "pk_test_abc");
  const body = JSON.parse(captured.init.body);
  assert.equal(body.amount, "12.34");
  assert.equal(body.currency, "USD");
  assert.equal(body.successUrl, "https://app.test/payments/success");
});

test("createSession surfaces UNAUTHENTICATED with status 401 from PingPay", async () => {
  process.env.PINGPAY_PUBLISHABLE_KEY = "pk_test_abc";
  checkout.httpClient.fetch = async () => new Response(
    JSON.stringify({ code: "UNAUTHENTICATED", message: "Invalid or missing publishable key." }),
    { status: 401, headers: { "content-type": "application/json" } },
  );
  await assert.rejects(
    checkout.createSession({
      amountUsd: 5,
      successUrl: "https://x/", cancelUrl: "https://y/",
    }),
    (err) => err.code === "UNAUTHENTICATED" && err.status === 401,
  );
});

test("createSession refuses an unconfigured publishable key", async () => {
  delete process.env.PINGPAY_PUBLISHABLE_KEY;
  await assert.rejects(
    checkout.createSession({ amountUsd: 1, successUrl: "https://x/", cancelUrl: "https://y/" }),
    (err) => err.code === "PINGPAY_UNCONFIGURED",
  );
});

test("getSession GETs by id and returns the body", async () => {
  process.env.PINGPAY_PUBLISHABLE_KEY = "pk_test_abc";
  process.env.PINGPAY_BASE_URL        = "https://pay.test/api";
  checkout.httpClient.fetch = async (url, init) => {
    assert.equal(url, "https://pay.test/api/checkout/sessions/sess_xyz");
    assert.equal(init.method, "GET");
    return new Response(JSON.stringify({ id: "sess_xyz", status: "COMPLETED" }), { status: 200 });
  };
  const out = await checkout.getSession("sess_xyz");
  assert.equal(out.status, "COMPLETED");
});

// ────────────────────────────────────────────────────────────────
// Settlement state machine
// ────────────────────────────────────────────────────────────────

test("createPending writes both rows and hashes inputs deterministically", async () => {
  const inputs = { city: "Lagos", priceCap: 1000 };
  const pending = await settlement.createPending({
    poster_wallet:      "alice.near",
    template_slug:      "verify-listing",
    kit_slug:           "wallet-watch",
    inputs_json:        inputs,
    escrow_amount_usd:  25,
    pingpay_session_id: "sess_aaa",
  });
  assert.equal(pending.status, "pending_payment");
  assert.equal(pending.poster_wallet, "alice.near");
  assert.equal(pending.pingpay_session_id, "sess_aaa");
  // Hash is stable regardless of property order.
  const reordered = settlement.hashInputs({ priceCap: 1000, city: "Lagos" });
  assert.equal(pending.inputs_hash, reordered);

  // The audit row was also seeded.
  const payment = fakeDb._state.payments.get("sess_aaa");
  assert.ok(payment);
  assert.equal(payment.status, "PENDING");
  assert.equal(payment.pending_mission_id, pending.id);
});

test("applyWebhookEvent flips pending → funded on checkout.session.completed", async () => {
  const pending = await settlement.createPending({
    poster_wallet: "bob.near",
    inputs_json: {},
    escrow_amount_usd: 10,
    pingpay_session_id: "sess_bbb",
  });
  const result = await settlement.applyWebhookEvent({
    type: "checkout.session.completed",
    data: { object: { id: "sess_bbb", status: "COMPLETED", routing: { amount_yocto: "1000000000000000000000000" } } },
  });
  assert.equal(result.applied, true);
  assert.equal(result.pending.status, "funded");
  assert.equal(result.pending.escrow_yocto, "1000000000000000000000000");
  // Audit row was updated to COMPLETED.
  assert.equal(fakeDb._state.payments.get("sess_bbb").status, "COMPLETED");
  // Original pending row is untouched.
  assert.equal(pending.status, "pending_payment");
});

test("applyWebhookEvent is idempotent on duplicate completed events", async () => {
  await settlement.createPending({
    poster_wallet: "carol.near",
    inputs_json: {},
    escrow_amount_usd: 7,
    pingpay_session_id: "sess_ccc",
  });
  const evt = {
    type: "checkout.session.completed",
    data: { object: { id: "sess_ccc", status: "COMPLETED" } },
  };
  const a = await settlement.applyWebhookEvent(evt);
  const b = await settlement.applyWebhookEvent(evt);
  assert.equal(a.applied, true);
  assert.equal(b.applied, false);
  assert.match(b.reason || "", /already funded|unknown/);
});

test("applyWebhookEvent records non-actionable events without flipping state", async () => {
  await settlement.createPending({
    poster_wallet: "dave.near",
    inputs_json: {},
    escrow_amount_usd: 12,
    pingpay_session_id: "sess_ddd",
  });
  const result = await settlement.applyWebhookEvent({
    type: "checkout.session.processing",
    data: { object: { id: "sess_ddd", status: "PROCESSING" } },
  });
  assert.equal(result.applied, false);
  // Pending row stays in pending_payment.
  const fresh = await settlement.findBySession("sess_ddd");
  assert.equal(fresh.status, "pending_payment");
});

test("attachOnChainId requires the same poster_wallet", async () => {
  const pending = await settlement.createPending({
    poster_wallet: "eve.near",
    inputs_json: {},
    escrow_amount_usd: 30,
    pingpay_session_id: "sess_eee",
  });
  await settlement.applyWebhookEvent({
    type: "checkout.session.completed",
    data: { object: { id: "sess_eee", status: "COMPLETED" } },
  });
  // Wrong wallet is rejected.
  const wrong = await settlement.attachOnChainId(pending.id, 4242, { wallet: "imposter.near" });
  assert.equal(wrong, null);
  // Right wallet succeeds.
  const right = await settlement.attachOnChainId(pending.id, 4242, { wallet: "eve.near" });
  assert.equal(right.status, "signed");
  assert.equal(right.resolved_on_chain_id, 4242);
});
