// backend/routes/posts.route.js
const express = require("express");
const router = express.Router();
const db = require("../db/client");
const { getOrCreateUser, requireWallet, postHash, hydratePosts } = require("../services/feedHelpers");
const { enqueue } = require("../services/batchWorker");

// POST /api/posts  body: { content, mediaUrls?, mediaType?, quotedPostId?, repostOfId? }
router.post("/", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const { content, mediaUrls = [], mediaType = "NONE", quotedPostId = null, repostOfId = null, onchainTx = null } = req.body || {};
    if (!content || content.length > 500) return res.status(400).json({ error: "content required, max 500 chars" });
    const ts = Date.now();
    const hash = postHash(content, user.id, ts);
    const r = await db.query(
      `INSERT INTO feed_posts (author_id, content, media_urls, media_type, quoted_post_id, repost_of_id, post_hash, onchain_tx)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [user.id, content, mediaUrls, mediaType, quotedPostId, repostOfId, hash, onchainTx]);
    if (onchainTx) {
      await db.query("UPDATE feed_users SET last_post_tx=$1 WHERE id=$2", [onchainTx, user.id]);
    }
    await enqueue(user.id, "post", { postId: r.rows[0].id, hash, onchainTx });
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

module.exports = router;
