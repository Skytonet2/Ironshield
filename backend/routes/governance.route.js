// backend/routes/governance.route.js
const express = require("express");
const router  = express.Router();
const db      = require("../db/client");
const requireWallet = require("../middleware/requireWallet");

// GET /api/governance/proposals — list proposals
router.get("/proposals", async (req, res) => {
  const { status, type } = req.query;
  try {
    let sql = "SELECT * FROM proposals";
    const conditions = [];
    const params = [];

    if (status) { params.push(status); conditions.push(`status = $${params.length}`); }
    if (type)   { params.push(type);   conditions.push(`proposal_type = $${params.length}`); }

    if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY created_at DESC";

    const { rows } = await db.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/governance/proposals/:id — single proposal with votes
router.get("/proposals/:id", async (req, res) => {
  try {
    const { rows: [proposal] } = await db.query("SELECT * FROM proposals WHERE id = $1", [req.params.id]);
    if (!proposal) return res.status(404).json({ success: false, error: "Proposal not found" });

    const { rows: votes } = await db.query(
      "SELECT user_wallet, vote, power, created_at FROM votes WHERE proposal_id = $1 ORDER BY created_at DESC",
      [req.params.id]
    );
    res.json({ success: true, data: { ...proposal, votes } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/governance/proposals — create proposal
router.post("/proposals", requireWallet, async (req, res) => {
  const { title, description, proposal_type, content, expires_at } = req.body;
  const proposer = req.wallet;
  if (!title || !proposal_type) {
    return res.status(400).json({ success: false, error: "title and proposal_type required" });
  }

  try {
    const { rows: [proposal] } = await db.query(
      `INSERT INTO proposals (title, description, proposal_type, proposer, content, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, description, proposal_type, proposer, content, expires_at]
    );
    res.json({ success: true, data: proposal });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/governance/proposals/:id/vote — cast vote
router.post("/proposals/:id/vote", requireWallet, async (req, res) => {
  const { vote, power = 1 } = req.body;
  const user_wallet = req.wallet;
  if (!vote) return res.status(400).json({ success: false, error: "vote required" });
  if (!["for", "against"].includes(vote)) return res.status(400).json({ success: false, error: "vote must be 'for' or 'against'" });

  try {
    await db.transaction(async (client) => {
      // Insert or update vote
      const { rows: [existing] } = await client.query(
        "SELECT id, vote AS old_vote, power AS old_power FROM votes WHERE proposal_id = $1 AND user_wallet = $2",
        [req.params.id, user_wallet]
      );

      if (existing) {
        // Reverse old vote
        const reverseCol = existing.old_vote === "for" ? "votes_for" : "votes_against";
        await client.query(`UPDATE proposals SET ${reverseCol} = ${reverseCol} - $1 WHERE id = $2`, [existing.old_power, req.params.id]);
        await client.query("UPDATE votes SET vote = $1, power = $2 WHERE id = $3", [vote, power, existing.id]);
      } else {
        await client.query(
          "INSERT INTO votes (proposal_id, user_wallet, vote, power) VALUES ($1, $2, $3, $4)",
          [req.params.id, user_wallet, vote, power]
        );
      }

      // Apply new vote
      const col = vote === "for" ? "votes_for" : "votes_against";
      await client.query(`UPDATE proposals SET ${col} = ${col} + $1 WHERE id = $2`, [power, req.params.id]);
    });

    const { rows: [updated] } = await db.query("SELECT * FROM proposals WHERE id = $1", [req.params.id]);
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// public: server-to-server endpoint called by governanceListener (a separate
// Render worker, no NEAR wallet). Day 4 will replace with a shared-secret
// header so this isn't open to the world; for Day 1 it stays unauthenticated
// to keep the listener loop working until that swap lands.
router.post("/sync", async (req, res) => {
  const { proposals } = req.body;
  if (!Array.isArray(proposals)) return res.status(400).json({ success: false, error: "proposals array required" });

  try {
    let synced = 0;
    for (const p of proposals) {
      await db.query(
        `INSERT INTO proposals (chain_id, title, description, proposal_type, proposer, content, votes_for, votes_against, status, executed, executed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (chain_id) DO UPDATE SET
           votes_for = EXCLUDED.votes_for,
           votes_against = EXCLUDED.votes_against,
           status = EXCLUDED.status,
           executed = EXCLUDED.executed,
           executed_at = EXCLUDED.executed_at`,
        [p.id, p.title, p.description, p.proposal_type, p.proposer, p.content,
         p.votes_for || 0, p.votes_against || 0, p.status || "active", p.executed || false, p.executed_at]
      );
      synced++;
    }
    res.json({ success: true, synced });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
