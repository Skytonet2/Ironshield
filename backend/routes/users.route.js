// backend/routes/users.route.js
// Per-user timeline endpoints used by the /profile page tabs:
//   GET /api/users/:key/posts    — authored, non-reposted posts
//   GET /api/users/:key/reposts  — posts the user has reposted
//   GET /api/users/:key/likes    — posts the user has liked
//
// `:key` is a wallet address OR a username — same convention as
// /api/profile/:key. Missing users return an empty list rather than 404
// so the frontend's empty-state UI can render uniformly.
const express = require("express");
const router = express.Router();
const db = require("../db/client");
const { getOrCreateUser, hydratePosts } = require("../services/feedHelpers");
const feedHub = require("../ws/feedHub");

// GET /api/users/presence?wallet=<address>
//   { online: bool, lastSeenAt: ISO|null }
//
// Initial-state lookup for the DM header presence badge. Live
// transitions ride on the WS `presence:update` broadcasts; clients
// call this once on conversation open so they don't have to wait
// for the next 0↔1 crossing.
router.get("/presence", async (req, res, next) => {
  try {
    const wallet = String(req.query.wallet || "").toLowerCase().trim();
    if (!wallet) return res.status(400).json({ error: "wallet required" });
    const online = feedHub.hasAuthedSocket(wallet);
    let lastSeenAt = null;
    if (!online) {
      const r = await db.query(
        "SELECT last_seen_at FROM feed_users WHERE LOWER(wallet_address) = $1 LIMIT 1",
        [wallet]
      );
      const ts = r.rows[0]?.last_seen_at;
      if (ts) lastSeenAt = new Date(ts).toISOString();
    }
    res.json({ online, lastSeenAt });
  } catch (e) { next(e); }
});

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

// GET /api/users/:key/replies — comments this user has authored,
// each one paired with its parent post for context. Profile page
// renders these as { reply, parent_post } pairs.
router.get("/:key/replies", async (req, res, next) => {
  try {
    const target = await resolveUser(req.params.key);
    if (!target) return res.json({ replies: [] });
    const limit = parseLimit(req.query.limit);
    // Pull the user's comments + the post each one is on. Parent
    // posts run through the same hydration as everywhere else so the
    // PostCard renderer can be reused without a special branch.
    const cm = await db.query(
      `SELECT c.id AS comment_id, c.content AS comment_content,
              c.created_at AS comment_created_at, c.parent_comment_id,
              c.post_id,
              (SELECT COUNT(*)::int FROM feed_comment_likes l
                 WHERE l.comment_id = c.id) AS like_count
         FROM feed_comments c
        WHERE c.author_id = $1
        ORDER BY c.created_at DESC
        LIMIT $2`,
      [target.id, limit]
    );
    if (!cm.rows.length) return res.json({ replies: [] });

    const postIds = [...new Set(cm.rows.map((r) => r.post_id))];
    const ps = await db.query(
      "SELECT * FROM feed_posts WHERE id = ANY($1) AND deleted_at IS NULL",
      [postIds]
    );
    const viewerWallet = req.header("x-wallet");
    const viewer = viewerWallet ? await getOrCreateUser(viewerWallet) : null;
    const hydrated = await hydratePosts(ps.rows, viewer?.id);
    const byId = new Map(hydrated.map((p) => [p.id, p]));

    const replies = cm.rows
      .map((row) => {
        const parent = byId.get(row.post_id);
        if (!parent) return null;  // parent deleted
        return {
          comment: {
            id: row.comment_id,
            content: row.comment_content,
            created_at: row.comment_created_at,
            parent_comment_id: row.parent_comment_id,
            like_count: row.like_count,
          },
          parent_post: parent,
        };
      })
      .filter(Boolean);

    res.json({ replies });
  } catch (e) { next(e); }
});

// GET /api/users/:key/likes — posts this user has liked
router.get("/:key/likes", async (req, res, next) => {
  try {
    const target = await resolveUser(req.params.key);
    if (!target) return res.json({ posts: [] });
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
    const viewerWallet = req.header("x-wallet");
    const viewer = viewerWallet ? await getOrCreateUser(viewerWallet) : null;
    res.json({ posts: await hydratePosts(r.rows, viewer?.id) });
  } catch (e) { next(e); }
});

module.exports = router;
