#!/usr/bin/env node
// backend/jobs/seedWalletWatchKit.job.js
//
// Phase 10 Tier 3 — Wallet Watch Kit installer (off-chain side).
//
// Bridges the four built-in skills (watch_balance, detect_drain,
// classify_alert, alert_owner) and their JSON manifests under
// `manifests/wallet-watch-kit/` into the running Postgres + the
// running on-chain Skill catalogue.
//
// Pipeline:
//
//   1. Read the four manifest files from manifests/wallet-watch-kit/.
//      Each file's tool_manifest[0].runtime_category names a built-in
//      ("builtin:<id>"); that's how we map a manifest back to an
//      on-chain Skill row.
//   2. Query the contract's list_skills_with_metadata for our category
//      strings and capture the on-chain skill_ids. If a skill isn't
//      registered yet, abort and tell the operator to run
//      seedBuiltinSkills.job.js first — that job's the canonical path.
//   3. Upsert each manifest into skill_runtime_manifests with the
//      resolved skill_id, status='curated'. Then promote the row to
//      status='active' so crewOrchestrator.resolveStep finds it via
//      getActiveManifest.
//   4. Compute a deterministic manifest_hash over the kit body and
//      upsert the agent_kits row. bundled_skill_ids is filled in once
//      we know the resolved IDs.
//   5. Upsert the mission_templates row for slug 'watch-wallet'.
//
// On-chain register_kit happens in a separate script
// (scripts/register-wallet-watch-kit.js) so the off-chain side can be
// run in CI or against a fresh dev DB without an RPC dependency.
//
// Usage:
//   node backend/jobs/seedWalletWatchKit.job.js
//
// Required env (with defaults):
//   STAKING_CONTRACT  ironshield.near
//   NEAR_RPC_URL      https://rpc.mainnet.near.org
//   CURATOR_WALLET    ironshield.near
//
// Exit codes:
//   0  success
//   1  required built-in skill not registered on-chain — run seed first
//   2  DB error
//   3  manifest validation error

require("dotenv").config();
require("dotenv").config({ path: require("path").resolve(__dirname, "..", "..", ".env.local"), override: true });

const fs   = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { providers } = require("near-api-js");
const db = require("../db/client");
const skillManifests = require("../services/skillManifests");

const KIT_SLUG          = "wallet-watch-kit";
const TEMPLATE_SLUG     = "watch-wallet";
const VERTICAL          = "security";
const STAKING_CONTRACT  = process.env.STAKING_CONTRACT || "ironshield.near";
const RPC_URL           = process.env.NEAR_RPC_URL     || "https://rpc.mainnet.near.org";
const CURATOR_WALLET    = process.env.CURATOR_WALLET   || "ironshield.near";

// 10/85/5 — kit_curator / agent_owner / platform.
const KIT_CURATOR_BPS = 1000;
const AGENT_OWNER_BPS = 8500;
const PLATFORM_BPS    = 500;

const ONE_NEAR_YOCTO  = "1000000000000000000000000";

const MANIFESTS_DIR = path.resolve(__dirname, "..", "..", "manifests", "wallet-watch-kit");

// Order matters: it's the default crew sequence and the bundled_skill_ids order.
const SKILL_FILES = [
  { file: "watch_balance.json",  runtime_category: "builtin:watch_balance",  role: "scout" },
  { file: "detect_drain.json",   runtime_category: "builtin:detect_drain",   role: "verifier" },
  { file: "classify_alert.json", runtime_category: "builtin:classify_alert", role: "reporter" },
  { file: "alert_owner.json",    runtime_category: "builtin:alert_owner",    role: "outreach" },
];

const PRESET_CONFIG_SCHEMA = {
  type: "object",
  required: ["address", "alert_threshold_yocto"],
  properties: {
    address: {
      type: "string",
      title: "Watched NEAR account",
      description: "The NEAR account whose balance the kit will poll.",
    },
    alert_threshold_yocto: {
      type: "string",
      title: "Alert threshold (yoctoNEAR)",
      description: "Minimum absolute outflow that always trips an alert. Default: 1 NEAR.",
      default: ONE_NEAR_YOCTO,
    },
    alert_channel: {
      type: "string",
      title: "Alert channel",
      enum: ["tg"],
      default: "tg",
    },
    poll_interval_seconds: {
      type: "integer",
      title: "Poll interval (seconds)",
      default: 60,
      minimum: 30,
      maximum: 3600,
    },
    known_destinations: {
      type: "array",
      title: "Known destinations",
      items: { type: "string" },
      description: "Accounts the owner already trusts; outflows to these don't trip the new-destination heuristic.",
      default: [],
    },
  },
};

const DEFAULT_PRICING = {
  // Per kit-catalog memo: IronGuide.pickKit reads tags here for matching.
  tags: ["security", "near", "wallet-watch", "global"],
  fee_yocto: "0",
  language: ["en"],
};

function stableStringify(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

function computeKitHash({ bundled_skill_ids, preset_config_schema, default_pricing }) {
  const body = {
    slug: KIT_SLUG,
    vertical: VERTICAL,
    bundled_skill_ids: [...bundled_skill_ids].sort((a, b) => a - b),
    preset_config_schema,
    default_pricing,
  };
  return crypto.createHash("sha256").update(stableStringify(body)).digest("hex");
}

function readManifestFile(filename) {
  const full = path.join(MANIFESTS_DIR, filename);
  if (!fs.existsSync(full)) throw new Error(`Manifest file missing: ${full}`);
  const raw = JSON.parse(fs.readFileSync(full, "utf8"));
  for (const f of ["version", "category", "prompt_fragment", "tool_manifest"]) {
    if (!(f in raw)) throw new Error(`${full}: missing required field "${f}"`);
  }
  return raw;
}

async function fetchOnChainBuiltins() {
  const provider = new providers.JsonRpcProvider({ url: RPC_URL });
  const args = Buffer.from(JSON.stringify({ limit: 100, offset: 0 })).toString("base64");
  const res = await provider.query({
    request_type: "call_function",
    finality:     "final",
    account_id:   STAKING_CONTRACT,
    method_name:  "list_skills_with_metadata",
    args_base64:  args,
  });
  const text = Buffer.from(res.result).toString();
  const list = JSON.parse(text);
  const byCategory = new Map();
  for (const [skill, metadata] of list || []) {
    const cat = metadata?.category;
    if (typeof cat === "string" && cat.startsWith("builtin:")) {
      byCategory.set(cat, Number(skill.id));
    }
  }
  return byCategory;
}

async function upsertKitRow({ bundled_skill_ids, manifest_hash, log }) {
  const sql = `
    INSERT INTO agent_kits (
      slug, title, vertical, description, hero_image_url, example_missions,
      required_connectors, bundled_skill_ids, preset_config_schema_json,
      default_pricing_json, curator_wallet, manifest_hash,
      kit_curator_bps, agent_owner_bps, platform_bps, status
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9::jsonb,
      $10::jsonb, $11, $12,
      $13, $14, $15, $16
    )
    ON CONFLICT (slug) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      bundled_skill_ids = EXCLUDED.bundled_skill_ids,
      preset_config_schema_json = EXCLUDED.preset_config_schema_json,
      default_pricing_json = EXCLUDED.default_pricing_json,
      manifest_hash = EXCLUDED.manifest_hash,
      kit_curator_bps = EXCLUDED.kit_curator_bps,
      agent_owner_bps = EXCLUDED.agent_owner_bps,
      platform_bps = EXCLUDED.platform_bps,
      status = EXCLUDED.status,
      required_connectors = EXCLUDED.required_connectors,
      example_missions = EXCLUDED.example_missions,
      updated_at = NOW()
    RETURNING slug, manifest_hash, bundled_skill_ids`;
  const params = [
    KIT_SLUG,
    "Wallet Watch Kit",
    VERTICAL,
    "Watches a NEAR account for drain patterns and pings the owner over Telegram. Single-recipient alerts run at auto policy; the owner approves or rejects from the inline keyboard.",
    null,
    [
      "Watch a personal hot wallet for unauthorised outflows",
      "Page on-call when the protocol treasury moves >1 NEAR",
      "Alert when funds are sent to a never-before-seen destination",
    ],
    ["telegram"],
    bundled_skill_ids,
    JSON.stringify(PRESET_CONFIG_SCHEMA),
    JSON.stringify(DEFAULT_PRICING),
    CURATOR_WALLET,
    manifest_hash,
    KIT_CURATOR_BPS,
    AGENT_OWNER_BPS,
    PLATFORM_BPS,
    "beta",
  ];
  const { rows } = await db.query(sql, params);
  log(`[kit] agent_kits row → slug=${rows[0].slug}  hash=${rows[0].manifest_hash.slice(0, 12)}…`);
  return rows[0];
}

async function upsertMissionTemplate({ log }) {
  const required_inputs = [
    { key: "address",               type: "string", required: true,  hint: "NEAR account to watch" },
    { key: "alert_threshold_yocto", type: "string", required: false, default: ONE_NEAR_YOCTO, hint: "Outflow that always alarms" },
    { key: "alert_channel",         type: "string", required: false, default: "tg" },
    { key: "poll_interval_seconds", type: "integer", required: false, default: 60 },
  ];
  const default_crew = ["scout", "verifier", "reporter", "outreach"];

  const sql = `
    INSERT INTO mission_templates (
      slug, vertical, title, description, required_inputs_json,
      default_crew_json, compatible_kits, geo_scope, language_support, status
    ) VALUES (
      $1, $2, $3, $4, $5::jsonb,
      $6::jsonb, $7, $8, $9, $10
    )
    ON CONFLICT (slug) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      required_inputs_json = EXCLUDED.required_inputs_json,
      default_crew_json = EXCLUDED.default_crew_json,
      compatible_kits = EXCLUDED.compatible_kits,
      geo_scope = EXCLUDED.geo_scope,
      language_support = EXCLUDED.language_support,
      status = EXCLUDED.status,
      updated_at = NOW()
    RETURNING slug`;
  const params = [
    TEMPLATE_SLUG,
    VERTICAL,
    "Watch a NEAR wallet for drain patterns",
    "Polls a NEAR account's balance on a schedule. When an outflow trips the threshold, percentage, or new-destination heuristic, the crew formats an alert and pings the owner over Telegram.",
    JSON.stringify(required_inputs),
    JSON.stringify(default_crew),
    [KIT_SLUG],
    "global",
    ["en"],
    "active",
  ];
  const { rows } = await db.query(sql, params);
  log(`[template] mission_templates row → slug=${rows[0].slug}`);
  return rows[0];
}

async function setManifestActive(skill_id, version) {
  await db.query(
    `UPDATE skill_runtime_manifests SET status = 'active'
      WHERE skill_id = $1 AND version = $2`,
    [skill_id, version],
  );
}

async function run({ log = console.log, err = console.error } = {}) {
  // 1. Load manifest files.
  const loaded = SKILL_FILES.map(({ file, runtime_category, role }) => {
    const body = readManifestFile(file);
    if (body.category !== role) {
      throw new Error(`${file}: category="${body.category}" does not match expected role "${role}"`);
    }
    const declared = body.tool_manifest?.[0]?.runtime_category;
    if (declared !== runtime_category) {
      throw new Error(`${file}: tool_manifest[0].runtime_category="${declared}" does not match "${runtime_category}"`);
    }
    return { file, runtime_category, role, body };
  });
  log(`[load] read ${loaded.length} manifest file(s) from ${MANIFESTS_DIR}`);

  // 2. Resolve on-chain skill_ids by category.
  let onChain;
  try { onChain = await fetchOnChainBuiltins(); }
  catch (e) {
    err(`[chain] failed to read list_skills_with_metadata: ${e.message}`);
    return { exitCode: 1 };
  }
  log(`[chain] found ${onChain.size} builtin skills on ${STAKING_CONTRACT}`);

  const missing = loaded.filter((l) => !onChain.has(l.runtime_category));
  if (missing.length > 0) {
    err(`[chain] missing on-chain registration for: ${missing.map((m) => m.runtime_category).join(", ")}`);
    err(`        run: node backend/jobs/seedBuiltinSkills.job.js`);
    return { exitCode: 1 };
  }

  const resolved = loaded.map((l) => ({ ...l, skill_id: onChain.get(l.runtime_category) }));
  for (const r of resolved) log(`[map] ${r.runtime_category} → skill_id=${r.skill_id} (role=${r.role})`);

  // 3. Upsert manifests, then promote to active.
  for (const r of resolved) {
    const result = await skillManifests.upsertManifest({
      skill_id:            r.skill_id,
      version:             r.body.version,
      category:            r.body.category,
      vertical_tags:       r.body.vertical_tags || [],
      prompt_fragment:     r.body.prompt_fragment,
      tool_manifest:       r.body.tool_manifest || [],
      required_connectors: r.body.required_connectors || [],
      io_schema:           r.body.io_schema || {},
      status:              "curated",
    });
    log(`[manifest] upsert skill_id=${r.skill_id} v${r.body.version} → hash ${result.manifest_hash.slice(0, 12)}…`);
    await setManifestActive(r.skill_id, r.body.version);
  }

  // 4. Compute kit hash and upsert agent_kits row.
  const bundled_skill_ids = resolved.map((r) => r.skill_id);
  const manifest_hash = computeKitHash({
    bundled_skill_ids,
    preset_config_schema: PRESET_CONFIG_SCHEMA,
    default_pricing: DEFAULT_PRICING,
  });
  await upsertKitRow({ bundled_skill_ids, manifest_hash, log });

  // 5. Upsert mission template.
  await upsertMissionTemplate({ log });

  log("");
  log(`✓ Wallet Watch Kit seeded.`);
  log(`  agent_kits.slug         = ${KIT_SLUG}`);
  log(`  agent_kits.manifest_hash = ${manifest_hash}`);
  log(`  bundled_skill_ids        = [${bundled_skill_ids.join(", ")}]`);
  log(`  mission_templates.slug   = ${TEMPLATE_SLUG}`);
  log("");
  log(`Next: register on-chain with`);
  log(`  node scripts/register-wallet-watch-kit.js`);

  return { exitCode: 0, manifest_hash, bundled_skill_ids };
}

async function main() {
  let result;
  try { result = await run(); }
  catch (e) {
    console.error(`[seed-wwk] fatal: ${e.message}`);
    if (e.stack) console.error(e.stack);
    process.exit(3);
  } finally {
    try { await db.close(); } catch { /* ignore */ }
  }
  process.exit(result.exitCode);
}

if (require.main === module) main();

module.exports = {
  KIT_SLUG,
  TEMPLATE_SLUG,
  PRESET_CONFIG_SCHEMA,
  DEFAULT_PRICING,
  computeKitHash,
  stableStringify,
  readManifestFile,
  SKILL_FILES,
  run,
};
