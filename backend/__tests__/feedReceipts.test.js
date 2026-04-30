// backend/__tests__/feedReceipts.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const EventEmitter = require("events");

const {
  computePayout,
  timeToCloseMs,
  formatHumanLine,
  buildReceipt,
  recordReceipt,
  subscribe,
  SYSTEM_AUTHOR_WALLET,
} = require("../services/feedReceipts");

test("computePayout subtracts platform fee in basis points", () => {
  // 1 NEAR = 1e24 yocto, 5% fee → 0.95 NEAR net.
  assert.equal(computePayout({ escrow_yocto: "1000000000000000000000000", platform_fee_bps: 500 }),
                              "950000000000000000000000");
  assert.equal(computePayout({ escrow_yocto: "1000000000000000000000000", platform_fee_bps: 0 }),
                              "1000000000000000000000000");
  assert.equal(computePayout({ escrow_yocto: null, platform_fee_bps: 500 }), "0");
});

test("timeToCloseMs returns null when either timestamp is missing or inverted", () => {
  assert.equal(timeToCloseMs(null, "2026-04-30T12:00:00Z"), null);
  assert.equal(timeToCloseMs("2026-04-30T12:00:00Z", null), null);
  assert.equal(timeToCloseMs("2026-04-30T13:00:00Z", "2026-04-30T12:00:00Z"), null);
});

test("timeToCloseMs returns ms-elapsed for a valid range", () => {
  const r = timeToCloseMs("2026-04-30T12:00:00Z", "2026-04-30T12:30:00Z");
  assert.equal(r, 30 * 60 * 1000);
});

test("formatHumanLine produces a status-specific human line", () => {
  assert.match(
    formatHumanLine({ status: "approved", kit_slug: "car-sales", claimant_wallet: "alice.near" }),
    /closed via car-sales — alice\.near/,
  );
  assert.match(
    formatHumanLine({ status: "expired", kit_slug: "wallet-watch" }),
    /^Mission expired via wallet-watch$/,
  );
});

test("buildReceipt pins approved-status receipts but not expired ones", () => {
  const approved = buildReceipt({
    on_chain_id: 42, status: "approved",
    kit_slug: "car-sales", claimant_wallet: "alice.near", poster_wallet: "bob.near",
    escrow_yocto: "1000000000000000000000000", platform_fee_bps: 500,
    claimed_at: "2026-04-30T12:00:00Z", finalized_at: "2026-04-30T12:05:00Z",
  });
  assert.equal(approved.pinned, true);
  assert.equal(approved.intent_json.kind, "receipt");
  assert.equal(approved.intent_json.mission_on_chain_id, 42);
  assert.equal(approved.intent_json.payout_yocto, "950000000000000000000000");
  assert.equal(approved.intent_json.time_to_close_ms, 5 * 60 * 1000);

  const expired = buildReceipt({ on_chain_id: 99, status: "expired", kit_slug: null });
  assert.equal(expired.pinned, false);
});

test("recordReceipt inserts a feed_posts row with the system author", async () => {
  let captured;
  const db = {
    query: async (sql, params) => {
      if (/SELECT id FROM feed_posts/.test(sql)) return { rows: [] };
      if (/INSERT INTO feed_posts/.test(sql)) {
        captured = { sql, params };
        return { rows: [{ id: 7 }] };
      }
      throw new Error("unexpected query: " + sql.slice(0, 80));
    },
  };
  const getOrCreateUser = async (wallet) => {
    assert.equal(wallet, SYSTEM_AUTHOR_WALLET);
    return { id: 999, wallet_address: wallet };
  };
  const r = await recordReceipt(
    {
      on_chain_id: 11, status: "approved",
      kit_slug: "car-sales", claimant_wallet: "alice.near", poster_wallet: "bob.near",
      escrow_yocto: "5000000000000000000000000", platform_fee_bps: 500,
      claimed_at: "2026-04-30T10:00:00Z", finalized_at: "2026-04-30T11:00:00Z",
    },
    { db, getOrCreateUser },
  );
  assert.equal(r.skipped, false);
  assert.equal(r.postId, 7);
  // author_id, content, intent_json, pinned
  assert.equal(captured.params[0], 999);
  assert.match(captured.params[1], /closed via car-sales/);
  assert.equal(captured.params[3], true);
  const intent = JSON.parse(captured.params[2]);
  assert.equal(intent.mission_on_chain_id, 11);
  assert.equal(intent.payout_yocto, "4750000000000000000000000");
});

test("recordReceipt is idempotent — duplicate mission events skip the insert", async () => {
  let inserts = 0;
  const db = {
    query: async (sql) => {
      if (/SELECT id FROM feed_posts/.test(sql)) return { rows: [{ id: 5 }] };
      if (/INSERT INTO feed_posts/.test(sql)) { inserts += 1; return { rows: [{ id: 999 }] }; }
      throw new Error("unexpected: " + sql.slice(0, 80));
    },
  };
  const r = await recordReceipt(
    { on_chain_id: 11, status: "approved" },
    { db, getOrCreateUser: async () => { throw new Error("should not be called"); } },
  );
  assert.equal(r.skipped, true);
  assert.equal(r.postId, 5);
  assert.equal(inserts, 0);
});

test("recordReceipt returns null for non-terminal statuses", async () => {
  const db = { query: async () => { throw new Error("no db calls expected"); } };
  const r = await recordReceipt(
    { on_chain_id: 11, status: "claimed" },
    { db, getOrCreateUser: async () => ({ id: 1 }) },
  );
  assert.equal(r, null);
});

test("subscribe wires mission.approved → recordReceipt; unsubscribe stops fan-out", async () => {
  const bus = new EventEmitter();
  const wrappedBus = {
    on: (channel, handler) => { bus.on(channel, handler); return () => bus.off(channel, handler); },
  };
  let inserts = 0;
  const db = {
    query: async (sql) => {
      if (/SELECT id FROM feed_posts/.test(sql)) return { rows: [] };
      if (/INSERT INTO feed_posts/.test(sql)) { inserts += 1; return { rows: [{ id: 1 }] }; }
      throw new Error("unexpected: " + sql.slice(0, 80));
    },
  };
  const getOrCreateUser = async () => ({ id: 100 });

  const unsub = subscribe({ eventBus: wrappedBus, db, getOrCreateUser });

  bus.emit("mission.approved", {
    on_chain_id: 1, status: "approved",
    kit_slug: "car-sales", claimant_wallet: "alice.near",
    escrow_yocto: "1000", platform_fee_bps: 0,
  });
  // Let the async handler resolve.
  await new Promise((r) => setImmediate(r));
  assert.equal(inserts, 1);

  unsub();
  bus.emit("mission.approved", { on_chain_id: 2, status: "approved" });
  await new Promise((r) => setImmediate(r));
  assert.equal(inserts, 1, "after unsubscribe, no new inserts");
});
