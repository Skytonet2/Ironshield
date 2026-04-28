// backend/routes/social.route.js
const express = require("express");
const router = express.Router();
const db = require("../db/client");
const { getOrCreateUser } = require("../services/feedHelpers");
const requireWallet = require("../middleware/requireWallet");
const { enqueue } = require("../services/batchWorker");
const { createAndPush } = require("../services/pushNotify");

async function notify(userId, type, actorId, postId) {
  if (!userId || userId === actorId) return;
  // createAndPush writes the notification row AND sends a push.
  createAndPush({ userId, actorId, postId, type }).catch(() => {});
}

// POST /api/social/like  body: { postId }
router.post("/like", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const { postId } = req.body || {};
    const ex = await db.query("SELECT id FROM feed_likes WHERE user_id=$1 AND post_id=$2", [user.id, postId]);
    let liked;
    if (ex.rows.length) {
      await db.query("DELETE FROM feed_likes WHERE id=$1", [ex.rows[0].id]);
      liked = false;
    } else {
      await db.query("INSERT INTO feed_likes (user_id, post_id) VALUES ($1,$2)", [user.id, postId]);
      liked = true;
      const author = await db.query("SELECT author_id FROM feed_posts WHERE id=$1", [postId]);
      if (author.rows[0]) notify(author.rows[0].author_id, "like", user.id, postId);
    }
    await enqueue(user.id, "like", { postId, liked });
    const c = await db.query("SELECT COUNT(*)::int AS c FROM feed_likes WHERE post_id=$1", [postId]);
    res.json({ liked, count: c.rows[0].c });
  } catch (e) { next(e); }
});

// POST /api/social/repost
router.post("/repost", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const { postId } = req.body || {};
    const ex = await db.query("SELECT id FROM feed_reposts WHERE user_id=$1 AND post_id=$2", [user.id, postId]);
    let reposted;
    if (ex.rows.length) {
      await db.query("DELETE FROM feed_reposts WHERE id=$1", [ex.rows[0].id]);
      reposted = false;
    } else {
      await db.query("INSERT INTO feed_reposts (user_id, post_id) VALUES ($1,$2)", [user.id, postId]);
      reposted = true;
      const author = await db.query("SELECT author_id FROM feed_posts WHERE id=$1", [postId]);
      if (author.rows[0]) notify(author.rows[0].author_id, "repost", user.id, postId);
    }
    await enqueue(user.id, "repost", { postId, reposted });
    const c = await db.query("SELECT COUNT(*)::int AS c FROM feed_reposts WHERE post_id=$1", [postId]);
    res.json({ reposted, count: c.rows[0].c });
  } catch (e) { next(e); }
});

// POST /api/social/comment  body: { postId, content, parentCommentId? }
// parentCommentId turns the comment into a nested reply — validated
// against the same post so users can't cross-link into another post's
// thread. Notifies the post author for top-level comments, and the
// PARENT comment's author for replies.
router.post("/comment", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const { postId, content } = req.body || {};
    if (!content || content.length > 500) return res.status(400).json({ error: "content required, max 500" });
    // Validate parent belongs to the same post if provided.
    let parentCommentId = null;
    if (req.body?.parentCommentId != null) {
      const pid = parseInt(req.body.parentCommentId, 10);
      if (Number.isFinite(pid)) {
        const p = await db.query(
          "SELECT post_id, author_id FROM feed_comments WHERE id=$1 LIMIT 1",
          [pid]
        );
        if (p.rows[0]?.post_id === postId) {
          parentCommentId = pid;
        }
      }
    }
    const r = await db.query(
      "INSERT INTO feed_comments (author_id, post_id, content, parent_comment_id) VALUES ($1,$2,$3,$4) RETURNING *",
      [user.id, postId, content, parentCommentId]);
    // Notification target: parent comment author for a reply,
    // post author for a top-level comment. Self-replies skip notify.
    if (parentCommentId) {
      const parent = await db.query(
        "SELECT author_id FROM feed_comments WHERE id=$1", [parentCommentId]
      );
      const target = parent.rows[0]?.author_id;
      if (target && target !== user.id) notify(target, "comment", user.id, postId);
    } else {
      const author = await db.query("SELECT author_id FROM feed_posts WHERE id=$1", [postId]);
      const target = author.rows[0]?.author_id;
      if (target && target !== user.id) notify(target, "comment", user.id, postId);
    }
    await enqueue(user.id, "comment", { postId, commentId: r.rows[0].id, parentCommentId });
    res.json({ comment: r.rows[0] });
  } catch (e) { next(e); }
});

// GET /api/social/comments/:postId
//
// Returns flat list ordered oldest→newest so the frontend can build
// a tree in O(n) via a single pass. Each row carries like_count +
// liked_by_viewer (when x-wallet is provided) so the comment-like
// button renders the right initial state without a second round-trip.
router.get("/comments/:postId", async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT c.*, u.username, u.display_name, u.pfp_url, u.account_type,
              u.wallet_address,
              (SELECT COUNT(*)::int FROM feed_comment_likes l
                 WHERE l.comment_id = c.id) AS like_count
         FROM feed_comments c JOIN feed_users u ON u.id = c.author_id
        WHERE c.post_id=$1 ORDER BY c.created_at ASC LIMIT 300`,
      [req.params.postId]);
    const comments = r.rows;

    // Viewer-state pass: which of these comments did the viewer like?
    // Bare x-wallet is enough — same trust posture as feed reads.
    const viewerWallet = req.header("x-wallet");
    let liked = new Set();
    if (viewerWallet && comments.length) {
      const viewer = await db.query(
        "SELECT id FROM feed_users WHERE LOWER(wallet_address) = LOWER($1) LIMIT 1",
        [viewerWallet]);
      const viewerId = viewer.rows[0]?.id;
      if (viewerId) {
        const ids = comments.map((c) => c.id);
        const likes = await db.query(
          "SELECT comment_id FROM feed_comment_likes WHERE user_id = $1 AND comment_id = ANY($2)",
          [viewerId, ids]);
        liked = new Set(likes.rows.map((r) => r.comment_id));
      }
    }
    for (const c of comments) c.liked_by_viewer = liked.has(c.id);

    res.json({ comments });
  } catch (e) { next(e); }
});

// POST /api/social/comment-like  body: { commentId }
// Toggle a like on a comment. Mirrors /like for posts. Returns the
// new viewer state + post-toggle count so the UI flips deterministically.
router.post("/comment-like", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const { commentId } = req.body || {};
    if (!commentId) return res.status(400).json({ error: "commentId required" });
    const ex = await db.query(
      "SELECT id FROM feed_comment_likes WHERE user_id=$1 AND comment_id=$2",
      [user.id, commentId]);
    let liked;
    if (ex.rows.length) {
      await db.query("DELETE FROM feed_comment_likes WHERE id=$1", [ex.rows[0].id]);
      liked = false;
    } else {
      await db.query(
        "INSERT INTO feed_comment_likes (user_id, comment_id) VALUES ($1,$2)",
        [user.id, commentId]);
      liked = true;
      // Notify the comment author. Reuse the post-likes notification
      // type — frontend renders "X liked your reply" vs "your post"
      // by checking the entity referenced.
      const author = await db.query(
        "SELECT author_id, post_id FROM feed_comments WHERE id=$1", [commentId]);
      if (author.rows[0]) {
        notify(author.rows[0].author_id, "comment_like", user.id, author.rows[0].post_id);
      }
    }
    const c = await db.query(
      "SELECT COUNT(*)::int AS c FROM feed_comment_likes WHERE comment_id=$1",
      [commentId]);
    res.json({ liked, count: c.rows[0].c });
  } catch (e) { next(e); }
});

// POST /api/social/comment-quote  body: { commentId, content }
// Quote-repost a comment as a new post. Creates a feed_posts row with
// quoted_comment_id set + the user's commentary in `content`. The
// renderer fetches + embeds the quoted comment by id at read time,
// same shape as quoted_post_id.
router.post("/comment-quote", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const { commentId, content } = req.body || {};
    if (!commentId) return res.status(400).json({ error: "commentId required" });
    const text = String(content || "").trim();
    if (text.length > 500) return res.status(400).json({ error: "content > 500 chars" });

    // Verify the comment exists; we tag the comment author + parent
    // post author for notifications.
    const cm = await db.query(
      "SELECT id, author_id, post_id FROM feed_comments WHERE id=$1 LIMIT 1",
      [commentId]);
    if (!cm.rows.length) return res.status(404).json({ error: "comment not found" });

    const ins = await db.query(
      `INSERT INTO feed_posts (author_id, content, quoted_comment_id)
       VALUES ($1, $2, $3) RETURNING *`,
      [user.id, text, commentId]);

    // Notify the quoted-comment author (skip if quoting yourself).
    if (cm.rows[0].author_id && cm.rows[0].author_id !== user.id) {
      notify(cm.rows[0].author_id, "comment_quote", user.id, ins.rows[0].id);
    }
    await enqueue(user.id, "comment-quote", { commentId, postId: ins.rows[0].id });
    res.json({ post: ins.rows[0] });
  } catch (e) { next(e); }
});

// GET /api/social/following-state?target=<wallet>
//
// Returns { following: bool } for the authed viewer vs the target
// wallet. Used by FollowButton to render the correct initial label
// without the "Follow → Following" flip on mount. Returns false for
// unauthed viewers, self-follow attempts, or when the target user
// row doesn't exist yet (nothing to follow).
router.get("/following-state", async (req, res, next) => {
  try {
    const target = String(req.query.target || "").trim();
    if (!target) return res.json({ following: false });
    const wallet = req.header("x-wallet");
    if (!wallet) return res.json({ following: false });
    const viewer = await getOrCreateUser(wallet);
    // Don't auto-create the target on a state-read — avoids inflating
    // the users table with drive-by lookups of handles that don't
    // exist. Look up strictly.
    const tRow = await db.query(
      "SELECT id FROM feed_users WHERE LOWER(wallet_address)=LOWER($1) LIMIT 1",
      [target]
    );
    if (!tRow.rows.length || tRow.rows[0].id === viewer.id) {
      return res.json({ following: false });
    }
    const r = await db.query(
      "SELECT 1 FROM feed_follows WHERE follower_id=$1 AND following_id=$2 LIMIT 1",
      [viewer.id, tRow.rows[0].id]
    );
    res.json({ following: r.rows.length > 0 });
  } catch (e) { next(e); }
});

// POST /api/social/follow  body: { targetWallet }
router.post("/follow", requireWallet, async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req.wallet);
    const target = await getOrCreateUser(req.body?.targetWallet);
    if (!target || target.id === user.id) return res.status(400).json({ error: "invalid target" });
    const ex = await db.query("SELECT id FROM feed_follows WHERE follower_id=$1 AND following_id=$2", [user.id, target.id]);
    let following;
    if (ex.rows.length) {
      await db.query("DELETE FROM feed_follows WHERE id=$1", [ex.rows[0].id]);
      following = false;
    } else {
      await db.query("INSERT INTO feed_follows (follower_id, following_id) VALUES ($1,$2)", [user.id, target.id]);
      following = true;
      notify(target.id, "follow", user.id, null);
    }
    await enqueue(user.id, "follow", { targetId: target.id, following });
    res.json({ following });
  } catch (e) { next(e); }
});

router.get("/followers/:userId", async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT u.id, u.wallet_address, u.username, u.display_name, u.pfp_url
         FROM feed_follows f JOIN feed_users u ON u.id = f.follower_id
        WHERE f.following_id=$1 ORDER BY f.created_at DESC LIMIT 200`, [req.params.userId]);
    res.json({ users: r.rows });
  } catch (e) { next(e); }
});

router.get("/following/:userId", async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT u.id, u.wallet_address, u.username, u.display_name, u.pfp_url
         FROM feed_follows f JOIN feed_users u ON u.id = f.following_id
        WHERE f.follower_id=$1 ORDER BY f.created_at DESC LIMIT 200`, [req.params.userId]);
    res.json({ users: r.rows });
  } catch (e) { next(e); }
});

// GET /api/social/search?q=foo&limit=6 — used by composer @mention picker.
// Matches prefix on username OR wallet_address (case-insensitive).
router.get("/search", async (req, res, next) => {
  try {
    // Strip a leading "@" — clients (composer @-mention picker, the
    // global SearchOverlay, anyone testing) often pass the user's raw
    // input which starts with @ since that's how handles render. The
    // username column stores the bare handle, so a `LIKE '%@x%'`
    // never matches.
    const q = String(req.query.q || "").toLowerCase().trim().replace(/^@+/, "");
    const limit = Math.min(20, Number(req.query.limit) || 6);
    if (!q) return res.json({ users: [] });
    const r = await db.query(
      `SELECT id, wallet_address, username, display_name, pfp_url, account_type, verified
         FROM feed_users
        WHERE LOWER(username) LIKE $1 OR LOWER(wallet_address) LIKE $1
        ORDER BY
          CASE WHEN LOWER(username) = $2 THEN 0
               WHEN LOWER(username) LIKE $3 THEN 1
               ELSE 2 END,
          username
        LIMIT $4`,
      [`%${q}%`, q, `${q}%`, limit]);
    res.json({ users: r.rows });
  } catch (e) { next(e); }
});

// GET /api/social/who-to-follow?limit=3
//
// Suggests users the viewer could follow. Strategy:
//   1. Prefer accounts the viewer does NOT already follow.
//   2. Rank by follower count (popular first), then by whether
//      the account is verified or has an agent/org badge.
//   3. Skip the viewer themself + any system account
//      (sys:ironnews, etc).
//
// Low-stakes endpoint — returns an empty list on any DB error so
// the right-rail fallback seeds kick in.
router.get("/who-to-follow", async (req, res) => {
  try {
    const limit = Math.min(10, Number(req.query.limit) || 3);
    const wallet = req.header("x-wallet");
    let viewerId = null;
    if (wallet) {
      const r = await db.query(
        "SELECT id FROM feed_users WHERE LOWER(wallet_address) = LOWER($1) LIMIT 1",
        [wallet]
      );
      viewerId = r.rows[0]?.id || null;
    }

    // Ranked query — followers DESC as the primary signal, with a
    // tiny verified bonus so early badged accounts surface over
    // noise.
    const params = [limit];
    let exclude = "AND u.wallet_address NOT LIKE 'sys:%'";
    if (viewerId) {
      params.unshift(viewerId);
      exclude += ` AND u.id <> $1
                   AND u.id NOT IN (SELECT following_id FROM feed_follows WHERE follower_id = $1)`;
    }
    const sql = `
      SELECT u.id, u.wallet_address, u.username, u.display_name,
             u.pfp_url, u.account_type, u.verified,
             COALESCE(f.cnt, 0) AS followers
        FROM feed_users u
   LEFT JOIN (SELECT following_id AS id, COUNT(*)::int AS cnt
                FROM feed_follows GROUP BY following_id) f
          ON f.id = u.id
       WHERE u.username IS NOT NULL ${exclude}
    ORDER BY COALESCE(f.cnt, 0) DESC,
             (u.verified IS TRUE) DESC,
             u.id DESC
       LIMIT $${params.length}`;
    const r = await db.query(sql, params);
    res.json({ users: r.rows });
  } catch {
    res.json({ users: [] });
  }
});

module.exports = router;
