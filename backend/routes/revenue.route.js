// backend/routes/revenue.route.js — Creator Revenue Share
//
// Score formula (locked across leaderboard + per-creator dashboard):
//   tips           × 2     (count of tips received)
//   validated      × 5     (posts with feed_posts.validated = TRUE)
//   likes          × 0.5   (likes received on author's posts)
//   comments       × 1     (replies received on author's posts)
//   alpha_calls    × 3     (room messages flagged is_alpha_call = TRUE)
// Stake multiplier: × 1.5 if creator currently stakes ≥ 1k $IRONCLAW
//                   (proxied here by feed_users.staked_amount when present)
// New-creator bonus: +20 % matching for accounts < 90 days old.
//
// Estimated revenue: pool-share — creator score / sum-of-scores × MONTHLY_POOL.

const express = require("express");
const router = express.Router();
const db = require("../db/client");

const SCORE_W = { tip: 2, validated: 5, like: 0.5, comment: 1, alpha: 3 };
const STAKE_MIN_FOR_MULT = 1_000;
const STAKE_MULT = 1.5;
const NEW_CREATOR_DAYS = 90;
const NEW_CREATOR_MATCH = 0.20;
const MONTHLY_POOL_USD = 5_000;        // mock pool for MVP
const PERIOD_DAYS = 30;

// Build a CTE that returns one row per author with the raw counts +
// derived score. Used by both /creator/:key and /leaderboard.
function scoreCte() {
  return `
    WITH author_stats AS (
      SELECT
        u.id              AS user_id,
        u.wallet_address  AS wallet,
        u.username,
        u.display_name,
        u.pfp_url,
        u.created_at      AS account_created,
        COALESCE((SELECT COUNT(*) FROM feed_tips     t WHERE t.author_id = u.id
                  AND t.created_at > NOW() - INTERVAL '${PERIOD_DAYS} days'), 0)::int  AS tips_count,
        COALESCE((SELECT COALESCE(SUM(amount_usd),0) FROM feed_tips t WHERE t.author_id = u.id
                  AND t.created_at > NOW() - INTERVAL '${PERIOD_DAYS} days'), 0)::float AS tips_usd,
        COALESCE((SELECT COUNT(*) FROM feed_posts p WHERE p.author_id = u.id
                  AND p.deleted_at IS NULL AND p.validated = TRUE
                  AND p.created_at > NOW() - INTERVAL '${PERIOD_DAYS} days'), 0)::int  AS validated_count,
        COALESCE((SELECT COUNT(*) FROM feed_likes l
                  JOIN feed_posts p ON p.id = l.post_id
                  WHERE p.author_id = u.id
                  AND l.created_at > NOW() - INTERVAL '${PERIOD_DAYS} days'), 0)::int  AS likes_count,
        COALESCE((SELECT COUNT(*) FROM feed_comments c
                  JOIN feed_posts p ON p.id = c.post_id
                  WHERE p.author_id = u.id AND c.author_id <> u.id
                  AND c.created_at > NOW() - INTERVAL '${PERIOD_DAYS} days'), 0)::int  AS comments_count,
        COALESCE((SELECT COUNT(*) FROM feed_room_messages m
                  WHERE m.user_id = u.id AND m.is_alpha_call = TRUE
                  AND m.created_at > NOW() - INTERVAL '${PERIOD_DAYS} days'), 0)::int  AS alpha_count
      FROM feed_users u
    ),
    scored AS (
      SELECT
        s.*,
        (tips_count * ${SCORE_W.tip}
         + validated_count * ${SCORE_W.validated}
         + likes_count * ${SCORE_W.like}
         + comments_count * ${SCORE_W.comment}
         + alpha_count * ${SCORE_W.alpha})::float AS base_score
      FROM author_stats s
    )
  `;
}

// Apply staking + new-creator multipliers in JS so the formula stays readable.
function applyMultipliers(row, stakedAmount = 0) {
  const ageDays = row.account_created
    ? (Date.now() - new Date(row.account_created).getTime()) / 86_400_000
    : 0;
  const stakeMult = (stakedAmount || 0) >= STAKE_MIN_FOR_MULT ? STAKE_MULT : 1;
  const isNewCreator = ageDays < NEW_CREATOR_DAYS;
  const matchMult = isNewCreator ? 1 + NEW_CREATOR_MATCH : 1;
  const finalScore = (row.base_score || 0) * stakeMult * matchMult;
  return { stakeMult, matchMult, isNewCreator, ageDays, finalScore };
}

// GET /api/revenue/creator/:key — wallet OR username
router.get("/creator/:key", async (req, res, next) => {
  try {
    const k = req.params.key.toLowerCase();
    const u = await db.query(
      `SELECT id, wallet_address, username, display_name, pfp_url, created_at, staked_amount
         FROM feed_users
        WHERE LOWER(wallet_address)=$1 OR LOWER(username)=$1
        LIMIT 1`, [k]);
    if (!u.rows.length) return res.status(404).json({ error: "creator not found" });
    const me = u.rows[0];

    // Per-creator score row.
    const r = await db.query(`${scoreCte()} SELECT * FROM scored WHERE user_id = $1`, [me.id]);
    const row = r.rows[0] || { base_score: 0 };

    // Sum + rank across all creators with score > 0.
    const all = await db.query(
      `${scoreCte()}
       SELECT user_id,
              base_score,
              ROW_NUMBER() OVER (ORDER BY base_score DESC) AS rank,
              SUM(base_score) OVER ()                       AS pool_score,
              COUNT(*) FILTER (WHERE base_score > 0) OVER () AS active_creators
         FROM scored
        WHERE base_score > 0`);
    const meRanked = all.rows.find(x => x.user_id === me.id);
    const totalScore = Number(all.rows[0]?.pool_score || 0);

    const mults = applyMultipliers(row, me.staked_amount);
    const share = totalScore > 0 ? mults.finalScore / totalScore : 0;
    const estRevenueUsd = share * MONTHLY_POOL_USD;

    res.json({
      creator: {
        id: me.id,
        wallet: me.wallet_address,
        username: me.username,
        displayName: me.display_name,
        pfpUrl: me.pfp_url,
      },
      periodDays: PERIOD_DAYS,
      rank: meRanked ? Number(meRanked.rank) : null,
      activeCreators: meRanked ? Number(meRanked.active_creators) : 0,
      breakdown: {
        tips:      { count: row.tips_count || 0,      weight: SCORE_W.tip,       points: (row.tips_count || 0) * SCORE_W.tip,           usd: row.tips_usd || 0 },
        validated: { count: row.validated_count || 0, weight: SCORE_W.validated, points: (row.validated_count || 0) * SCORE_W.validated },
        likes:     { count: row.likes_count || 0,     weight: SCORE_W.like,      points: (row.likes_count || 0) * SCORE_W.like },
        comments:  { count: row.comments_count || 0,  weight: SCORE_W.comment,   points: (row.comments_count || 0) * SCORE_W.comment },
        alpha:     { count: row.alpha_count || 0,     weight: SCORE_W.alpha,     points: (row.alpha_count || 0) * SCORE_W.alpha },
      },
      baseScore:        row.base_score || 0,
      stakeMultiplier:  mults.stakeMult,
      newCreatorBonus:  mults.matchMult > 1 ? NEW_CREATOR_MATCH : 0,
      isNewCreator:     mults.isNewCreator,
      finalScore:       mults.finalScore,
      poolScore:        totalScore,
      sharePct:         share * 100,
      estRevenueUsd,
      monthlyPoolUsd:   MONTHLY_POOL_USD,
    });
  } catch (e) { next(e); }
});

// GET /api/revenue/leaderboard?limit=50
router.get("/leaderboard", async (req, res, next) => {
  try {
    const limit = Math.min(100, Number(req.query.limit) || 50);
    const r = await db.query(
      `${scoreCte()}
       SELECT user_id, wallet, username, display_name, pfp_url, account_created,
              tips_count, tips_usd, validated_count, likes_count, comments_count, alpha_count,
              base_score
         FROM scored
        WHERE base_score > 0
        ORDER BY base_score DESC
        LIMIT ${limit}`);

    const totalScore = r.rows.reduce((s, x) => s + Number(x.base_score || 0), 0);
    const stakeRows = await db.query(
      "SELECT id, staked_amount FROM feed_users WHERE id = ANY($1)",
      [r.rows.map(x => x.user_id)]
    );
    const stakeMap = Object.fromEntries(stakeRows.rows.map(s => [s.id, Number(s.staked_amount || 0)]));

    const leaderboard = r.rows.map((row, i) => {
      const mults = applyMultipliers(row, stakeMap[row.user_id]);
      const share = totalScore > 0 ? mults.finalScore / totalScore : 0;
      return {
        rank: i + 1,
        user: {
          id: row.user_id, wallet: row.wallet, username: row.username,
          displayName: row.display_name, pfpUrl: row.pfp_url,
        },
        baseScore:       row.base_score,
        stakeMultiplier: mults.stakeMult,
        isNewCreator:    mults.isNewCreator,
        finalScore:      mults.finalScore,
        sharePct:        share * 100,
        estRevenueUsd:   share * MONTHLY_POOL_USD,
        breakdown: {
          tips:      { count: row.tips_count,      usd: row.tips_usd },
          validated: row.validated_count,
          likes:     row.likes_count,
          comments:  row.comments_count,
          alpha:     row.alpha_count,
        },
      };
    });

    res.json({
      periodDays: PERIOD_DAYS,
      monthlyPoolUsd: MONTHLY_POOL_USD,
      activeCreators: r.rows.length,
      leaderboard,
    });
  } catch (e) { next(e); }
});

module.exports = router;
