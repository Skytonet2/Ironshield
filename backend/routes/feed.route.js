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

module.exports = router;
