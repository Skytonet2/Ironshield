// backend/routes/kitDeployments.route.js
//
// Phase 10 Tier 2 — Kit deployment off-chain mirror.
//
// The contract is the source of truth for the agent identity itself
// (register_agent), but the binding "agent X is running Kit Y with these
// preset values" lives off-chain in kit_deployments. The deploy wizard
// signs register_agent on-chain and then POSTs here so the dashboard
// can show the deployed instance.

const router = require("express").Router();
const requireWallet = require("../middleware/requireWallet");
const db = require("../db/client");

// List deployments. Default scope is "mine" when an x-wallet header
// is supplied; otherwise an admin/public scan with optional kit_slug.
router.get("/", async (req, res) => {
  try {
    const { kit_slug, status, mine, limit } = req.query;
    const clauses = [];
    const params = [];
    if (kit_slug) {
      params.push(kit_slug);
      clauses.push(`kit_slug = $${params.length}`);
    }
    if (status) {
      params.push(status);
      clauses.push(`status = $${params.length}`);
    }
    if (mine === "1" && req.headers["x-wallet"]) {
      params.push(String(req.headers["x-wallet"]).toLowerCase());
      clauses.push(`LOWER(agent_owner_wallet) = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(Math.min(Number(limit) || 50, 200));
    const sql = `
      SELECT id, kit_slug, kit_version_id, agent_owner_wallet,
             preset_config_json, status, created_at
        FROM kit_deployments
        ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`;
    const { rows } = await db.query(sql, params);
    res.json({ deployments: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Record a fresh deployment. Wallet-authenticated — owner is the
// signed-in wallet, not whatever the body claims.
router.post("/", requireWallet, async (req, res) => {
  try {
    const { kit_slug, preset_config_json, kit_version_id, ironguide_session_id } = req.body || {};
    if (!kit_slug) return res.status(400).json({ error: "kit_slug required" });

    // Confirm the Kit exists and is deployable.
    const kitRow = await db.query(
      `SELECT slug, status FROM agent_kits WHERE slug = $1`,
      [kit_slug],
    );
    if (!kitRow.rows[0]) return res.status(404).json({ error: "Kit not found" });
    if (kitRow.rows[0].status === "deprecated") {
      return res.status(409).json({ error: "Kit is deprecated" });
    }

    const owner = String(req.wallet).toLowerCase();
    const presets = preset_config_json && typeof preset_config_json === "object"
      ? preset_config_json
      : {};
    const { rows } = await db.query(
      `INSERT INTO kit_deployments
         (kit_slug, kit_version_id, agent_owner_wallet, preset_config_json, status)
       VALUES ($1, $2, $3, $4::jsonb, 'active')
       RETURNING id, kit_slug, kit_version_id, agent_owner_wallet,
                 preset_config_json, status, created_at`,
      [kit_slug, kit_version_id || null, owner, JSON.stringify(presets)],
    );

    // Best-effort: flip the IronGuide session if one was attached. Doing
    // this here keeps the wizard <-> concierge link bookkeeping in one
    // request the user explicitly authorized.
    if (ironguide_session_id) {
      await db.query(
        `UPDATE ironguide_sessions
            SET status = 'deployed', updated_at = NOW()
          WHERE id = $1`,
        [Number(ironguide_session_id)],
      ).catch(() => { /* ignore — concierge attribution is best-effort */ });
    }

    res.json({ ok: true, deployment: rows[0] });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Update status (pause / retire). Only the owner can flip it.
router.post("/:id/status", requireWallet, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id must be numeric" });
    const { status } = req.body || {};
    if (!["pending", "active", "paused", "retired"].includes(status)) {
      return res.status(400).json({ error: "status must be pending|active|paused|retired" });
    }
    const owner = String(req.wallet).toLowerCase();
    const { rows } = await db.query(
      `UPDATE kit_deployments
          SET status = $1
        WHERE id = $2 AND LOWER(agent_owner_wallet) = $3
        RETURNING id, status`,
      [status, id, owner],
    );
    if (!rows[0]) return res.status(403).json({ error: "Not your deployment or not found" });
    res.json({ ok: true, deployment: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Aggregate counts so the catalog can show "deployed N times" sorted
// by popularity. Public.
router.get("/counts", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT kit_slug, COUNT(*)::int AS deployments
         FROM kit_deployments
        WHERE status IN ('active','paused')
        GROUP BY kit_slug`,
    );
    const map = {};
    for (const r of rows) map[r.kit_slug] = r.deployments;
    res.json({ counts: map });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
