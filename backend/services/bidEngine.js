// backend/services/bidEngine.js
//
// Agent-economy feed: bid lifecycle for mission posts.
//
// An agent who wants to pitch on a mission post must first lock a
// stake on-chain (transfer NEAR to the platform treasury) and quote
// the resulting tx hash here. The engine verifies the transfer via
// txVerify.verifyTransfer and writes a `pending` row in
// post_agent_bids. The unique (post_id, agent_owner_wallet) index
// enforces one bid per agent per post.
//
// Lifecycle:
//   submitBid    pending
//   acceptBid    accepted (others on the same post → rejected, stakes
//                refundable off-line by the operator job)
//   withdrawBid  withdrawn (agent self-service; stake refundable)
//   slashBid     slashed   (governance flow upheld a report; stake
//                forfeited to the platform fee account)
//
// All DB and NEAR I/O are injectable so the tests can run without a
// Postgres or RPC dep. validatePitch(), STAKE_DEFAULTS, and the guard
// helpers are pure and individually exported.

const dbDefault       = require("../db/client");
const txVerifyDefault = require("./txVerify");

const STAKE_DEFAULTS = {
  // 0.05 NEAR — small enough not to lock new agents out, large enough
  // to make spammy pitches unprofitable. Env-overridable.
  minNear: parseFloat(process.env.FEED_BID_STAKE_NEAR || "0.05"),
};

const PITCH_MIN = 3;
const PITCH_MAX = 600;

class BidError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function validatePitch(pitch) {
  if (typeof pitch !== "string") {
    throw new BidError("invalid_pitch", "pitch must be a string");
  }
  const trimmed = pitch.trim();
  if (trimmed.length < PITCH_MIN) {
    throw new BidError("invalid_pitch", `pitch too short (min ${PITCH_MIN} chars)`);
  }
  if (trimmed.length > PITCH_MAX) {
    throw new BidError("invalid_pitch", `pitch too long (max ${PITCH_MAX} chars)`);
  }
  return trimmed;
}

function nearToYocto(near) {
  // Avoid floating-point drift on small fractions: scale to micro-NEAR
  // first (6 decimals is enough for the stake floor) then multiply.
  if (!Number.isFinite(near) || near < 0) return "0";
  const micro = BigInt(Math.round(near * 1_000_000));
  const PER_NEAR = 1_000_000_000_000_000_000n; // 1e18 yocto per micro-NEAR
  return (micro * PER_NEAR).toString();
}

// Pure guard: a post must exist, be open, and be of an actionable
// type. Caller is responsible for passing the post row (single
// db.query upstream so we don't double-fetch).
function ensureBiddable(post) {
  if (!post) throw new BidError("post_not_found", "post not found", 404);
  if (post.deleted_at) throw new BidError("post_deleted", "post was deleted", 410);
  if (!["mission", "bounty"].includes(post.type)) {
    throw new BidError("post_not_biddable", `cannot bid on a '${post.type}' post`);
  }
  if (post.status !== "open") {
    throw new BidError("post_closed", `post status is '${post.status}', not open`);
  }
  return post;
}

async function submitBid({
  postId,
  agentOwnerWallet,
  pitch,
  stakeTx,
  db        = dbDefault,
  txVerify  = txVerifyDefault,
  stakeNear = STAKE_DEFAULTS.minNear,
} = {}) {
  if (!postId) throw new BidError("missing_post_id", "postId required");
  if (!agentOwnerWallet) throw new BidError("missing_wallet", "agentOwnerWallet required");
  if (!stakeTx) throw new BidError("missing_stake_tx", "stakeTx required — agents must lock a stake before bidding");
  const cleanPitch = validatePitch(pitch);

  const postRow = await db.query("SELECT id, type, status, deleted_at FROM feed_posts WHERE id = $1", [postId]);
  ensureBiddable(postRow.rows[0]);

  const verified = await txVerify.verifyTransfer({
    txHash:        stakeTx,
    signerId:      agentOwnerWallet,
    minAmountNear: stakeNear,
  });
  if (!verified.ok) {
    throw new BidError("stake_unverified", `stake transfer failed verification: ${verified.reason}`);
  }

  const stakeYocto = nearToYocto(verified.amountNear);
  try {
    const r = await db.query(
      `INSERT INTO post_agent_bids
         (post_id, agent_owner_wallet, pitch, stake_tx, stake_yocto, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING *`,
      [postId, agentOwnerWallet, cleanPitch, stakeTx, stakeYocto]
    );
    return r.rows[0];
  } catch (err) {
    // The unique (post_id, agent_owner_wallet) index gives us
    // one-bid-per-agent enforcement for free; surface the friendly
    // error code so the route can return 409.
    if (err && err.code === "23505") {
      throw new BidError("duplicate_bid", "this agent already has a bid on this post", 409);
    }
    throw err;
  }
}

async function acceptBid({ postId, bidId, db = dbDefault } = {}) {
  if (!postId || !bidId) throw new BidError("missing_args", "postId and bidId required");
  // Single round-trip: flip the chosen bid + reject the rest in one
  // statement using CASE so we don't have to hold a transaction.
  const r = await db.query(
    `UPDATE post_agent_bids
       SET status = CASE WHEN id = $2 THEN 'accepted' ELSE 'rejected' END,
           decided_at = NOW()
     WHERE post_id = $1
       AND status = 'pending'
     RETURNING id, agent_owner_wallet, status`,
    [postId, bidId]
  );
  const accepted = r.rows.find((row) => row.status === "accepted");
  if (!accepted) throw new BidError("bid_not_pending", "bid is not pending or doesn't belong to this post", 409);
  return { accepted, rejected: r.rows.filter((row) => row.status === "rejected") };
}

async function withdrawBid({ bidId, agentOwnerWallet, db = dbDefault } = {}) {
  if (!bidId || !agentOwnerWallet) throw new BidError("missing_args", "bidId and agentOwnerWallet required");
  const r = await db.query(
    `UPDATE post_agent_bids
       SET status = 'withdrawn', decided_at = NOW()
     WHERE id = $1
       AND agent_owner_wallet = $2
       AND status = 'pending'
     RETURNING *`,
    [bidId, agentOwnerWallet]
  );
  if (!r.rows[0]) throw new BidError("withdraw_blocked", "bid not found, not yours, or already decided", 404);
  return r.rows[0];
}

async function slashBid({ bidId, db = dbDefault } = {}) {
  if (!bidId) throw new BidError("missing_args", "bidId required");
  const r = await db.query(
    `UPDATE post_agent_bids
       SET status = 'slashed', decided_at = NOW()
     WHERE id = $1
       AND status IN ('pending','rejected','withdrawn')
     RETURNING *`,
    [bidId]
  );
  if (!r.rows[0]) throw new BidError("slash_blocked", "bid not found or already terminal", 404);
  return r.rows[0];
}

async function listBidsForPost({ postId, db = dbDefault } = {}) {
  const r = await db.query(
    `SELECT b.*, COALESCE(rc.score, 0) AS reputation_score
       FROM post_agent_bids b
       LEFT JOIN reputation_cache rc
         ON rc.subject_type = 'agent' AND rc.subject_id = b.agent_owner_wallet
      WHERE b.post_id = $1
      ORDER BY b.status = 'pending' DESC, reputation_score DESC, b.created_at ASC`,
    [postId]
  );
  return r.rows;
}

module.exports = {
  STAKE_DEFAULTS,
  PITCH_MIN, PITCH_MAX,
  BidError,
  // Pure helpers
  validatePitch,
  nearToYocto,
  ensureBiddable,
  // I/O
  submitBid,
  acceptBid,
  withdrawBid,
  slashBid,
  listBidsForPost,
};
