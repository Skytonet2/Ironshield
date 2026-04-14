// backend/services/feedRanker.js — For You ranking algorithm
const db = require("../db/client");

const HALF_LIFE_HOURS = 6;
const ENGAGEMENT_BONUS = 40;   // viewer dwelt >5s previously
const SOCIAL_PROXIMITY = 20;   // poster followed by someone the viewer follows
const VELOCITY_BONUS   = 15;   // (likes+comments in last 1h) / age_hours
const MUTUAL_BONUS     = 10;   // per mutual connection
const AD_SLOT_FORYOU   = 8;
const AD_SLOT_FOLLOW   = 12;

function recencyScore(createdAt) {
  const hours = (Date.now() - new Date(createdAt).getTime()) / 3.6e6;
  return 100 * Math.pow(0.5, hours / HALF_LIFE_HOURS);
}

async function rankForYou(viewerId, limit = 20, cursorTs = null) {
  // Pull a wide candidate window (last 7 days) capped at 200 rows
  const cur = cursorTs ? "AND p.created_at < $1" : "";
  const params = cursorTs ? [cursorTs] : [];
  const cand = await db.query(
    `SELECT p.* FROM feed_posts p
     WHERE p.deleted_at IS NULL
       AND p.created_at > NOW() - INTERVAL '7 days'
       ${cur}
     ORDER BY p.created_at DESC
     LIMIT 200`, params);
  const candidates = cand.rows;
  if (!candidates.length) return { posts: [], nextCursor: null };
  const ids = candidates.map(p => p.id);

  // Bulk lookups
  const [muted, blocked, dwelt, seenCounts, velocity, follows, ads] = await Promise.all([
    viewerId ? db.query("SELECT 0 AS uid").catch(() => ({ rows: [] })) : { rows: [] }, // placeholder for future mute table
    viewerId ? db.query("SELECT 0 AS uid").catch(() => ({ rows: [] })) : { rows: [] },
    viewerId ? db.query(
      "SELECT post_id, SUM(dwell_ms)::int AS d FROM feed_engagement WHERE user_id=$1 AND post_id = ANY($2) GROUP BY post_id",
      [viewerId, ids]) : { rows: [] },
    viewerId ? db.query(
      "SELECT post_id, COUNT(*)::int AS c FROM feed_engagement WHERE user_id=$1 AND post_id = ANY($2) GROUP BY post_id",
      [viewerId, ids]) : { rows: [] },
    db.query(`
      SELECT p.id AS post_id,
        ((COALESCE(l.c,0)+COALESCE(c.c,0))::float /
         GREATEST(EXTRACT(EPOCH FROM (NOW()-p.created_at))/3600, 0.5)) AS v
      FROM feed_posts p
      LEFT JOIN (SELECT post_id, COUNT(*)::int AS c FROM feed_likes
                 WHERE created_at > NOW()-INTERVAL '1 hour' GROUP BY post_id) l ON l.post_id = p.id
      LEFT JOIN (SELECT post_id, COUNT(*)::int AS c FROM feed_comments
                 WHERE created_at > NOW()-INTERVAL '1 hour' GROUP BY post_id) c ON c.post_id = p.id
      WHERE p.id = ANY($1)`, [ids]),
    viewerId ? db.query("SELECT following_id FROM feed_follows WHERE follower_id=$1", [viewerId]) : { rows: [] },
    db.query(`SELECT a.*, p.author_id FROM feed_ad_campaigns a
              JOIN feed_posts p ON p.id = a.post_id
              WHERE a.active = TRUE AND (a.end_date IS NULL OR a.end_date > NOW())`),
  ]);

  const dwellMap = Object.fromEntries(dwelt.rows.map(r => [r.post_id, r.d]));
  const seenMap  = Object.fromEntries(seenCounts.rows.map(r => [r.post_id, r.c]));
  const velMap   = Object.fromEntries(velocity.rows.map(r => [r.post_id, r.v]));
  const followingSet = new Set(follows.rows.map(r => r.following_id));

  // Friends-of-friends (1 hop) for proximity bonus
  let fofSet = new Set();
  if (followingSet.size) {
    const fof = await db.query(
      "SELECT DISTINCT following_id FROM feed_follows WHERE follower_id = ANY($1)",
      [[...followingSet]]);
    fofSet = new Set(fof.rows.map(r => r.following_id));
  }

  const scored = candidates
    .filter(p => (seenMap[p.id] || 0) <= 3)
    .map(p => {
      let s = recencyScore(p.createdAt || p.created_at);
      if ((dwellMap[p.id] || 0) > 5000) s += ENGAGEMENT_BONUS;
      if (fofSet.has(p.author_id))      s += SOCIAL_PROXIMITY;
      if (velMap[p.id])                 s += VELOCITY_BONUS * Math.min(velMap[p.id], 5);
      // mutual connection bonus collapsed for MVP — using fof signal
      return { post: p, score: s };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit + ads.rows.length);

  // Inject ads every Nth slot
  const out = [];
  let adIdx = 0;
  for (let i = 0; i < scored.length && out.length < limit; i++) {
    if (out.length > 0 && out.length % AD_SLOT_FORYOU === 0 && ads.rows[adIdx]) {
      const ad = ads.rows[adIdx++];
      const adPost = candidates.find(p => p.id === ad.post_id);
      if (adPost) { out.push({ ...adPost, _promoted: true }); continue; }
    }
    out.push(scored[i].post);
  }

  const last = out[out.length - 1];
  return { posts: out, nextCursor: last ? last.created_at : null };
}

async function rankFollowing(viewerId, limit = 20, cursorTs = null) {
  if (!viewerId) return { posts: [], nextCursor: null };
  const cur = cursorTs ? "AND p.created_at < $2" : "";
  const params = cursorTs ? [viewerId, cursorTs] : [viewerId];
  const r = await db.query(
    `SELECT p.* FROM feed_posts p
     WHERE p.deleted_at IS NULL ${cur}
       AND (p.author_id IN (SELECT following_id FROM feed_follows WHERE follower_id=$1)
        OR  p.author_id IN (SELECT follower_id  FROM feed_follows WHERE following_id=$1)
        OR  p.author_id = $1)
     ORDER BY p.created_at DESC
     LIMIT $${params.length + 1}`,
    [...params, limit]);
  const last = r.rows[r.rows.length - 1];
  return { posts: r.rows, nextCursor: last ? last.created_at : null };
}

module.exports = { rankForYou, rankFollowing, AD_SLOT_FORYOU, AD_SLOT_FOLLOW };
