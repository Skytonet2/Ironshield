// backend/routes/feed.route.js
const express = require("express");
const router = express.Router();
const db = require("../db/client");
const { getOrCreateUser, hydratePosts } = require("../services/feedHelpers");
const { rankForYou, rankFollowing } = require("../services/feedRanker");

// GET /api/feed/foryou?cursor=&limit=20
router.get("/foryou", async (req, res, next) => {
  try {
    const wallet = req.header("x-wallet");
    const viewer = wallet ? await getOrCreateUser(wallet) : null;
    const limit  = Math.min(parseInt(req.query.limit) || 20, 50);
    const cursor = req.query.cursor || null;
    const { posts, nextCursor } = await rankForYou(viewer?.id, limit, cursor);
    const hydrated = await hydratePosts(posts, viewer?.id);
    res.json({ posts: hydrated, nextCursor });
  } catch (e) { next(e); }
});

// GET /api/feed/following?cursor=&limit=20
router.get("/following", async (req, res, next) => {
  try {
    const wallet = req.header("x-wallet");
    if (!wallet) return res.json({ posts: [], nextCursor: null });
    const viewer = await getOrCreateUser(wallet);
    const limit  = Math.min(parseInt(req.query.limit) || 20, 50);
    const cursor = req.query.cursor || null;
    const { posts, nextCursor } = await rankFollowing(viewer.id, limit, cursor);
    const hydrated = await hydratePosts(posts, viewer.id);
    res.json({ posts: hydrated, nextCursor });
  } catch (e) { next(e); }
});

// POST /api/feed/engagement  body: { postId, dwellMs }
router.post("/engagement", async (req, res, next) => {
  try {
    const wallet = req.header("x-wallet");
    if (!wallet) return res.status(401).json({ error: "wallet required" });
    const viewer = await getOrCreateUser(wallet);
    const { postId, dwellMs } = req.body || {};
    if (!postId || !dwellMs) return res.status(400).json({ error: "postId and dwellMs required" });
    await db.query(
      "INSERT INTO feed_engagement (user_id, post_id, dwell_ms) VALUES ($1,$2,$3)",
      [viewer.id, postId, Math.min(dwellMs, 600_000)]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// POST /api/feed/impression  body: { postId, viewerWallet? }
//
// Matches spec §8D: "impressions = the card crossed the viewport and
// stayed for ≥ 1s". The client (useImpression hook) is the
// authoritative source of the 1s dwell — we just record the unique
// (user, post, session) row and increment the cached counter.
//
// The unique index on feed_post_impressions handles dedupe via
// ON CONFLICT. That keeps the counter honest even if two tabs fire
// for the same post at the same time, without a CAS loop.
//
// Author own-views are short-circuited client-side. We also guard
// here with a NOT = author_id check so a rogue client can't pad
// their own post.
router.post("/impression", async (req, res, next) => {
  try {
    const wallet = req.header("x-wallet") || (req.body && req.body.viewerWallet) || null;
    // Unauthed viewers are fine — we just don't dedupe them server-
    // side (no user_id to key off). Record nothing rather than
    // inflate the counter with anonymous traffic; the 1s-dwell
    // client-side bar is already strict enough that author-panning
    // won't spike things.
    if (!wallet) return res.json({ ok: true, skipped: "no-wallet" });
    const { postId } = req.body || {};
    if (!postId) return res.status(400).json({ error: "postId required" });

    const viewer = await getOrCreateUser(wallet);
    const authorRow = await db.query(
      "SELECT author_id FROM feed_posts WHERE id = $1 LIMIT 1",
      [postId]
    );
    const authorId = authorRow.rows[0]?.author_id;
    if (authorId && authorId === viewer.id) {
      return res.json({ ok: true, skipped: "own-post" });
    }

    // Insert the dedupe row; bump the counter only when it actually
    // landed. The returning clause tells us whether the insert hit
    // an existing unique row.
    const ins = await db.query(
      `INSERT INTO feed_post_impressions (user_id, post_id, session_date)
         VALUES ($1, $2, CURRENT_DATE)
       ON CONFLICT (user_id, post_id, session_date) DO NOTHING
       RETURNING id`,
      [viewer.id, postId]
    );
    if (ins.rowCount > 0) {
      await db.query(
        "UPDATE feed_posts SET impressions = COALESCE(impressions, 0) + 1 WHERE id = $1",
        [postId]
      );
    }
    res.json({ ok: true, counted: ins.rowCount > 0 });
  } catch (e) { next(e); }
});

// POST /api/feed/coin-it
//
// Logs an intent to launch a token derived from a feed post, news
// article, or external source (spec §8A). Full launch flow (IronClaw
// name-suggest + chain deploy) rides on top of the launchpad selector
// shipping in Phase 5; this endpoint captures the funnel entry point
// so we can track conversion rates from day one.
//
// coin_address is nullable because the actual on-chain deploy may
// happen on an external platform (Pump.fun, meme.cooking, etc.)
// where we don't control the resulting CA. Ironshield-Pad launches
// come back and update this row via a separate PATCH.
router.post("/coin-it", async (req, res, next) => {
  try {
    const wallet = req.header("x-wallet");
    const b = req.body || {};
    if (!b.source_type || !["post", "news", "external"].includes(b.source_type)) {
      return res.status(400).json({ error: "source_type must be post|news|external" });
    }
    if (!b.chain || !["near", "sol", "bnb"].includes(b.chain)) {
      return res.status(400).json({ error: "chain must be near|sol|bnb" });
    }
    if (!b.name || !b.ticker) {
      return res.status(400).json({ error: "name + ticker required" });
    }

    const userId = wallet ? (await getOrCreateUser(wallet)).id : null;
    const r = await db.query(
      `INSERT INTO coin_it_events (
         user_id, source_type, source_post_id, source_url,
         chain, platform, name, ticker, coin_address
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        userId,
        b.source_type,
        b.source_post_id || null,
        b.source_url     || null,
        b.chain,
        b.platform || "ironshield",
        String(b.name).slice(0, 120),
        String(b.ticker).slice(0, 10),
        b.coin_address || null,
      ]
    );
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) { next(e); }
});

module.exports = router;
