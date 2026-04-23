// backend/routes/feed.route.js
const express = require("express");
const router = express.Router();
const db = require("../db/client");
const { getOrCreateUser, hydratePosts } = require("../services/feedHelpers");
const { rankForYou, rankFollowing } = require("../services/feedRanker");
const {
  VOICES_PRESET_HANDLES, categoryOf,
} = require("../data/voicesPreset");
const trendingAgent = require("../services/trendingAgent");

// GET /api/feed/trending?limit=5
//
// Served from the agent-managed in-memory cache; falls back to the
// agent_trending_topics table when cold. Shape mirrors the Feed
// right-rail's expected schema: { topics: [{ tag, count, dir }] }
router.get("/trending", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 5, 20);
  try {
    const topics = await trendingAgent.getTopics(limit);
    res.json({
      topics: topics.map((t) => ({
        tag:   t.tag,
        count: compactCount(t.count),
        dir:   t.direction || "up",
        kind:  t.kind || "hash",
        summary: t.summary || null,
      })),
    });
  } catch (e) {
    res.json({ topics: [], error: e.message });
  }
});

function compactCount(n) {
  const v = Number(n || 0);
  if (v < 1000) return String(v);
  if (v < 1_000_000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K`;
  return `${(v / 1_000_000).toFixed(1)}M`;
}

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

// GET /api/feed/voices?limit=30
//
// The Voices tab — a mixed stream of two sources:
//   1. Native IronShield posts flagged as Voice
//      (feed_posts.media_type = 'VOICE' OR kind = 'voice')
//   2. Recent tweets from the 200-handle Voices preset via Nitter
//      (shaped into the same post object as native posts, so the
//      frontend FeedCard can render both identically).
//
// Shown in reverse-chronological order, with each post carrying a
// `voice_category` field so UI can filter by politics/crypto/etc.
router.get("/voices", async (req, res, next) => {
  try {
    const wallet = req.header("x-wallet");
    const viewer = wallet ? await getOrCreateUser(wallet) : null;
    const limit  = Math.min(parseInt(req.query.limit) || 30, 100);
    const filterCategory = String(req.query.category || "").toLowerCase() || null;

    // `?categories=` is the multi-select version the Settings → Voices
    // tab uses. Falls back to all categories when unspecified so
    // backward compat is preserved for older frontends. `?handles=` is
    // the user's custom add-list — always included regardless of
    // categories.
    const { VOICES_CATEGORIES } = require("../data/voicesPreset");
    const rawCats = String(req.query.categories || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
    const catSet = rawCats.length
      ? new Set(rawCats.filter((c) => Object.hasOwn(VOICES_CATEGORIES, c)))
      : null; // null = all
    const customHandlesRaw = String(req.query.handles || "").split(",").map((s) => s.trim()).filter(Boolean);
    const customHandles = customHandlesRaw
      .filter((h) => /^[A-Za-z0-9_]{1,15}$/.test(h))
      .slice(0, 20);

    // 1. Native voice posts.
    const nativeQ = await db.query(
      `SELECT p.* FROM feed_posts p
       WHERE p.deleted_at IS NULL
         AND (p.media_type = 'VOICE' OR p.kind = 'voice')
       ORDER BY p.id DESC
       LIMIT $1`,
      [limit]
    );
    const native = await hydratePosts(nativeQ.rows, viewer?.id);
    const nativeShaped = native.map((p) => ({ ...p, voice_category: null }));

    // 2. Preset tweets via xfeed's in-module helpers. Importing the
    //    route module gets us cache + fetch semantics for free. If
    //    NITTER_BASE_URL isn't set, this returns an empty list and the
    //    client falls back to just the native posts.
    let external = [];
    try {
      const xfeed = require("./xfeed.route");
      const { fetchHandleTweets } = xfeed.__internal || {};
      if (fetchHandleTweets) {
        // Build the handle list from the category filter + user custom
        // adds. If the caller explicitly filtered to zero categories
        // (empty ?categories=) we still honor their custom handles so
        // the Voices tab doesn't go completely empty.
        let handleSource;
        if (catSet === null) {
          handleSource = VOICES_PRESET_HANDLES;
        } else {
          handleSource = [];
          for (const c of catSet) {
            const list = VOICES_CATEGORIES[c] || [];
            for (const h of list) handleSource.push(h);
          }
        }
        const handles = [...new Set([...handleSource, ...customHandles])].slice(0, 40);
        if (handles.length > 0) {
          const perHandle = Math.max(1, Math.ceil(limit / handles.length));
          const results = await Promise.all(handles.map((h) =>
            fetchHandleTweets(h, perHandle).catch(() => [])
          ));
          external = results.flat().filter((t) => t && t.id);
        }
      }
    } catch { /* xfeed not loaded — skip */ }

    const externalShaped = external.map((t) => ({
      id: `x:${t.id}`,
      content: t.text || "",
      kind: "voice",
      mediaType: "VOICE",
      media_type: "VOICE",
      mediaUrls: t.media || [],
      createdAt: t.createdAt,
      author: {
        username: t.handle,
        display_name: t.displayName || t.handle,
        pfp_url: t.pfp || null,
        account_type: "X",
        verified: false,
        wallet_address: `x:${t.handle}`,
      },
      likes: 0, reposts: 0, comments: 0,
      likedByMe: false, repostedByMe: false,
      voice_category: categoryOf(t.handle),
    }));

    const merged = [...nativeShaped, ...externalShaped]
      .filter((p) => !filterCategory || p.voice_category === filterCategory)
      .sort((a, b) => {
        const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
        const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
        return tb - ta;
      })
      .slice(0, limit);

    res.json({ posts: merged });
  } catch (e) { next(e); }
});

// GET /api/feed/news?cursor=&limit=20
//
// Posts authored by the IronNews bot (feed_users.wallet_address =
// 'sys:ironnews'). Ordered newest-first. Paginates by id so a backfill
// after mute toggles doesn't mess with cursor stability.
router.get("/news", async (req, res, next) => {
  try {
    const wallet = req.header("x-wallet");
    const viewer = wallet ? await getOrCreateUser(wallet) : null;
    const limit  = Math.min(parseInt(req.query.limit) || 20, 50);
    const cursor = req.query.cursor ? parseInt(req.query.cursor) : null;
    const params = [];
    let sql = `
      SELECT p.* FROM feed_posts p
      JOIN feed_users u ON u.id = p.author_id
      WHERE u.wallet_address = 'sys:ironnews'
        AND p.deleted_at IS NULL`;
    if (cursor) { params.push(cursor); sql += ` AND p.id < $${params.length}`; }
    params.push(limit + 1);
    sql += ` ORDER BY p.id DESC LIMIT $${params.length}`;
    const r = await db.query(sql, params);
    const rows = r.rows;
    const nextCursor = rows.length > limit ? rows[limit - 1].id : null;
    const hydrated = await hydratePosts(rows.slice(0, limit), viewer?.id);
    res.json({ posts: hydrated, nextCursor });
  } catch (e) { next(e); }
});

// GET /api/feed/alpha?cursor=&limit=20
//
// Posts whose content mentions a $TICKER (2-10 uppercase) or a NEAR /
// SOL contract address pattern. ~ (regex match) is Postgres-native and
// fast enough at feed scale; we're not trying to rank here, just
// filter. The frontend's Alpha tab reads this.
router.get("/alpha", async (req, res, next) => {
  try {
    const wallet = req.header("x-wallet");
    const viewer = wallet ? await getOrCreateUser(wallet) : null;
    const limit  = Math.min(parseInt(req.query.limit) || 20, 50);
    const cursor = req.query.cursor ? parseInt(req.query.cursor) : null;
    // $TICKER: dollar sign + 2-10 uppercase letters.
    // CA: 32-50 char base58/hex-ish — covers both SOL mints and NEAR
    //     implicit IDs. Loose by design; a second pass in the renderer
    //     highlights the specific token.
    const alphaRe = "(\\$[A-Z]{2,10}\\b|\\b[A-Za-z0-9]{32,50}\\b|\\b[a-z0-9_-]+\\.(near|tkn\\.near)\\b)";
    const params = [alphaRe];
    let sql = `
      SELECT p.* FROM feed_posts p
      WHERE p.deleted_at IS NULL AND p.content ~ $1`;
    if (cursor) { params.push(cursor); sql += ` AND p.id < $${params.length}`; }
    params.push(limit + 1);
    sql += ` ORDER BY p.id DESC LIMIT $${params.length}`;
    const r = await db.query(sql, params);
    const rows = r.rows;
    const nextCursor = rows.length > limit ? rows[limit - 1].id : null;
    const hydrated = await hydratePosts(rows.slice(0, limit), viewer?.id);
    res.json({ posts: hydrated, nextCursor });
  } catch (e) { next(e); }
});

// GET /api/feed/ironclaw-alerts?cursor=&limit=20
//
// Placeholder: no dedicated bot account yet, so this returns posts
// whose content starts with an [IRONCLAW] marker. The governance bot
// in src/services/governanceListener.js will start posting alerts as
// a new sys:ironclaw feed_user once that's wired — same pattern as
// sys:ironnews. For now the tab has a "no alerts" empty state.
router.get("/ironclaw-alerts", async (req, res, next) => {
  try {
    const wallet = req.header("x-wallet");
    const viewer = wallet ? await getOrCreateUser(wallet) : null;
    const limit  = Math.min(parseInt(req.query.limit) || 20, 50);
    const r = await db.query(
      `SELECT p.* FROM feed_posts p
       JOIN feed_users u ON u.id = p.author_id
       WHERE (u.wallet_address = 'sys:ironclaw' OR p.content ILIKE '[ironclaw]%')
         AND p.deleted_at IS NULL
       ORDER BY p.id DESC
       LIMIT $1`,
      [limit]
    );
    const hydrated = await hydratePosts(r.rows, viewer?.id);
    res.json({ posts: hydrated, nextCursor: null });
  } catch (e) { next(e); }
});

// POST /api/feed/mute       body: { targetUsername }
// DELETE /api/feed/mute     body: { targetUsername }
// GET /api/feed/muted
router.post("/mute", async (req, res, next) => {
  try {
    const wallet = req.header("x-wallet");
    if (!wallet) return res.status(401).json({ error: "wallet required" });
    const viewer = await getOrCreateUser(wallet);
    const target = (req.body?.targetUsername || "").trim().toLowerCase();
    if (!target) return res.status(400).json({ error: "targetUsername required" });
    const u = await db.query(
      "SELECT id FROM feed_users WHERE LOWER(username) = $1 LIMIT 1", [target]
    );
    if (!u.rows[0]) return res.status(404).json({ error: "user not found" });
    await db.query(
      `INSERT INTO feed_muted_accounts (user_id, muted_user_id)
         VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [viewer.id, u.rows[0].id]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});
router.delete("/mute", async (req, res, next) => {
  try {
    const wallet = req.header("x-wallet");
    if (!wallet) return res.status(401).json({ error: "wallet required" });
    const viewer = await getOrCreateUser(wallet);
    const target = (req.body?.targetUsername || req.query.targetUsername || "").trim().toLowerCase();
    if (!target) return res.status(400).json({ error: "targetUsername required" });
    await db.query(
      `DELETE FROM feed_muted_accounts
         WHERE user_id = $1
           AND muted_user_id = (SELECT id FROM feed_users WHERE LOWER(username) = $2)`,
      [viewer.id, target]
    );
    res.json({ ok: true });
  } catch (e) { next(e); }
});
router.get("/muted", async (req, res, next) => {
  try {
    const wallet = req.header("x-wallet");
    if (!wallet) return res.json({ muted: [] });
    const viewer = await getOrCreateUser(wallet);
    const r = await db.query(
      `SELECT u.username, u.display_name
         FROM feed_muted_accounts m
         JOIN feed_users u ON u.id = m.muted_user_id
        WHERE m.user_id = $1
        ORDER BY m.created_at DESC`,
      [viewer.id]
    );
    res.json({ muted: r.rows });
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
