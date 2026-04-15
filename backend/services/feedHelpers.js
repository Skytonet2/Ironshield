// backend/services/feedHelpers.js — shared utilities for IronFeed
const crypto = require("crypto");
const db = require("../db/client");

/**
 * Resolve (or auto-create) a feed_users row from a NEAR wallet address.
 * The wallet header is the lightweight "auth" used by the MVP feed —
 * production should add a signed-message check.
 */
async function getOrCreateUser(wallet) {
  if (!wallet) return null;
  const w = String(wallet).toLowerCase().trim();
  let r = await db.query("SELECT * FROM feed_users WHERE wallet_address=$1", [w]);
  if (r.rows[0]) return r.rows[0];
  const username = w.replace(/\.near$|\.testnet$/, "").slice(0, 24) || "anon";
  r = await db.query(
    `INSERT INTO feed_users (wallet_address, username, display_name, account_type)
     VALUES ($1,$2,$3,'HUMAN') RETURNING *`,
    [w, username, username]
  );
  return r.rows[0];
}

function requireWallet(req, res, next) {
  const w = req.header("x-wallet") || req.body?.wallet || req.query?.wallet;
  if (!w) return res.status(401).json({ error: "wallet required (set X-Wallet header)" });
  req.wallet = String(w).toLowerCase().trim();
  next();
}

function postHash(content, authorId, ts) {
  return crypto.createHash("sha256").update(`${content}|${authorId}|${ts}`).digest("hex");
}

// Hydrate posts with author + counts + viewer's like/repost state
async function hydratePosts(rows, viewerId) {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const authorIds = [...new Set(rows.map(r => r.author_id))];

  const [authors, likes, comments, reposts, viewerLikes, viewerReposts, tips] = await Promise.all([
    db.query("SELECT id, wallet_address, username, display_name, pfp_url, account_type, verified FROM feed_users WHERE id = ANY($1)", [authorIds]),
    db.query("SELECT post_id, COUNT(*)::int AS c FROM feed_likes    WHERE post_id = ANY($1) GROUP BY post_id", [ids]),
    db.query("SELECT post_id, COUNT(*)::int AS c FROM feed_comments WHERE post_id = ANY($1) GROUP BY post_id", [ids]),
    db.query("SELECT post_id, COUNT(*)::int AS c FROM feed_reposts  WHERE post_id = ANY($1) GROUP BY post_id", [ids]),
    viewerId ? db.query("SELECT post_id FROM feed_likes   WHERE user_id=$1 AND post_id = ANY($2)", [viewerId, ids]) : { rows: [] },
    viewerId ? db.query("SELECT post_id FROM feed_reposts WHERE user_id=$1 AND post_id = ANY($2)", [viewerId, ids]) : { rows: [] },
    db.query(
      `SELECT post_id, COUNT(*)::int AS c,
              COALESCE(SUM(amount_usd),0)::float AS usd
         FROM feed_tips WHERE post_id = ANY($1) GROUP BY post_id`,
      [ids]
    ),
  ]);

  const aMap = Object.fromEntries(authors.rows.map(a => [a.id, a]));
  const lMap = Object.fromEntries(likes.rows.map(r => [r.post_id, r.c]));
  const cMap = Object.fromEntries(comments.rows.map(r => [r.post_id, r.c]));
  const rMap = Object.fromEntries(reposts.rows.map(r => [r.post_id, r.c]));
  const tMap = Object.fromEntries(tips.rows.map(r => [r.post_id, { count: r.c, usd: Number(r.usd || 0) }]));
  const vL   = new Set(viewerLikes.rows.map(r => r.post_id));
  const vR   = new Set(viewerReposts.rows.map(r => r.post_id));

  return rows.map(p => {
    // Assemble gate object only if gate_type is set.
    let gate = null;
    if (p.gate_type) {
      gate = { type: p.gate_type };
      if (p.gate_type === "balance")   gate.minBalance = Number(p.gate_min_balance || 0);
      if (p.gate_type === "tier")      gate.minTier    = p.gate_min_tier;
      if (p.gate_type === "allowlist") gate.allowlist  = Array.isArray(p.gate_allowlist) ? p.gate_allowlist : [];
    }
    const tipAgg = tMap[p.id] || { count: 0, usd: 0 };
    return {
      id: p.id,
      content: p.content,
      mediaUrls: p.media_urls || [],
      mediaType: p.media_type,
      repostOfId: p.repost_of_id,
      quotedPostId: p.quoted_post_id,
      createdAt: p.created_at,
      onchainTx: p.onchain_tx || null,
      author: aMap[p.author_id] || null,
      likes: lMap[p.id] || 0,
      comments: cMap[p.id] || 0,
      reposts: rMap[p.id] || 0,
      likedByMe: vL.has(p.id),
      repostedByMe: vR.has(p.id),
      tipCount:    tipAgg.count,
      tipTotalUsd: tipAgg.usd,
      gate,
      validated:   !!p.validated,
      kind:        p.kind || "post",
      title:       p.title || null,
    };
  });
}

module.exports = { getOrCreateUser, requireWallet, postHash, hydratePosts };
