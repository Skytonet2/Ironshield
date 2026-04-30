#!/usr/bin/env node
// scripts/backfill-skill-names.js
//
// Phase 10 Tier 5 slice 2 — backfill the on-chain metadata mirror in
// skill_runtime_manifests.{name,description}. Schema slice 1 (PR #121)
// added these columns nullable; new manifests inserted via
// upsertManifest() now accept them inline, but every row inserted
// before this PR has NULLs and is therefore invisible to the FTS
// index.
//
// What this script does:
//   1. Pull the full skill list via list_skills_with_metadata (paged
//      at 100 per RPC call — the contract's cap).
//   2. For each on-chain Skill, look up every (skill_id, version) row
//      in skill_runtime_manifests where name IS NULL or description
//      IS NULL.
//   3. UPDATE name/description from the on-chain metadata.
//
// Idempotent. Safe to run repeatedly. Read-only against the contract
// — no transactions, no gas, no key required. The backfill is the
// reverse of seedBuiltinSkills.job.js (which writes off-chain →
// on-chain); this reads on-chain → off-chain.
//
// Run from repo root:
//   node scripts/backfill-skill-names.js
//
// Optional flags:
//   --dry-run     Print intended UPDATEs but don't execute them.
//   --skill-id N  Only backfill manifests for skill_id = N.

require("dotenv").config();
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local"), override: true });

const { providers } = require("near-api-js");
const db = require("../backend/db/client");
const { setNameAndDescription } = require("../backend/services/skillManifests");

const STAKING_CONTRACT = process.env.STAKING_CONTRACT || process.env.CONTRACT_ID || "ironshield.near";
const RPC_URL          = process.env.NEAR_RPC_URL     || "https://rpc.mainnet.near.org";
const PAGE_SIZE        = 100;

const DRY_RUN = process.argv.includes("--dry-run");
const ONLY_SKILL_ID = (() => {
  const i = process.argv.indexOf("--skill-id");
  return i >= 0 ? Number(process.argv[i + 1]) : null;
})();

async function* allSkills(provider) {
  // Paginate via list_skills(limit, offset) for ids + counts, then
  // get_skill_metadata(id) per row. list_skills_with_metadata returns
  // both in one call but the response includes the full SkillMetadata
  // body which we want anyway.
  let offset = 0;
  for (;;) {
    const args = Buffer.from(JSON.stringify({ limit: PAGE_SIZE, offset })).toString("base64");
    const res = await provider.query({
      request_type: "call_function",
      finality:     "final",
      account_id:   STAKING_CONTRACT,
      method_name:  "list_skills_with_metadata",
      args_base64:  args,
    });
    const text = Buffer.from(res.result).toString();
    const list = JSON.parse(text);
    if (!Array.isArray(list) || list.length === 0) return;
    for (const [skill, metadata] of list) {
      yield { skill, metadata };
    }
    if (list.length < PAGE_SIZE) return;
    offset += PAGE_SIZE;
  }
}

async function backfillOne({ skill, metadata }) {
  const skillId = Number(skill?.id);
  if (!Number.isFinite(skillId)) {
    console.warn(`[backfill] skipping row with non-numeric id:`, skill?.id);
    return { updated: 0, skipped: 1 };
  }
  if (ONLY_SKILL_ID !== null && skillId !== ONLY_SKILL_ID) {
    return { updated: 0, skipped: 1 };
  }

  const name = String(skill?.name || metadata?.name || "").slice(0, 256) || null;
  const description = String(skill?.description || metadata?.description || "").slice(0, 2000) || null;

  // Find every (skill_id, version) row that's missing one or both
  // mirror columns. Rows with both already populated are skipped —
  // we don't want to clobber a hand-edited row.
  const { rows } = await db.query(
    `SELECT skill_id, version, name, description
       FROM skill_runtime_manifests
      WHERE skill_id = $1
        AND (name IS NULL OR description IS NULL)`,
    [skillId]
  );
  if (rows.length === 0) return { updated: 0, skipped: 0 };

  let updated = 0;
  for (const row of rows) {
    const merged = {
      name:        row.name        ?? name,
      description: row.description ?? description,
    };
    console.log(`[backfill] skill_id=${skillId} version=${row.version} →`,
      JSON.stringify({ name: merged.name?.slice(0, 40), description: merged.description?.slice(0, 60) }));
    if (DRY_RUN) continue;
    await setNameAndDescription(skillId, row.version, merged);
    updated++;
  }
  return { updated, skipped: 0 };
}

async function main() {
  console.log(`[backfill] contract=${STAKING_CONTRACT} rpc=${RPC_URL} ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  if (ONLY_SKILL_ID !== null) console.log(`[backfill] filtering to skill_id=${ONLY_SKILL_ID}`);

  const provider = new providers.JsonRpcProvider({ url: RPC_URL });

  let totalSkillsSeen = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalNoOp = 0;

  for await (const entry of allSkills(provider)) {
    totalSkillsSeen++;
    const r = await backfillOne(entry);
    totalUpdated += r.updated;
    totalSkipped += r.skipped;
    if (r.updated === 0 && r.skipped === 0) totalNoOp++;
  }

  console.log(`[backfill] done. seen=${totalSkillsSeen} rows_updated=${totalUpdated} filter_skipped=${totalSkipped} already_populated=${totalNoOp}`);
  await db.close();
}

main().catch((e) => {
  console.error("[backfill] fatal:", e);
  process.exit(1);
});
