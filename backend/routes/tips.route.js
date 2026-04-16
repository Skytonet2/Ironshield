// backend/routes/tips.route.js — tip economy
const express = require("express");
const router = express.Router();
const db = require("../db/client");
const { getOrCreateUser, requireWallet } = require("../services/feedHelpers");
const { createAndPush } = require("../services/pushNotify");

// Holding-period proxy: users created ≥ 7 days ago count as "held
// $IRONCLAW 7+ days" for the purposes of the 10% treasury split. New
// wallets can still tip but their tips waive the treasury cut.
// TODO: replace with real ft_transfer-history index once $IRONCLAW launches.
const HOLDING_DAYS = 7;

function isSeasoned(user) {
  if (!user?.created_at) return false;
  const ageMs = Date.now() - new Date(user.created_at).getTime();
  return ageMs >= HOLDING_DAYS * 24 * 3600 * 1000;
}

// POST /api/tips  body: { postId, tokenContract, tokenSymbol, tokenDecimals,
//                         amountBase, amountHuman, amountUsd, anonymous, txHash }
router.post("/", requireWallet, async (req, res, next) => {
  try {
    const tipper = await getOrCreateUser(req.wallet);
    const {
      postId, tokenContract, tokenSymbol, tokenDecimals,
      amountBase, amountHuman, amountUsd, anonymous, txHash,
    } = req.body || {};

    if (!postId || !tokenContract || !amountBase) {
      return res.status(400).json({ error: "postId, tokenContract, amountBase required" });
    }

    const pr = await db.query(
      "SELECT id, author_id FROM feed_posts WHERE id=$1 AND deleted_at IS NULL",
      [postId]
    );
    if (!pr.rows.length) return res.status(404).json({ error: "post not found" });
    const { author_id } = pr.rows[0];

    if (author_id === tipper.id) {
      return res.status(400).json({ error: "can't tip your own post" });
    }

    // 24h dedupe: same tipper → same post → once per day.
    const dupe = await db.query(
      `SELECT 1 FROM feed_tips
        WHERE post_id=$1 AND tipper_id=$2 AND created_at > NOW() - INTERVAL '24 hours'
        LIMIT 1`,
      [postId, tipper.id]
    );
    if (dupe.rows.length) {
      return res.status(429).json({
        error: "You've already tipped this post in the last 24h",
        code: "RATE_LIMITED",
      });
    }

    const waived = !isSeasoned(tipper);

    const ins = await db.query(
      `INSERT INTO feed_tips
         (post_id, tipper_id, author_id, token_contract, token_symbol,
          token_decimals, amount_base, amount_human, amount_usd,
          anonymous, waived_treasury, tx_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, created_at`,
      [
        postId, tipper.id, author_id,
        tokenContract, tokenSymbol || "", Number(tokenDecimals) || 0,
        String(amountBase), String(amountHuman || "0"), String(amountUsd || "0"),
        !!anonymous, waived, txHash || null,
      ]
    );

    // Notify author of the tip (push + DB row).
    createAndPush({
      userId: author_id,
      actorId: anonymous ? null : tipper.id,
      postId,
      type: "tip",
      body: anonymous
        ? `Someone tipped your post ${Number(amountHuman).toFixed(2)} ${tokenSymbol || "tokens"}`
        : undefined,
    }).catch(() => {});

    res.json({
      ok: true,
      tip: {
        id: ins.rows[0].id,
        createdAt: ins.rows[0].created_at,
        waivedTreasury: waived,
      },
    });
  } catch (e) { next(e); }
});

// GET /api/tips/post/:postId  → tip history for a post
router.get("/post/:postId", async (req, res, next) => {
  try {
    const { postId } = req.params;
    const r = await db.query(
      `SELECT t.id, t.token_contract, t.token_symbol, t.token_decimals,
              t.amount_human, t.amount_usd, t.anonymous, t.tx_hash, t.created_at,
              CASE WHEN t.anonymous THEN NULL ELSE u.wallet_address END AS tipper_wallet,
              CASE WHEN t.anonymous THEN NULL ELSE u.username       END AS tipper_username,
              CASE WHEN t.anonymous THEN NULL ELSE u.display_name   END AS tipper_display,
              CASE WHEN t.anonymous THEN NULL ELSE u.pfp_url        END AS tipper_pfp
         FROM feed_tips t
         LEFT JOIN feed_users u ON u.id = t.tipper_id
        WHERE t.post_id = $1
        ORDER BY t.created_at DESC
        LIMIT 100`,
      [postId]
    );

    const agg = await db.query(
      `SELECT COUNT(*)::int AS count,
              COALESCE(SUM(amount_usd), 0)::text AS total_usd
         FROM feed_tips WHERE post_id=$1`,
      [postId]
    );

    res.json({
      tips: r.rows.map(row => ({
        id: row.id,
        tokenContract: row.token_contract,
        tokenSymbol:   row.token_symbol,
        tokenDecimals: row.token_decimals,
        amountHuman:   Number(row.amount_human),
        amountUsd:     Number(row.amount_usd),
        anonymous:     row.anonymous,
        txHash:        row.tx_hash,
        createdAt:     row.created_at,
        tipper: row.anonymous ? null : {
          wallet:      row.tipper_wallet,
          username:    row.tipper_username,
          displayName: row.tipper_display,
          pfpUrl:      row.tipper_pfp,
        },
      })),
      count:    agg.rows[0].count,
      totalUsd: Number(agg.rows[0].total_usd),
    });
  } catch (e) { next(e); }
});

// GET /api/tips/creator/:walletOrUsername
//   → totals + top tipped post + current tip streak
router.get("/creator/:key", async (req, res, next) => {
  try {
    const k = String(req.params.key || "").toLowerCase();
    const ur = await db.query(
      "SELECT id, wallet_address, username, display_name FROM feed_users WHERE LOWER(wallet_address)=$1 OR LOWER(username)=$1 LIMIT 1",
      [k]
    );
    if (!ur.rows.length) return res.status(404).json({ error: "creator not found" });
    const creator = ur.rows[0];

    const [totals, topPost, streakDays] = await Promise.all([
      db.query(
        `SELECT COUNT(*)::int AS count,
                COALESCE(SUM(amount_usd),0)::text AS total_usd
           FROM feed_tips WHERE author_id=$1`,
        [creator.id]
      ),
      db.query(
        `SELECT post_id, COUNT(*)::int AS c, COALESCE(SUM(amount_usd),0)::text AS usd
           FROM feed_tips WHERE author_id=$1
           GROUP BY post_id ORDER BY usd DESC LIMIT 1`,
        [creator.id]
      ),
      db.query(
        // Count consecutive days (ending today) where at least one tip arrived.
        `WITH days AS (
           SELECT DISTINCT DATE(created_at) AS d
             FROM feed_tips WHERE author_id=$1
         )
         SELECT COUNT(*)::int AS streak FROM (
           SELECT d, ROW_NUMBER() OVER (ORDER BY d DESC) AS rn
             FROM days WHERE d <= CURRENT_DATE
         ) s
         WHERE s.d = CURRENT_DATE - (s.rn - 1) * INTERVAL '1 day'`,
        [creator.id]
      ),
    ]);

    res.json({
      creator: {
        id: creator.id,
        wallet: creator.wallet_address,
        username: creator.username,
        displayName: creator.display_name,
      },
      totalTips: totals.rows[0].count,
      totalTipsUsd: Number(totals.rows[0].total_usd),
      topPost: topPost.rows[0] ? {
        postId: topPost.rows[0].post_id,
        tipCount: topPost.rows[0].c,
        totalUsd: Number(topPost.rows[0].usd),
      } : null,
      tipStreakDays: streakDays.rows[0]?.streak || 0,
    });
  } catch (e) { next(e); }
});

module.exports = router;
