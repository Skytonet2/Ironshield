// backend/routes/posts.route.js
const express = require("express");
const router = express.Router();
const db = require("../db/client");
const { getOrCreateUser, postHash, hydratePosts } = require("../services/feedHelpers");
const requireWallet = require("../middleware/requireWallet");
const { enqueue } = require("../services/batchWorker");

// Agent-economy feed services. Required lazily (re-required is cheap)
// inside handlers so a misconfigured IronClaw env var doesn't break
// the legacy social endpoints during boot.
const feedClassifier = require("../services/feedClassifier");
const agentMatcher   = require("../services/agentMatcher");
const bidEngine      = require("../services/bidEngine");

const ALLOWED_TIERS = ["Bronze", "Silver", "Gold", "Legendary"];
const POST_TYPES    = new Set(["chat", "mission", "bounty"]);

// Normalize an incoming gate object into the four column values stored on
// feed_posts. Returns null if no gate is set, otherwise
// { type, minBalance, minTier, allowlist }.
function normalizeGate(raw) {
  if (!raw || !raw.type) return null;
  const type = String(raw.type).toLowerCase();
  if (type === "balance") {
    const n = Number(raw.minBalance);
    if (!(n > 0)) return null;
    return { type: "balance", minBalance: n, minTier: null, allowlist: null };
  }
  if (type === "tier") {
    const tier = ALLOWED_TIERS.find(t => t.toLowerCase() === String(raw.minTier || "").toLowerCase());
    if (!tier) return null;
    return { type: "tier", minBalance: null, minTier: tier, allowlist: null };
  }
  if (type === "allowlist") {
    const list = Array.isArray(raw.allowlist)
      ? raw.allowlist.map(a => String(a).toLowerCase().trim()).filter(Boolean)
      : [];
    if (!list.length) return null;
    return { type: "allowlist", minBalance: null, minTier: null, allowlist: list };
  }
  return null;
}

// POST /api/posts  body: { content, mediaUrls?, mediaType?, quotedPostId?,
//                          repostOfId?, onchainTx?,
//                          gate?: { type, minBalance?|minTier?|allowlist? },
//                          kind?: 'post'|'article', title? }
const MAX_POST_CHARS    = 500;
const MAX_ARTICLE_CHARS = 50_000;

router.post("/", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const {
      content, mediaUrls = [], mediaType = "NONE",
      quotedPostId = null, repostOfId = null, onchainTx = null, gate = null,
      kind: rawKind = "post", title: rawTitle = null,
      // Agent-economy fields — all optional; absent = legacy chat post.
      type: rawType = "chat",
      escrowTx = null,
      escrowYocto = null,
    } = req.body || {};

    const kind  = rawKind === "article" ? "article" : "post";
    const title = kind === "article" ? String(rawTitle || "").trim().slice(0, 200) : null;
    const limit = kind === "article" ? MAX_ARTICLE_CHARS : MAX_POST_CHARS;
    const type  = POST_TYPES.has(rawType) ? rawType : "chat";

    if (!content || !content.trim()) return res.status(400).json({ error: "content required" });
    if (content.length > limit) return res.status(400).json({ error: `content too long (max ${limit})` });
    if (kind === "article" && !title) return res.status(400).json({ error: "article title required" });
    // Bounties must lock escrow at create-time so agents have something
    // to compete for. Mission posts can lock escrow at create-time
    // (preferred — agents bid against a known purse) or at hire-time.
    if (type === "bounty" && (!escrowTx || !escrowYocto)) {
      return res.status(400).json({ error: "bounty posts require escrowTx and escrowYocto" });
    }

    const g = normalizeGate(gate);
    const ts = Date.now();
    const hash = postHash(content, user.id, ts);

    const r = await db.query(
      `INSERT INTO feed_posts
         (author_id, content, media_urls, media_type,
          quoted_post_id, repost_of_id, post_hash, onchain_tx,
          gate_type, gate_min_balance, gate_min_tier, gate_allowlist,
          kind, title, type, escrow_tx, escrow_yocto, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        user.id, content, mediaUrls, mediaType,
        quotedPostId, repostOfId, hash, onchainTx,
        g?.type || null,
        g?.minBalance ?? null,
        g?.minTier || null,
        g?.allowlist ? JSON.stringify(g.allowlist) : null,
        kind, title,
        type,
        escrowTx,
        escrowYocto ? String(escrowYocto) : null,
        "open",
      ]);

    if (onchainTx) {
      await db.query("UPDATE feed_users SET last_post_tx=$1 WHERE id=$2", [onchainTx, user.id]);
    }
    await enqueue(user.id, "post", { postId: r.rows[0].id, hash, onchainTx });

    // Auto-classify mission/bounty posts in the background — don't block
    // the response on an LLM round-trip. Errors are swallowed; the
    // matcher endpoint will return an empty list until the cache fills.
    if (type === "mission" || type === "bounty") {
      setImmediate(() => {
        feedClassifier.classifyPost(r.rows[0].id, content)
          .catch((err) => console.warn(`[posts] classify post ${r.rows[0].id} failed: ${err.message}`));
      });
    }

    const [hydrated] = await hydratePosts([r.rows[0]], user.id);
    res.json({ post: hydrated });
  } catch (e) { next(e); }
});

// DELETE /api/posts/:id
router.delete("/:id", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const r = await db.query(
      "UPDATE feed_posts SET deleted_at = NOW() WHERE id=$1 AND author_id=$2 RETURNING id",
      [req.params.id, user.id]);
    if (!r.rows.length) return res.status(404).json({ error: "not found or not yours" });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// GET /api/posts/:id
router.get("/:id", async (req, res, next) => {
  try {
    const wallet = req.header("x-wallet");
    const viewer = wallet ? await getOrCreateUser(wallet) : null;
    const r = await db.query("SELECT * FROM feed_posts WHERE id=$1 AND deleted_at IS NULL", [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: "not found" });
    const [hydrated] = await hydratePosts(r.rows, viewer?.id);
    res.json({ post: hydrated });
  } catch (e) { next(e); }
});

// GET /api/posts/:id/share-meta — OG metadata for link previews
router.get("/:id/share-meta", async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT p.id, p.content, p.media_urls, u.display_name, u.username, u.pfp_url
         FROM feed_posts p JOIN feed_users u ON u.id = p.author_id
        WHERE p.id=$1 AND p.deleted_at IS NULL`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: "not found" });
    const p = r.rows[0];
    res.json({
      title: `${p.display_name || p.username} on IronFeed`,
      description: p.content.slice(0, 180),
      image: (p.media_urls && p.media_urls[0])
        || `${process.env.BACKEND_URL || ""}/api/posts/${p.id}/og.png`,
      url: `https://ironshield.near.page/#/feed/post/${p.id}`,
    });
  } catch (e) { next(e); }
});

// Lightweight OG image placeholder (mascot + post). Real impl uses satori.
router.get("/:id/og.png", async (req, res) => {
  res.redirect("https://ironshield.near.page/mascot.png");
});

// ── Agent-economy endpoints ────────────────────────────────────────────
// All scoped to a single mission/bounty post. Legacy chat posts are
// untouched — the existing read/like/comment/repost/tip surface keeps
// its current contract.

// GET /api/posts/:id/matched_agents?sort=reputation|fast|cheap|new|local&limit=20
//
// Returns the ranked agent sidebar for a mission/bounty post. Reads
// the post's cached classification; returns an empty list with a
// `pending: true` flag if the classifier hasn't filled the cache yet
// (the post-create path schedules this asynchronously).
router.get("/:id/matched_agents", async (req, res, next) => {
  try {
    const postId = parseInt(req.params.id, 10);
    if (!Number.isFinite(postId)) return res.status(400).json({ error: "invalid post id" });
    const sort  = String(req.query.sort  || "reputation");
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

    const cls = await feedClassifier.getClassification(postId);
    if (!cls || !cls.vertical) {
      return res.json({ agents: [], pending: true });
    }
    const agents = await agentMatcher.matchAgents({
      vertical: cls.vertical,
      geo:      cls.geo,
      sort,
      limit,
    });
    res.json({ agents, classification: cls });
  } catch (e) { next(e); }
});

// POST /api/posts/:id/bid  body: { pitch, stakeTx }
// Wallet header is the bidding agent's owner.
router.post("/:id/bid", requireWallet, async (req, res, next) => {
  try {
    const postId = parseInt(req.params.id, 10);
    if (!Number.isFinite(postId)) return res.status(400).json({ error: "invalid post id" });
    const { pitch, stakeTx } = req.body || {};
    const bid = await bidEngine.submitBid({
      postId,
      agentOwnerWallet: req.wallet,
      pitch,
      stakeTx,
    });
    res.json({ bid });
  } catch (e) {
    if (e instanceof bidEngine.BidError) {
      return res.status(e.status).json({ error: e.message, code: e.code });
    }
    next(e);
  }
});

// GET /api/posts/:id/bids
router.get("/:id/bids", async (req, res, next) => {
  try {
    const postId = parseInt(req.params.id, 10);
    if (!Number.isFinite(postId)) return res.status(400).json({ error: "invalid post id" });
    const bids = await bidEngine.listBidsForPost({ postId });
    res.json({ bids });
  } catch (e) { next(e); }
});

// POST /api/posts/:id/withdraw_bid  body: { bidId }
// Agent (req.wallet) self-service withdrawal.
router.post("/:id/withdraw_bid", requireWallet, async (req, res, next) => {
  try {
    const { bidId } = req.body || {};
    const bid = await bidEngine.withdrawBid({ bidId, agentOwnerWallet: req.wallet });
    res.json({ bid });
  } catch (e) {
    if (e instanceof bidEngine.BidError) {
      return res.status(e.status).json({ error: e.message, code: e.code });
    }
    next(e);
  }
});

// POST /api/posts/:id/hire  body: { bidId }
// Poster (req.wallet must equal the post's author) accepts a bid. The
// post status flips to 'hired'; a post_hires row is recorded; the
// frontend then takes the user through the wallet-signed create_mission
// call and PATCHes back the on-chain id via the next route.
router.post("/:id/hire", requireWallet, async (req, res, next) => {
  try {
    const postId = parseInt(req.params.id, 10);
    if (!Number.isFinite(postId)) return res.status(400).json({ error: "invalid post id" });
    const { bidId } = req.body || {};
    if (!bidId) return res.status(400).json({ error: "bidId required" });

    // Confirm caller owns the post.
    const postRow = await db.query(
      `SELECT p.id, p.author_id, p.type, p.status, u.wallet_address
         FROM feed_posts p JOIN feed_users u ON u.id = p.author_id
        WHERE p.id = $1 AND p.deleted_at IS NULL`,
      [postId]
    );
    const post = postRow.rows[0];
    if (!post) return res.status(404).json({ error: "post not found" });
    if (String(post.wallet_address).toLowerCase() !== String(req.wallet).toLowerCase()) {
      return res.status(403).json({ error: "only the post author can hire" });
    }
    if (!["mission", "bounty"].includes(post.type)) {
      return res.status(400).json({ error: `cannot hire on a '${post.type}' post` });
    }

    const { accepted, rejected } = await bidEngine.acceptBid({ postId, bidId });
    await db.query(
      `INSERT INTO post_hires (post_id, agent_owner_wallet, bid_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (post_id) DO UPDATE SET
         agent_owner_wallet = EXCLUDED.agent_owner_wallet,
         bid_id = EXCLUDED.bid_id,
         hired_at = NOW()`,
      [postId, accepted.agent_owner_wallet, accepted.id]
    );
    await db.query(
      `UPDATE feed_posts SET status = 'hired' WHERE id = $1`, [postId]);
    res.json({ accepted, rejected_count: rejected.length });
  } catch (e) {
    if (e instanceof bidEngine.BidError) {
      return res.status(e.status).json({ error: e.message, code: e.code });
    }
    next(e);
  }
});

// PATCH /api/posts/:id/hire  body: { mission_on_chain_id }
// Attaches the on-chain mission id to the hire row once the poster's
// wallet signs create_mission and the indexer or the frontend echoes
// back the id. Idempotent.
router.patch("/:id/hire", requireWallet, async (req, res, next) => {
  try {
    const postId = parseInt(req.params.id, 10);
    const onChainId = parseInt(req.body?.mission_on_chain_id, 10);
    if (!Number.isFinite(postId) || !Number.isFinite(onChainId)) {
      return res.status(400).json({ error: "invalid post id or mission_on_chain_id" });
    }
    const r = await db.query(
      `UPDATE post_hires
         SET mission_on_chain_id = $2
       WHERE post_id = $1
       RETURNING *`,
      [postId, onChainId]
    );
    if (!r.rows[0]) return res.status(404).json({ error: "no hire row for this post" });
    res.json({ hire: r.rows[0] });
  } catch (e) { next(e); }
});

// POST /api/posts/:id/bounty_attempts  body: { resultJson, score? }
// Agent submits an attempt against a bounty post. Wallet header is the
// agent owner. Multiple attempts per agent are allowed — the
// leaderboard sorts on score DESC.
router.post("/:id/bounty_attempts", requireWallet, async (req, res, next) => {
  try {
    const postId = parseInt(req.params.id, 10);
    if (!Number.isFinite(postId)) return res.status(400).json({ error: "invalid post id" });
    const post = await db.query(
      "SELECT type, status FROM feed_posts WHERE id = $1 AND deleted_at IS NULL",
      [postId]
    );
    if (!post.rows[0]) return res.status(404).json({ error: "post not found" });
    if (post.rows[0].type !== "bounty") return res.status(400).json({ error: "not a bounty post" });
    if (post.rows[0].status !== "open")  return res.status(409).json({ error: "bounty closed" });

    const { resultJson = {}, score = null } = req.body || {};
    const r = await db.query(
      `INSERT INTO bounty_attempts (post_id, agent_owner_wallet, result_json, score)
       VALUES ($1, $2, $3::jsonb, $4)
       RETURNING *`,
      [postId, req.wallet, JSON.stringify(resultJson), Number.isFinite(parseInt(score, 10)) ? parseInt(score, 10) : null]
    );
    res.json({ attempt: r.rows[0] });
  } catch (e) { next(e); }
});

// POST /api/posts/:id/report  body: { bidId?, reason }
// A poster (or any feed user) flags a bid or post as spam / off-topic.
// Inserts a 'pending' row in post_reports; the governance worker picks
// it up and either dismisses or upholds. Upheld → bidEngine.slashBid
// flips the bid to 'slashed' and the stake forfeits.
router.post("/:id/report", requireWallet, async (req, res, next) => {
  try {
    const postId = parseInt(req.params.id, 10);
    if (!Number.isFinite(postId)) return res.status(400).json({ error: "invalid post id" });
    const { bidId = null, reason } = req.body || {};
    if (!reason || typeof reason !== "string" || !reason.trim()) {
      return res.status(400).json({ error: "reason required" });
    }
    const reporter = await getOrCreateUser(req.wallet);
    const r = await db.query(
      `INSERT INTO post_reports (post_id, bid_id, reporter_id, reason)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [postId, bidId, reporter.id, reason.trim().slice(0, 500)]
    );
    res.json({ report: r.rows[0] });
  } catch (e) { next(e); }
});

// POST /api/posts/:id/dm  body: { body }
// Premium-gated direct message from an agent owner to a mission
// poster. Not the general DM surface — this one rides on top of a
// specific mission post so the inbox UI can show "agent X messaged
// you about your Camry post." Premium check is feed_users.premium_until
// > NOW(); falls through to 402 Payment Required if expired.
router.post("/:id/dm", requireWallet, async (req, res, next) => {
  try {
    const postId = parseInt(req.params.id, 10);
    if (!Number.isFinite(postId)) return res.status(400).json({ error: "invalid post id" });
    const { body } = req.body || {};
    if (!body || typeof body !== "string" || !body.trim()) {
      return res.status(400).json({ error: "body required" });
    }
    const sender = await getOrCreateUser(req.wallet);
    if (!sender.premium_until || new Date(sender.premium_until) <= new Date()) {
      return res.status(402).json({
        error: "premium DM required — upgrade to message posters",
        code:  "premium_required",
      });
    }
    // Confirm the post is mission/bounty and not deleted.
    const post = await db.query(
      "SELECT type, deleted_at FROM feed_posts WHERE id = $1", [postId]);
    if (!post.rows[0] || post.rows[0].deleted_at) return res.status(404).json({ error: "post not found" });
    if (!["mission", "bounty"].includes(post.rows[0].type)) {
      return res.status(400).json({ error: "DM is only available on mission/bounty posts" });
    }
    const r = await db.query(
      `INSERT INTO post_dms (post_id, agent_owner_wallet, body)
       VALUES ($1, $2, $3) RETURNING *`,
      [postId, req.wallet, body.trim().slice(0, 1000)]
    );
    res.json({ dm: r.rows[0] });
  } catch (e) { next(e); }
});

// GET /api/posts/:id/bounty_attempts?limit=50
// Public leaderboard read.
router.get("/:id/bounty_attempts", async (req, res, next) => {
  try {
    const postId = parseInt(req.params.id, 10);
    if (!Number.isFinite(postId)) return res.status(400).json({ error: "invalid post id" });
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const r = await db.query(
      `SELECT id, agent_owner_wallet, result_json, score, is_winner, created_at
         FROM bounty_attempts
        WHERE post_id = $1
        ORDER BY score DESC NULLS LAST, created_at DESC
        LIMIT $2`,
      [postId, limit]
    );
    res.json({ attempts: r.rows });
  } catch (e) { next(e); }
});

module.exports = router;
