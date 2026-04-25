// backend/routes/contests.route.js
const express = require("express");
const router  = express.Router();
const db      = require("../db/client");
const requireWallet = require("../middleware/requireWallet");
const requireAdmin  = require("../middleware/requireAdmin");

// GET /api/contests — list all contests
router.get("/", async (req, res) => {
  try {
    const { status } = req.query;
    let sql = "SELECT * FROM contests ORDER BY created_at DESC";
    let params = [];
    if (status) {
      sql = "SELECT * FROM contests WHERE status = $1 ORDER BY created_at DESC";
      params = [status];
    }
    const { rows } = await db.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/contests/:id — single contest with submissions
router.get("/:id", async (req, res) => {
  try {
    const { rows: [contest] } = await db.query("SELECT * FROM contests WHERE id = $1", [req.params.id]);
    if (!contest) return res.status(404).json({ success: false, error: "Contest not found" });

    const { rows: submissions } = await db.query(
      `SELECT s.*, u.near_wallet, u.username
       FROM submissions s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.contest_id = $1
       ORDER BY s.created_at DESC`,
      [req.params.id]
    );
    res.json({ success: true, data: { ...contest, submissions } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/contests — create contest (admin allowlist enforced)
router.post("/", requireWallet, requireAdmin, async (req, res) => {
  const { title, description, reward, difficulty, end_date } = req.body;
  const created_by = req.wallet;
  if (!title) return res.status(400).json({ success: false, error: "title required" });

  try {
    const { rows: [contest] } = await db.query(
      `INSERT INTO contests (title, description, reward, difficulty, end_date, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, description, reward, difficulty || "medium", end_date, created_by]
    );
    res.json({ success: true, data: contest });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/contests/:id — update contest (admin allowlist enforced)
router.put("/:id", requireWallet, requireAdmin, async (req, res) => {
  const { title, description, reward, difficulty, status, end_date } = req.body;
  try {
    const { rows: [contest] } = await db.query(
      `UPDATE contests SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        reward = COALESCE($3, reward),
        difficulty = COALESCE($4, difficulty),
        status = COALESCE($5, status),
        end_date = COALESCE($6, end_date),
        updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [title, description, reward, difficulty, status, end_date, req.params.id]
    );
    if (!contest) return res.status(404).json({ success: false, error: "Contest not found" });
    res.json({ success: true, data: contest });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/contests/:id — delete contest (admin allowlist enforced)
router.delete("/:id", requireWallet, requireAdmin, async (req, res) => {
  try {
    await db.query("DELETE FROM contests WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/contests/:id/submit — submit to contest
router.post("/:id/submit", requireWallet, async (req, res) => {
  const { proof_link, notes, image_url } = req.body;
  const near_wallet = req.wallet;

  try {
    // Upsert user
    const { rows: [user] } = await db.query(
      `INSERT INTO users (near_wallet) VALUES ($1)
       ON CONFLICT (near_wallet) DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [near_wallet]
    );

    const { rows: [sub] } = await db.query(
      `INSERT INTO submissions (contest_id, user_id, proof_link, notes, image_url)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (contest_id, user_id) DO UPDATE SET
         proof_link = EXCLUDED.proof_link, notes = EXCLUDED.notes,
         image_url = EXCLUDED.image_url
       RETURNING *`,
      [req.params.id, user.id, proof_link, notes, image_url]
    );
    res.json({ success: true, data: sub });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/contests/:id/review — approve/reject submission (admin allowlist enforced)
router.post("/:id/review", requireWallet, requireAdmin, async (req, res) => {
  const { submission_id, status, points } = req.body;
  const reviewed_by = req.wallet;
  if (!submission_id || !status) return res.status(400).json({ success: false, error: "submission_id and status required" });

  try {
    await db.transaction(async (client) => {
      await client.query(
        "UPDATE submissions SET status = $1, reviewed_by = $2 WHERE id = $3",
        [status, reviewed_by, submission_id]
      );

      // Award points if approved
      if (status === "approved" && points) {
        const { rows: [sub] } = await client.query("SELECT user_id FROM submissions WHERE id = $1", [submission_id]);
        if (sub) {
          await client.query(
            `INSERT INTO leaderboard (user_id, points) VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET points = leaderboard.points + $2, updated_at = NOW()`,
            [sub.user_id, points]
          );
        }
      }
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
