#!/usr/bin/env node
// backend/scripts/import-skill-manifests.js
//
// Bulk-import skill runtime manifests from a directory of JSON files
// into the skill_runtime_manifests table. Required for scale: the
// catalog has hundreds of manifests queued and there's no admin UI for
// loading them one at a time.
//
// Each input file is one manifest. Shape matches `upsertManifest`'s
// arguments (see backend/services/skillManifests.js):
//
//   {
//     "skill_id": 12,                  // u64 — must match an on-chain Skill
//     "version":  "1.0.0",
//     "category": "outreach",
//     "vertical_tags":       ["crypto", "defi"],          // optional
//     "prompt_fragment":     "You are a wallet-watch ...",
//     "tool_manifest":       [ { "name": "..." } ],       // optional
//     "required_connectors": ["telegram"],                // optional
//     "io_schema":           { "type": "object", ... },   // optional
//     "status":              "curated"                    // optional, default 'internal'
//   }
//
// Behaviour:
//   • Loads every .json file in the directory (non-recursive).
//   • Validates shape — invalid manifests abort the run with a clear
//     report (no partial imports of a bad batch).
//   • Dedupes by (skill_id, version) within the input set; conflicting
//     duplicates are reported as fatal.
//   • For each unique manifest, classifies vs the current DB row:
//       create     — no existing row, will insert
//       update     — existing row's manifest_hash differs, will overwrite
//       unchanged  — existing row's hash + status match, skipped (so
//                    deployed_at isn't pointlessly bumped)
//   • In --dry-run mode the classification is reported and no writes
//     happen. Default mode performs the writes for create+update.
//
// Usage:
//   node backend/scripts/import-skill-manifests.js [dir] [--dry-run]
//
// Exit codes:
//   0  — success (or dry-run completed cleanly)
//   1  — validation failure / duplicate conflict
//   2  — DB error during write phase

const fs   = require("node:fs");
const path = require("node:path");

const skillManifests = require("../services/skillManifests");

// Recognised by skill_runtime_manifests.status — kept in sync with
// services/skillManifests.js::setStatus.
const VALID_STATUSES = new Set(["internal", "curated", "public", "deprecated", "slashed"]);

const REQUIRED_FIELDS = ["skill_id", "version", "category", "prompt_fragment"];

/** Validate manifest shape. Throws Error with a human-readable message
 *  on the first issue found. Returns the normalised body that
 *  upsertManifest will accept (defaults filled in). Pure — exported
 *  for testing. */
function validateManifest(raw, sourcePath = "<unknown>") {
  const tag = `${sourcePath}: `;
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${tag}manifest must be a JSON object`);
  }
  for (const f of REQUIRED_FIELDS) {
    if (!(f in raw)) throw new Error(`${tag}missing required field "${f}"`);
  }
  if (!Number.isInteger(raw.skill_id) || raw.skill_id < 0) {
    throw new Error(`${tag}skill_id must be a non-negative integer`);
  }
  if (typeof raw.version !== "string" || raw.version.trim() === "") {
    throw new Error(`${tag}version must be a non-empty string`);
  }
  if (typeof raw.category !== "string" || raw.category.trim() === "") {
    throw new Error(`${tag}category must be a non-empty string`);
  }
  if (typeof raw.prompt_fragment !== "string") {
    throw new Error(`${tag}prompt_fragment must be a string`);
  }
  if (raw.vertical_tags !== undefined) {
    if (!Array.isArray(raw.vertical_tags) || raw.vertical_tags.some((t) => typeof t !== "string")) {
      throw new Error(`${tag}vertical_tags must be an array of strings`);
    }
  }
  if (raw.tool_manifest !== undefined && !Array.isArray(raw.tool_manifest)) {
    throw new Error(`${tag}tool_manifest must be an array`);
  }
  if (raw.required_connectors !== undefined) {
    if (!Array.isArray(raw.required_connectors) || raw.required_connectors.some((c) => typeof c !== "string")) {
      throw new Error(`${tag}required_connectors must be an array of strings`);
    }
  }
  if (raw.io_schema !== undefined) {
    if (raw.io_schema === null || typeof raw.io_schema !== "object" || Array.isArray(raw.io_schema)) {
      throw new Error(`${tag}io_schema must be an object`);
    }
  }
  if (raw.status !== undefined && !VALID_STATUSES.has(raw.status)) {
    throw new Error(`${tag}status "${raw.status}" not in {${[...VALID_STATUSES].join(", ")}}`);
  }
  return {
    skill_id:            raw.skill_id,
    version:             raw.version,
    category:            raw.category,
    vertical_tags:       raw.vertical_tags       || [],
    prompt_fragment:     raw.prompt_fragment,
    tool_manifest:       raw.tool_manifest       || [],
    required_connectors: raw.required_connectors || [],
    io_schema:           raw.io_schema           || {},
    status:              raw.status              || "internal",
  };
}

/** Detect duplicate (skill_id, version) entries within a batch. Returns
 *  an array of conflict descriptors; an empty array means clean.
 *  Pure — exported for testing. */
function findDuplicates(manifestsWithSource) {
  const byKey = new Map();
  const conflicts = [];
  for (const item of manifestsWithSource) {
    const key = `${item.manifest.skill_id}@${item.manifest.version}`;
    const prev = byKey.get(key);
    if (prev) {
      conflicts.push({ key, sources: [prev.source, item.source] });
    } else {
      byKey.set(key, item);
    }
  }
  return conflicts;
}

/** Decide whether a manifest needs a write vs the current DB row.
 *    no DB row              → "create"
 *    hash and status match  → "unchanged"
 *    otherwise              → "update"
 *  Pure — exported for testing. */
function classifyChange(newManifest, dbRow) {
  if (!dbRow) return "create";
  const newBody = {
    prompt_fragment:     newManifest.prompt_fragment,
    tool_manifest:       newManifest.tool_manifest,
    required_connectors: newManifest.required_connectors,
    io_schema:           newManifest.io_schema,
  };
  const newHash = skillManifests.computeManifestHash(newBody);
  if (newHash === dbRow.manifest_hash && newManifest.status === dbRow.status) {
    return "unchanged";
  }
  return "update";
}

/** Read every *.json file in dir and return validated manifests with
 *  their source paths. Throws on the first invalid file — partial
 *  imports of a bad batch are not allowed. */
function loadManifestsFromDir(dir) {
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error(`Not a directory: ${abs}`);
  }
  const files = fs.readdirSync(abs)
    .filter((f) => f.toLowerCase().endsWith(".json"))
    .sort();
  const out = [];
  for (const f of files) {
    const full = path.join(abs, f);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(full, "utf8"));
    } catch (e) {
      throw new Error(`${full}: invalid JSON — ${e.message}`);
    }
    out.push({ source: full, manifest: validateManifest(raw, full) });
  }
  return out;
}

function parseArgs(argv) {
  const args = { dir: null, dryRun: false, help: false };
  for (const a of argv) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (!args.dir && !a.startsWith("--")) args.dir = a;
  }
  return args;
}

const HELP = `Usage: node backend/scripts/import-skill-manifests.js [dir] [--dry-run]

  dir         Directory containing skill manifest JSON files
              (default: ./skill-manifests/)
  --dry-run   Validate and classify changes without writing to the DB
  -h, --help  Show this help and exit
`;

async function run({ dir, dryRun }, deps = {}) {
  const log = deps.log || console.log;
  const err = deps.err || console.error;
  const sm  = deps.skillManifests || skillManifests;

  const items = loadManifestsFromDir(dir);
  log(`Loaded ${items.length} manifest file(s) from ${path.resolve(dir)}`);

  const dups = findDuplicates(items);
  if (dups.length) {
    err(`Duplicate (skill_id, version) entries detected:`);
    for (const d of dups) err(`  ${d.key}: ${d.sources.join(", ")}`);
    return { exitCode: 1, summary: { duplicates: dups.length } };
  }

  // Classify everything before writing — gives a clean "what would
  // happen" report up front. Then writes happen in a second pass so a
  // mid-batch DB blip doesn't leave the caller guessing what landed.
  const planned = [];
  for (const { source, manifest } of items) {
    let dbRow;
    try {
      dbRow = await sm.getManifest(manifest.skill_id, manifest.version);
    } catch (e) {
      err(`DB read failed for ${manifest.skill_id}@${manifest.version}: ${e.message}`);
      return { exitCode: 2, summary: { dbError: e.message } };
    }
    planned.push({ source, manifest, action: classifyChange(manifest, dbRow) });
  }

  const counts = { create: 0, update: 0, unchanged: 0 };
  for (const p of planned) counts[p.action] += 1;
  log(`Plan: create=${counts.create}  update=${counts.update}  unchanged=${counts.unchanged}`);

  if (dryRun) {
    for (const p of planned) {
      log(`  [${p.action.padEnd(9)}] ${p.manifest.skill_id}@${p.manifest.version}  (${p.source})`);
    }
    log("Dry run — no writes performed.");
    return { exitCode: 0, summary: counts };
  }

  let written = 0;
  let failed = 0;
  for (const p of planned) {
    if (p.action === "unchanged") continue;
    try {
      const result = await sm.upsertManifest(p.manifest);
      written += 1;
      log(`  [${p.action.padEnd(9)}] ${p.manifest.skill_id}@${p.manifest.version}  → hash ${result.manifest_hash.slice(0, 12)}…`);
    } catch (e) {
      failed += 1;
      err(`  [FAILED]   ${p.manifest.skill_id}@${p.manifest.version}: ${e.message}`);
    }
  }
  log(`Wrote ${written} manifest(s); ${failed} failure(s); ${counts.unchanged} unchanged.`);
  return { exitCode: failed ? 2 : 0, summary: { ...counts, written, failed } };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }
  if (!args.dir) args.dir = "./skill-manifests";

  let result;
  try {
    result = await run(args);
  } catch (e) {
    console.error(`Fatal: ${e.message}`);
    process.exit(1);
  } finally {
    // Always release the pool so the script doesn't hang on exit.
    try { await require("../db/client").close(); } catch { /* ignore */ }
  }
  process.exit(result.exitCode);
}

if (require.main === module) {
  main();
}

module.exports = {
  validateManifest,
  findDuplicates,
  classifyChange,
  loadManifestsFromDir,
  parseArgs,
  run,
  VALID_STATUSES,
  REQUIRED_FIELDS,
};
