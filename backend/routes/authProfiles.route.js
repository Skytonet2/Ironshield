// backend/routes/authProfiles.route.js
//
// Phase 10 Tier 2 — auth_profiles surface for the deploy wizard's
// Permissions step. v1 is intentionally tiny: list / create / update
// scoped to the caller's wallet. Agent- and mission-bound profiles
// land in Phase 2 with the crew orchestrator; this route only
// supports user_wallet-scoped profiles today.

const router = require("express").Router();
const requireWallet = require("../middleware/requireWallet");
const db = require("../db/client");

// List profiles for the signed-in wallet. ?mine=1 is implied — there's
// no public list view, since profiles can carry sensitive rule sets.
router.get("/", requireWallet, async (req, res) => {
  try {
    const wallet = String(req.wallet).toLowerCase();
    const { rows } = await db.query(
      `SELECT id, user_wallet, agent_owner_wallet, mission_on_chain_id,
              rules_json, is_default, created_at, updated_at
         FROM auth_profiles
        WHERE LOWER(user_wallet) = $1
        ORDER BY is_default DESC, updated_at DESC`,
      [wallet],
    );
    res.json({ profiles: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create a profile. The unique partial index idx_auth_profiles_user_default
// guarantees at most one is_default=TRUE row per wallet — we flip the
// previous default off in a transaction when the caller marks a new one.
router.post("/", requireWallet, async (req, res) => {
  try {
    const wallet = String(req.wallet).toLowerCase();
    const { rules_json, is_default } = req.body || {};
    const rules = Array.isArray(rules_json) ? rules_json : [];
    const flag  = Boolean(is_default);

    const row = await db.transaction(async (client) => {
      if (flag) {
        await client.query(
          `UPDATE auth_profiles SET is_default = FALSE, updated_at = NOW()
            WHERE LOWER(user_wallet) = $1 AND is_default = TRUE`,
          [wallet],
        );
      }
      const { rows } = await client.query(
        `INSERT INTO auth_profiles (user_wallet, rules_json, is_default)
         VALUES ($1, $2::jsonb, $3)
         RETURNING id, user_wallet, agent_owner_wallet, mission_on_chain_id,
                   rules_json, is_default, created_at, updated_at`,
        [wallet, JSON.stringify(rules), flag],
      );
      return rows[0];
    });
    res.json({ ok: true, profile: row });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Update — only the rules and is_default flag are mutable. user_wallet
// scope is locked at create time so a wallet can't move someone else's
// profile under itself.
router.patch("/:id", requireWallet, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id must be numeric" });
    const wallet = String(req.wallet).toLowerCase();
    const { rules_json, is_default } = req.body || {};

    const row = await db.transaction(async (client) => {
      const existing = await client.query(
        `SELECT id FROM auth_profiles WHERE id = $1 AND LOWER(user_wallet) = $2`,
        [id, wallet],
      );
      if (!existing.rows[0]) return null;

      if (is_default === true) {
        await client.query(
          `UPDATE auth_profiles SET is_default = FALSE, updated_at = NOW()
            WHERE LOWER(user_wallet) = $1 AND is_default = TRUE AND id <> $2`,
          [wallet, id],
        );
      }
      const fields = [];
      const params = [id];
      if (Array.isArray(rules_json)) {
        params.push(JSON.stringify(rules_json));
        fields.push(`rules_json = $${params.length}::jsonb`);
      }
      if (typeof is_default === "boolean") {
        params.push(is_default);
        fields.push(`is_default = $${params.length}`);
      }
      if (fields.length === 0) {
        const { rows } = await client.query(`SELECT * FROM auth_profiles WHERE id = $1`, [id]);
        return rows[0];
      }
      const { rows } = await client.query(
        `UPDATE auth_profiles
            SET ${fields.join(", ")}, updated_at = NOW()
          WHERE id = $1
          RETURNING id, user_wallet, agent_owner_wallet, mission_on_chain_id,
                    rules_json, is_default, created_at, updated_at`,
        params,
      );
      return rows[0];
    });

    if (!row) return res.status(403).json({ error: "Not your profile or not found" });
    res.json({ ok: true, profile: row });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete("/:id", requireWallet, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id must be numeric" });
    const wallet = String(req.wallet).toLowerCase();
    const { rowCount } = await db.query(
      `DELETE FROM auth_profiles WHERE id = $1 AND LOWER(user_wallet) = $2`,
      [id, wallet],
    );
    if (rowCount === 0) return res.status(403).json({ error: "Not your profile or not found" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
