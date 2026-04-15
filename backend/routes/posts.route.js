// backend/routes/posts.route.js
const express = require("express");
const router = express.Router();
const db = require("../db/client");
const { getOrCreateUser, requireWallet, postHash, hydratePosts } = require("../services/feedHelpers");
const { enqueue } = require("../services/batchWorker");

const ALLOWED_TIERS = ["Bronze", "Silver", "Gold", "Legendary"];

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
    } = req.body || {};

    const kind  = rawKind === "article" ? "article" : "post";
    const title = kind === "article" ? String(rawTitle || "").trim().slice(0, 200) : null;
    const limit = kind === "article" ? MAX_ARTICLE_CHARS : MAX_POST_CHARS;

    if (!content || !content.trim()) return res.status(400).json({ error: "content required" });
    if (content.length > limit) return res.status(400).json({ error: `content too long (max ${limit})` });
    if (kind === "article" && !title) return res.status(400).json({ error: "article title required" });

    const g = normalizeGate(gate);
    const ts = Date.now();
    const hash = postHash(content, user.id, ts);

    const r = await db.query(
      `INSERT INTO feed_posts
         (author_id, content, media_urls, media_type,
          quoted_post_id, repost_of_id, post_hash, onchain_tx,
          gate_type, gate_min_balance, gate_min_tier, gate_allowlist,
          kind, title)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        user.id, content, mediaUrls, mediaType,
        quotedPostId, repostOfId, hash, onchainTx,
        g?.type || null,
        g?.minBalance ?? null,
        g?.minTier || null,
        g?.allowlist ? JSON.stringify(g.allowlist) : null,
        kind, title,
      ]);

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
