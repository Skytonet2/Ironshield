// backend/__tests__/bidEngine.test.js

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validatePitch,
  nearToYocto,
  ensureBiddable,
  submitBid,
  acceptBid,
  withdrawBid,
  slashBid,
  BidError,
  PITCH_MAX,
} = require("../services/bidEngine");

function fakeDb({ post, insertHandler, updateHandler }) {
  return {
    query: async (sql, params) => {
      if (/SELECT id, type, status, deleted_at FROM feed_posts/.test(sql)) {
        return { rows: post ? [post] : [] };
      }
      if (/INSERT INTO post_agent_bids/.test(sql)) {
        return insertHandler(sql, params);
      }
      if (/UPDATE post_agent_bids/.test(sql)) {
        return updateHandler(sql, params);
      }
      throw new Error("unexpected query: " + sql.slice(0, 80));
    },
  };
}

const okVerifier = { verifyTransfer: async () => ({ ok: true, amountNear: 0.05, receiver: "ironshield.near" }) };

test("validatePitch trims, enforces length bounds", () => {
  assert.equal(validatePitch("  hello world  "), "hello world");
  assert.throws(() => validatePitch(""), /pitch too short/);
  assert.throws(() => validatePitch("a"), /pitch too short/);
  assert.throws(() => validatePitch("x".repeat(PITCH_MAX + 1)), /pitch too long/);
  assert.throws(() => validatePitch(42), /pitch must be a string/);
});

test("nearToYocto handles fractional NEAR without float drift", () => {
  assert.equal(nearToYocto(0.05), "50000000000000000000000");  // 5e22
  assert.equal(nearToYocto(1),    "1000000000000000000000000"); // 1e24
  assert.equal(nearToYocto(0),    "0");
  assert.equal(nearToYocto(-1),   "0"); // never negative
});

test("ensureBiddable rejects missing/closed/non-mission posts", () => {
  assert.throws(() => ensureBiddable(null), /post not found/);
  assert.throws(() => ensureBiddable({ id: 1, type: "chat",    status: "open" }), /cannot bid on a 'chat' post/);
  assert.throws(() => ensureBiddable({ id: 1, type: "mission", status: "hired" }), /post status is 'hired'/);
  assert.throws(() => ensureBiddable({ id: 1, type: "mission", status: "open", deleted_at: new Date() }), /post was deleted/);
  assert.doesNotThrow(() => ensureBiddable({ id: 1, type: "mission", status: "open" }));
  assert.doesNotThrow(() => ensureBiddable({ id: 1, type: "bounty",  status: "open" }));
});

test("submitBid happy path: verifies stake and inserts pending row", async () => {
  const db = fakeDb({
    post: { id: 7, type: "mission", status: "open" },
    insertHandler: async (_sql, params) => {
      assert.equal(params[0], 7);
      assert.equal(params[1], "alice.near");
      assert.equal(params[2], "I have 50 sales in Minna last month");
      assert.equal(params[3], "TXHASH");
      assert.equal(params[4], "50000000000000000000000");
      return { rows: [{ id: 1, post_id: 7, agent_owner_wallet: "alice.near", status: "pending" }] };
    },
  });
  const bid = await submitBid({
    postId: 7,
    agentOwnerWallet: "alice.near",
    pitch: "I have 50 sales in Minna last month",
    stakeTx: "TXHASH",
    db, txVerify: okVerifier,
  });
  assert.equal(bid.status, "pending");
});

test("submitBid rejects when stake tx fails verification", async () => {
  const db = fakeDb({
    post: { id: 7, type: "mission", status: "open" },
    insertHandler: async () => { throw new Error("should not insert"); },
  });
  const badVerifier = {
    verifyTransfer: async () => ({ ok: false, reason: "amount 0.001 < 0.05" }),
  };
  await assert.rejects(
    submitBid({
      postId: 7, agentOwnerWallet: "alice.near", pitch: "valid pitch",
      stakeTx: "BADTX", db, txVerify: badVerifier,
    }),
    (err) => err instanceof BidError && err.code === "stake_unverified",
  );
});

test("submitBid translates the unique-violation 23505 to duplicate_bid 409", async () => {
  const db = fakeDb({
    post: { id: 7, type: "mission", status: "open" },
    insertHandler: async () => { const e = new Error("dup"); e.code = "23505"; throw e; },
  });
  await assert.rejects(
    submitBid({
      postId: 7, agentOwnerWallet: "alice.near", pitch: "valid pitch",
      stakeTx: "TXHASH", db, txVerify: okVerifier,
    }),
    (err) => err instanceof BidError && err.code === "duplicate_bid" && err.status === 409,
  );
});

test("submitBid blocks non-mission post types before touching the chain", async () => {
  let verifyCalled = false;
  const db = fakeDb({
    post: { id: 7, type: "chat", status: "open" },
    insertHandler: async () => { throw new Error("should not insert"); },
  });
  const verifier = { verifyTransfer: async () => { verifyCalled = true; return { ok: true, amountNear: 1 }; } };
  await assert.rejects(
    submitBid({
      postId: 7, agentOwnerWallet: "alice.near", pitch: "valid pitch",
      stakeTx: "TX", db, txVerify: verifier,
    }),
    (err) => err.code === "post_not_biddable",
  );
  assert.equal(verifyCalled, false, "stake should not be verified for non-biddable posts");
});

test("acceptBid flips chosen → accepted, others → rejected in one query", async () => {
  let captured;
  const db = {
    query: async (sql, params) => {
      captured = { sql, params };
      return { rows: [
        { id: 1, agent_owner_wallet: "a.near", status: "rejected" },
        { id: 2, agent_owner_wallet: "b.near", status: "accepted" },
        { id: 3, agent_owner_wallet: "c.near", status: "rejected" },
      ]};
    },
  };
  const r = await acceptBid({ postId: 7, bidId: 2, db });
  assert.match(captured.sql, /CASE WHEN id = \$2 THEN 'accepted' ELSE 'rejected' END/);
  assert.equal(r.accepted.id, 2);
  assert.equal(r.rejected.length, 2);
});

test("acceptBid throws bid_not_pending when no row landed in 'accepted'", async () => {
  const db = { query: async () => ({ rows: [{ id: 1, status: "rejected" }] }) };
  await assert.rejects(
    acceptBid({ postId: 7, bidId: 2, db }),
    (err) => err.code === "bid_not_pending" && err.status === 409,
  );
});

test("withdrawBid only succeeds for owning wallet on a pending bid", async () => {
  const db = { query: async (_sql, params) => {
    assert.equal(params[0], 5);
    assert.equal(params[1], "alice.near");
    return { rows: [{ id: 5, status: "withdrawn" }] };
  }};
  const r = await withdrawBid({ bidId: 5, agentOwnerWallet: "alice.near", db });
  assert.equal(r.status, "withdrawn");
});

test("withdrawBid throws when no row matched (foreign wallet, already decided)", async () => {
  const db = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    withdrawBid({ bidId: 5, agentOwnerWallet: "bob.near", db }),
    (err) => err.code === "withdraw_blocked" && err.status === 404,
  );
});

test("slashBid flips pending/rejected/withdrawn → slashed", async () => {
  const db = { query: async (sql) => {
    assert.match(sql, /status = 'slashed'/);
    assert.match(sql, /status IN \('pending','rejected','withdrawn'\)/);
    return { rows: [{ id: 9, status: "slashed" }] };
  }};
  const r = await slashBid({ bidId: 9, db });
  assert.equal(r.status, "slashed");
});

test("slashBid refuses to slash an already-accepted bid (would steal earned stake)", async () => {
  const db = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    slashBid({ bidId: 9, db }),
    (err) => err.code === "slash_blocked",
  );
});
