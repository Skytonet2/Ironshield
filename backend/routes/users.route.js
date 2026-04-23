// backend/routes/users.route.js
// Per-user timeline endpoints used by the /profile page tabs:
//   GET /api/users/:key/posts    — authored, non-reposted posts
//   GET /api/users/:key/reposts  — posts the user has reposted
//   GET /api/users/:key/likes    — posts the user has liked
//                                   (owner-only: backend checks that the
//                                   x-wallet header matches the queried key
//                                   so one user's likes aren't exposed to
//                                   everyone)
//
// `:key` is a wallet address OR a username — same convention as
// /api/profile/:key. Missing users return an empty list rather than 404
// so the frontend's empty-state UI can render uniformly.
const express = require("express");
const router = express.Router();
const db = require("../db/client");
const { getOrCreateUser, requireWallet, hydratePosts } = require("../services/feedHelpers");

async function resolveUser(key) {
  const k = String(key || "").toLowerCase().trim();
  if (!k) return null;
  const r = await db.query(
    "SELECT * FROM feed_users WHERE LOWER(wallet_address)=$1 OR LOWER(username)=$1 LIMIT 1",
    [k]
  );
  return r.rows[0] || null;
}

function parseLimit(q) {
  const n = parseInt(q, 10);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : 30;
}

// GET /api/users/:key/posts — author timeline
router.get("/:key/posts", async (req, res, next) => {
  try {
    const user = await resolveUser(req.params.key);
    if (!user) return res.json({ posts: [] });
    const limit = parseLimit(req.query.limit);
    const r = await db.query(
      `SELECT * FROM feed_posts
         WHERE author_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC LIMIT $2`,
      [user.id, limit]
    );
    const viewerWallet = req.header("x-wallet");
    const viewer = viewerWallet ? await getOrCreateUser(viewerWallet) : null;
    res.json({ posts: await hydratePosts(r.rows, viewer?.id) });
  } catch (e) { next(e); }
});

// GET /api/users/:key/reposts — posts this user has reposted
router.get("/:key/reposts", async (req, res, next) => {
  try {
    const user = await resolveUser(req.params.key);
    if (!user) return res.json({ posts: [] });
    const limit = parseLimit(req.query.limit);
    // Join feed_reposts to their originals. repost_of_id on a post row
    // also captures reposts — but the explicit feed_reposts table tracks
    // "this user reposted this post" actions that may not have a
    // corresponding feed_posts row.
    const r = await db.query(
      `SELECT fp.*
         FROM feed_reposts fr
         JOIN feed_posts fp ON fp.id = fr.post_id
        WHERE fr.user_id = $1 AND fp.deleted_at IS NULL
        ORDER BY fr.created_at DESC
        LIMIT $2`,
      [user.id, limit]
    );
    const viewerWallet = req.header("x-wallet");
    const viewer = viewerWallet ? await getOrCreateUser(viewerWallet) : null;
    res.json({ posts: await hydratePosts(r.rows, viewer?.id) });
  } catch (e) {
    // feed_reposts may not exist on older DBs — fall back to posts
    // authored with repost_of_id set, then empty if that fails too.
    if (/does not exist|relation.*feed_reposts/i.test(e.message)) {
      try {
        const user = await resolveUser(req.params.key);
        if (!user) return res.json({ posts: [] });
        const limit = parseLimit(req.query.limit);
        const r = await db.query(
          `SELECT * FROM feed_posts
             WHERE author_id = $1 AND repost_of_id IS NOT NULL AND deleted_at IS NULL
             ORDER BY created_at DESC LIMIT $2`,
          [user.id, limit]
        );
        const viewerWallet = req.header("x-wallet");
        const viewer = viewerWallet ? await getOrCreateUser(viewerWallet) : null;
        return res.json({ posts: await hydratePosts(r.rows, viewer?.id) });
      } catch { return res.json({ posts: [] }); }
    }
    next(e);
  }
});

// GET /api/users/:key/likes — owner-only
router.get("/:key/likes", requireWallet, async (req, res, next) => {
  try {
    const target = await resolveUser(req.params.key);
    if (!target) return res.json({ posts: [] });
    const viewer = await getOrCreateUser(req.wallet);
    // Privacy: only the user themselves can see their full like list.
    // Others get an empty array (rather than 403) so the tab doesn't
    // render an error state when you click it on someone else's profile.
    if (!viewer || viewer.id !== target.id) return res.json({ posts: [] });
    const limit = parseLimit(req.query.limit);
    const r = await db.query(
      `SELECT fp.*
         FROM feed_likes fl
         JOIN feed_posts fp ON fp.id = fl.post_id
        WHERE fl.user_id = $1 AND fp.deleted_at IS NULL
        ORDER BY fl.created_at DESC
        LIMIT $2`,
      [target.id, limit]
    );
    res.json({ posts: await hydratePosts(r.rows, viewer.id) });
  } catch (e) { next(e); }
});

module.exports = router;
