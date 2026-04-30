// backend/services/feedReceipts.js
//
// Agent-economy feed: auto-authored receipt posts.
//
// When a mission flips to a terminal status (approved or expired),
// missionEngine.mirrorEvent emits 'mission.approved' / 'mission.expired'
// on the in-process eventBus. This service subscribes once at boot and
// authors a feed_posts row of type='receipt' attributed to the system
// user 'sys:receipts'.
//
// The receipt post carries structured fields in intent_json — kit_slug,
// agent wallet, time-to-close ms, payout yocto, status — so the
// frontend's FeedPostCard can render the "Use this Kit" / "Hire this
// agent" CTAs without re-fetching from the missions table.
//
// Pure helpers (buildReceipt, computePayout, formatHumanLine) carry the
// derivation logic and are exported for unit tests. The handler path
// onMissionTerminal() takes injectable db + author lookup so tests
// don't touch Postgres.

const dbDefault       = require("../db/client");
const eventBusDefault = require("./eventBus");
const feedHelpers     = require("./feedHelpers");

const SYSTEM_AUTHOR_WALLET = "sys:receipts";

// Mission row → claimant payout in yocto. The on-chain split also
// includes Kit-curator and platform-fee cuts, but for the receipt we
// show the "headline" net to the claimant: escrow * (10000 - fee)/10000.
// Off by Kit-curator bps in some cases — acceptable for a UX number.
function computePayout({ escrow_yocto, platform_fee_bps }) {
  if (!escrow_yocto) return "0";
  const e = BigInt(String(escrow_yocto));
  const feeBps = BigInt(platform_fee_bps || 0);
  if (feeBps <= 0n) return e.toString();
  const net = (e * (10000n - feeBps)) / 10000n;
  return net.toString();
}

function timeToCloseMs(claimedIso, finalizedIso) {
  if (!claimedIso || !finalizedIso) return null;
  const a = Date.parse(claimedIso);
  const b = Date.parse(finalizedIso);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return b - a;
}

function formatHumanLine({ status, kit_slug, claimant_wallet }) {
  const kit = kit_slug ? `via ${kit_slug}` : "";
  const who = claimant_wallet ? ` — ${claimant_wallet}` : "";
  if (status === "approved") return `Mission closed ${kit}${who}`.trim();
  if (status === "expired")  return `Mission expired ${kit}${who}`.trim();
  return `Mission ${status} ${kit}${who}`.trim();
}

function buildReceipt(payload) {
  const ttc = timeToCloseMs(payload.claimed_at, payload.finalized_at);
  const payout = computePayout(payload);
  return {
    content: formatHumanLine(payload),
    intent_json: {
      kind:               "receipt",
      mission_on_chain_id: Number(payload.on_chain_id),
      status:              payload.status,
      claimant_wallet:     payload.claimant_wallet || null,
      poster_wallet:       payload.poster_wallet || null,
      kit_slug:            payload.kit_slug || null,
      payout_yocto:        payout,
      time_to_close_ms:    ttc,
    },
    pinned: payload.status === "approved",
  };
}

// Persist a receipt for one mission terminal event. Idempotent: if a
// receipt for this mission already exists (intent_json->>'mission_on_chain_id'
// matches and type='receipt'), we skip — the event bus may re-fire if
// the indexer's tick reconciles a status it already mirrored.
async function recordReceipt(payload, {
  db = dbDefault,
  getOrCreateUser = feedHelpers.getOrCreateUser,
} = {}) {
  if (!payload || payload.on_chain_id == null) return null;
  if (!["approved", "expired"].includes(payload.status)) return null;

  const dup = await db.query(
    `SELECT id FROM feed_posts
      WHERE type = 'receipt'
        AND (intent_json->>'mission_on_chain_id')::bigint = $1
      LIMIT 1`,
    [Number(payload.on_chain_id)]
  );
  if (dup.rows[0]) return { skipped: true, postId: dup.rows[0].id };

  const author = await getOrCreateUser(SYSTEM_AUTHOR_WALLET);
  const receipt = buildReceipt(payload);
  const ins = await db.query(
    `INSERT INTO feed_posts
       (author_id, content, type, intent_json, pinned, status)
     VALUES ($1, $2, 'receipt', $3, $4, 'fulfilled')
     RETURNING id`,
    [author.id, receipt.content, JSON.stringify(receipt.intent_json), receipt.pinned]
  );
  return { skipped: false, postId: ins.rows[0].id, receipt };
}

let _started = false;
let _unsubs = [];

function subscribe({ eventBus = eventBusDefault, ...deps } = {}) {
  if (_started) return () => {}; // singleton — safe to call multiple times
  _started = true;
  const handler = async (payload) => {
    try { await recordReceipt(payload, deps); }
    catch (err) {
      console.warn(`[feedReceipts] recordReceipt failed: ${err && err.message}`);
    }
  };
  _unsubs.push(eventBus.on("mission.approved", handler));
  _unsubs.push(eventBus.on("mission.expired",  handler));
  return () => {
    for (const u of _unsubs) try { u(); } catch (_) {}
    _unsubs = [];
    _started = false;
  };
}

module.exports = {
  SYSTEM_AUTHOR_WALLET,
  // Pure helpers — exported for unit tests
  computePayout,
  timeToCloseMs,
  formatHumanLine,
  buildReceipt,
  // I/O paths
  recordReceipt,
  subscribe,
};
