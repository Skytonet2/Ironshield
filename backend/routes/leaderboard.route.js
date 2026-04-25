// backend/routes/leaderboard.route.js
const express = require("express");
const router  = express.Router();
const db      = require("../db/client");
const requireWallet = require("../middleware/requireWallet");

// GET /api/leaderboard — top users
router.get("/", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  try {
    const { rows } = await db.query(
      `SELECT l.points, l.rank_tier, l.updated_at,
              u.near_wallet, u.username, u.telegram_id
       FROM leaderboard l
       JOIN users u ON u.id = l.user_id
       ORDER BY l.points DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/leaderboard/:wallet — single user score
router.get("/:wallet", async (req, res) => {
  try {
    const { rows: [entry] } = await db.query(
      `SELECT l.points, l.rank_tier, l.updated_at, u.near_wallet, u.username
       FROM leaderboard l
       JOIN users u ON u.id = l.user_id
       WHERE u.near_wallet = $1`,
      [req.params.wallet]
    );
    if (!entry) return res.json({ success: true, data: { near_wallet: req.params.wallet, points: 0, rank_tier: "bronze" } });

    // Calculate rank
    const { rows: [{ rank }] } = await db.query(
      "SELECT COUNT(*) + 1 AS rank FROM leaderboard WHERE points > $1",
      [entry.points]
    );
    res.json({ success: true, data: { ...entry, rank: parseInt(rank) } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/leaderboard/score — admin: add/set points (admin allowlist gate added in Day 2.2)
router.post("/score", requireWallet, async (req, res) => {
  const { near_wallet, points, action = "add" } = req.body;
  if (!near_wallet || points == null) return res.status(400).json({ success: false, error: "near_wallet and points required" });

  try {
    // Upsert user
    const { rows: [user] } = await db.query(
      `INSERT INTO users (near_wallet) VALUES ($1)
       ON CONFLICT (near_wallet) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [near_wallet]
    );

    let result;
    if (action === "set") {
      const tier = points >= 5000 ? "diamond" : points >= 2000 ? "gold" : points >= 500 ? "silver" : "bronze";
      result = await db.query(
        `INSERT INTO leaderboard (user_id, points, rank_tier) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET points = $2, rank_tier = $3, updated_at = NOW()
         RETURNING *`,
        [user.id, points, tier]
      );
    } else {
      result = await db.query(
        `INSERT INTO leaderboard (user_id, points) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET
           points = leaderboard.points + $2,
           rank_tier = CASE
             WHEN leaderboard.points + $2 >= 5000 THEN 'diamond'
             WHEN leaderboard.points + $2 >= 2000 THEN 'gold'
             WHEN leaderboard.points + $2 >= 500 THEN 'silver'
             ELSE 'bronze'
           END,
           updated_at = NOW()
         RETURNING *`,
        [user.id, points]
      );
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
