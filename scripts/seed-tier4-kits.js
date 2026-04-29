// scripts/seed-tier4-kits.js
//
// One-shot seed for the Phase 10 Tier 4 Kits + their builtin skills.
//
// Why this exists: until the Phase 10 contract is deployed to mainnet
// AND the indexer is mirroring `kit_registered` events, `agent_kits`
// stays empty and the four spec Kits never appear in /marketplace/kits.
// This script populates the off-chain mirror directly so the UX works
// today. When Phase 10 contract eventually ships, a follow-up
// reconciliation will replace these placeholder skill_ids with the
// real on-chain BIGINTs.
//
// Idempotent: every INSERT is `ON CONFLICT … DO UPDATE` against the
// natural unique key. Re-running is safe; on the second run nothing
// downstream changes (manifest_hash + payload are deterministic).
//
// Usage:
//   node scripts/seed-tier4-kits.js              # apply to DATABASE_URL
//   node scripts/seed-tier4-kits.js --dry-run    # print SQL, do not write
//
// Env: DATABASE_URL — picked up via backend/db/client. The Render
// pre-deploy hook runs this in the production container's env.

const fs   = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const KITS_DIR = path.join(__dirname, "..", "backend", "data", "kits");
const DRY_RUN  = process.argv.includes("--dry-run");

// Off-chain skill_id offset. 9_000_000+ keeps us clear of any Phase 10
// on-chain Skill IDs (which start at 1) so when contract registers
// them for real we won't collide. A future reconciliation script will
// remap on-chain IDs to off-chain placeholders.
const SKILL_ID = {
  scout_fb:         9_000_001,
  scout_jiji:       9_000_002,
  scout_x:          9_000_003,
  scout_tg:         9_000_004,
  outreach_dm:      9_000_005,
  negotiator:       9_000_006,
  verifier_listing: 9_000_007,
  verifier_scam:    9_000_008,
  pitch_gen:        9_000_009,
  scam_detect:      9_000_010,
  report_gen:       9_000_011,
};

// crewOrchestrator's role enum. Each manifest's category MUST be one
// of these — the resolver enforces it at runtime.
const SKILL_CATEGORY = {
  scout_fb:         "scout",
  scout_jiji:       "scout",
  scout_x:          "scout",
  scout_tg:         "scout",
  outreach_dm:      "outreach",
  negotiator:       "negotiator",
  verifier_listing: "verifier",
  verifier_scam:    "verifier",
  pitch_gen:        "reporter",
  scam_detect:      "verifier",
  report_gen:       "reporter",
};

const SKILL_CONNECTORS = {
  scout_fb:         ["facebook"],
  scout_jiji:       ["jiji"],
  scout_x:          ["x"],
  scout_tg:         ["tg"],
  outreach_dm:      [],   // multi-channel; uses whatever is connected
  negotiator:       [],   // LLM-only
  verifier_listing: [],
  verifier_scam:    [],
  pitch_gen:        [],
  scam_detect:      [],
  report_gen:       [],
};

const CURATOR_WALLET = "ironshield.near";

function canonicalJson(obj) {
  // Stable, sorted-key JSON for hashing — so the same manifest hashes
  // identically across machines and runs.
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function readKitManifests() {
  const out = [];
  for (const file of fs.readdirSync(KITS_DIR)) {
    if (!file.endsWith(".json")) continue;
    const fp = path.join(KITS_DIR, file);
    const json = JSON.parse(fs.readFileSync(fp, "utf8"));
    out.push(json);
  }
  return out;
}

function categoryFromBundledEntry(entry) {
  // Entries are either "builtin:<id>" or { skill: "builtin:<id>", params }.
  const cat = typeof entry === "string" ? entry : entry?.skill;
  if (typeof cat !== "string" || !cat.startsWith("builtin:")) return null;
  return cat.slice("builtin:".length);
}

async function main() {
  const kits = readKitManifests();
  console.log(`[seed] read ${kits.length} kit manifests from ${KITS_DIR}`);

  // db.client wires up the Postgres pool from DATABASE_URL.
  const db = require("../backend/db/client");
  const skillManifests = require("../backend/services/skillManifests");

  const client = await db.pool.connect();
  let exitCode = 0;

  try {
    if (DRY_RUN) console.log("[seed] DRY RUN — no writes");
    if (!DRY_RUN) await client.query("BEGIN");

    // 1) Skill runtime manifests — one per built-in skill.
    for (const [skill_name, skill_id] of Object.entries(SKILL_ID)) {
      const category = SKILL_CATEGORY[skill_name];
      const required_connectors = SKILL_CONNECTORS[skill_name];
      const tool_manifest = [{ runtime_category: `builtin:${skill_name}` }];
      const prompt_fragment = `(builtin: ${skill_name})`;

      console.log(`[seed] skill_runtime_manifests upsert skill_id=${skill_id} (${skill_name}, ${category})`);

      if (DRY_RUN) continue;
      await skillManifests.upsertManifest({
        skill_id,
        version: "v1",
        category,
        vertical_tags: [],
        prompt_fragment,
        tool_manifest,
        required_connectors,
        io_schema: {},
        status: "active",
      });
    }

    // 2) Agent kits — one per JSON manifest.
    for (const kit of kits) {
      const manifest_hash = sha256Hex(canonicalJson(kit));

      // Resolve bundled_skills → BIGINT[] in the manifest's order.
      const bundled_skill_ids = (kit.bundled_skills || [])
        .map((entry) => SKILL_ID[categoryFromBundledEntry(entry)])
        .filter((id) => Number.isFinite(id));
      if (bundled_skill_ids.length !== (kit.bundled_skills || []).length) {
        throw new Error(`kit ${kit.slug}: bundled_skills contains an unknown builtin`);
      }

      const split = kit.revenue_split_bps || { kit_curator: 1500, agent_owner: 7500, platform: 1000 };
      const example_missions     = kit.example_missions       || [];
      const required_connectors  = kit.required_connectors    || [];
      const preset_config_schema = kit.preset_config_schema   || {};
      const default_pricing      = kit.default_pricing        || {};
      const status               = kit.status                 || "beta";

      console.log(`[seed] agent_kits upsert slug=${kit.slug} (${kit.vertical}, ${bundled_skill_ids.length} skills)`);

      if (DRY_RUN) continue;
      await client.query(
        `INSERT INTO agent_kits
           (slug, title, vertical, description, hero_image_url,
            example_missions, required_connectors, bundled_skill_ids,
            preset_config_schema_json, default_auth_profile_id,
            default_pricing_json, curator_wallet, manifest_hash,
            kit_curator_bps, agent_owner_bps, platform_bps, status,
            created_at, updated_at)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NULL,
            $10::jsonb, $11, $12, $13, $14, $15, $16, NOW(), NOW())
         ON CONFLICT (slug) DO UPDATE SET
           title = EXCLUDED.title,
           vertical = EXCLUDED.vertical,
           description = EXCLUDED.description,
           hero_image_url = EXCLUDED.hero_image_url,
           example_missions = EXCLUDED.example_missions,
           required_connectors = EXCLUDED.required_connectors,
           bundled_skill_ids = EXCLUDED.bundled_skill_ids,
           preset_config_schema_json = EXCLUDED.preset_config_schema_json,
           default_pricing_json = EXCLUDED.default_pricing_json,
           curator_wallet = EXCLUDED.curator_wallet,
           manifest_hash = EXCLUDED.manifest_hash,
           kit_curator_bps = EXCLUDED.kit_curator_bps,
           agent_owner_bps = EXCLUDED.agent_owner_bps,
           platform_bps = EXCLUDED.platform_bps,
           status = EXCLUDED.status,
           updated_at = NOW()`,
        [
          kit.slug,
          kit.title || kit.slug,
          kit.vertical,
          kit.description || "",
          kit.hero_image_url || null,
          example_missions,
          required_connectors,
          bundled_skill_ids,
          JSON.stringify(preset_config_schema),
          JSON.stringify(default_pricing),
          CURATOR_WALLET,
          manifest_hash,
          split.kit_curator,
          split.agent_owner,
          split.platform,
          status,
        ],
      );
    }

    // 3) Mission templates — one default per Kit so users can post a
    // mission against it. compatible_kits is informational at v1.
    for (const kit of kits) {
      const default_crew = (kit.bundled_skills || []).map((entry) => {
        const skill_name = categoryFromBundledEntry(entry);
        return SKILL_CATEGORY[skill_name];
      }).filter(Boolean);

      const required_inputs = Object.keys(kit.preset_config_schema?.properties || {})
        .filter((k) => (kit.preset_config_schema?.required || []).includes(k));

      const slug = `${kit.slug}_default`;
      console.log(`[seed] mission_templates upsert slug=${slug}`);

      if (DRY_RUN) continue;
      await client.query(
        `INSERT INTO mission_templates
           (slug, vertical, title, description, required_inputs_json,
            default_crew_json, compatible_kits, language_support, status)
         VALUES
           ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, 'active')
         ON CONFLICT (slug) DO UPDATE SET
           vertical = EXCLUDED.vertical,
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           required_inputs_json = EXCLUDED.required_inputs_json,
           default_crew_json = EXCLUDED.default_crew_json,
           compatible_kits = EXCLUDED.compatible_kits,
           language_support = EXCLUDED.language_support,
           status = EXCLUDED.status,
           updated_at = NOW()`,
        [
          slug,
          kit.vertical,
          `${kit.title} — default mission`,
          kit.description || "",
          JSON.stringify(required_inputs),
          JSON.stringify(default_crew),
          [kit.slug],
          ["en"],
        ],
      );
    }

    if (!DRY_RUN) await client.query("COMMIT");
    console.log("[seed] done");
  } catch (e) {
    if (!DRY_RUN) await client.query("ROLLBACK");
    console.error("[seed] FAILED:", e.message);
    exitCode = 1;
  } finally {
    client.release();
    await db.pool.end().catch(() => {});
    process.exit(exitCode);
  }
}

main().catch((e) => {
  console.error("[seed] unhandled:", e);
  process.exit(1);
});
