// backend/routes/kits.route.js
//
// Phase 10 — Agent Economy: Kit catalog (read-only at v1).
//
// At v1 there are no live Kits — Phase 1 is pure infrastructure. This
// route surfaces the catalog as soon as the IronShield team writes the
// first row into agent_kits. Authoring is owner-only on-chain
// (register_kit) and the off-chain mirror is populated by the same
// team through direct SQL or the indexer.

const router = require("express").Router();
const db = require("../db/client");

router.get("/", async (req, res) => {
  try {
    const { vertical, status } = req.query;
    const clauses = [];
    const params = [];
    if (vertical) { params.push(vertical); clauses.push(`vertical = $${params.length}`); }
    if (status)   { params.push(status);   clauses.push(`status = $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const sql = `
      SELECT slug, title, vertical, description, hero_image_url,
             example_missions, required_connectors, bundled_skill_ids,
             preset_config_schema_json, default_pricing_json,
             curator_wallet, manifest_hash, kit_curator_bps,
             agent_owner_bps, platform_bps, status, created_at, updated_at
        FROM agent_kits
        ${where}
       ORDER BY updated_at DESC`;
    const { rows } = await db.query(sql, params);
    res.json({ kits: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/:slug", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT slug, title, vertical, description, hero_image_url,
              example_missions, required_connectors, bundled_skill_ids,
              preset_config_schema_json, default_pricing_json,
              curator_wallet, manifest_hash, kit_curator_bps,
              agent_owner_bps, platform_bps, status, created_at, updated_at
         FROM agent_kits
        WHERE slug = $1`,
      [req.params.slug],
    );
    if (!rows[0]) return res.status(404).json({ error: "Kit not found" });
    const versions = await db.query(
      `SELECT version, manifest_hash, deployed_at
         FROM kit_versions
        WHERE kit_slug = $1
        ORDER BY deployed_at DESC LIMIT 20`,
      [req.params.slug],
    );
    res.json({ kit: rows[0], versions: versions.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
