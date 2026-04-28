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

function postHash(content, authorId, ts) {
  return crypto.createHash("sha256").update(`${content}|${authorId}|${ts}`).digest("hex");
}

// Hydrate posts with author + counts + viewer's like/repost state
async function hydratePosts(rows, viewerId) {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const authorIds = [...new Set(rows.map(r => r.author_id))];
  // Quoted-post fan-out: only fetch the rows that are referenced.
  // Set lookup avoids a "WHERE id = ANY([])" with no-op rows.
  const quotedIds = [...new Set(rows.map(r => r.quoted_post_id).filter(Boolean))];

  const [authors, likes, comments, reposts, viewerLikes, viewerReposts, tips, quoted] = await Promise.all([
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
    quotedIds.length
      ? db.query(
          `SELECT p.id, p.content, p.media_urls, p.created_at,
                  u.id AS author_id, u.username, u.display_name, u.pfp_url, u.wallet_address, u.verified
             FROM feed_posts p
             JOIN feed_users u ON u.id = p.author_id
            WHERE p.id = ANY($1) AND p.deleted_at IS NULL`,
          [quotedIds]
        )
      : { rows: [] },
  ]);

  const aMap = Object.fromEntries(authors.rows.map(a => [a.id, a]));
  const lMap = Object.fromEntries(likes.rows.map(r => [r.post_id, r.c]));
  const cMap = Object.fromEntries(comments.rows.map(r => [r.post_id, r.c]));
  const rMap = Object.fromEntries(reposts.rows.map(r => [r.post_id, r.c]));
  const tMap = Object.fromEntries(tips.rows.map(r => [r.post_id, { count: r.c, usd: Number(r.usd || 0) }]));
  const vL   = new Set(viewerLikes.rows.map(r => r.post_id));
  const vR   = new Set(viewerReposts.rows.map(r => r.post_id));
  const qMap = Object.fromEntries(quoted.rows.map(q => [q.id, {
    id: q.id,
    content: q.content,
    mediaUrls: q.media_urls || [],
    createdAt: q.created_at,
    author: {
      id: q.author_id,
      username: q.username,
      display_name: q.display_name,
      pfp_url: q.pfp_url,
      wallet_address: q.wallet_address,
      verified: !!q.verified,
    },
  }]));

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
      quotedPost:   p.quoted_post_id ? (qMap[p.quoted_post_id] || null) : null,
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
      // Cached counter from the /impression path. The real-time view
      // count uses this — the dedupe table (feed_post_impressions) is
      // only consulted for the increment-gate on each fire.
      impressions: p.impressions || 0,
      gate,
      validated:   !!p.validated,
      kind:        p.kind || "post",
      title:       p.title || null,
    };
  });
}

module.exports = { getOrCreateUser, postHash, hydratePosts };
