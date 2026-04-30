// backend/services/skillManifests.js
//
// Thin DB wrapper around skill_runtime_manifests. Existing in-process
// skill execution lives at backend/services/skills/index.js (REGISTRY of
// builtin: prefixed modules). This file is the **persistent metadata**
// layer added in Phase 10 — prompt fragments, IO schemas, connector
// requirements, and a content hash that Phase 5 will pin on-chain.
//
// At v1 every row is status='internal' or 'curated'. Public submission
// (status='public') is gated until Phase 5; the schema accepts the value
// today so we don't need a migration when the gate flips.

const crypto = require("node:crypto");
const db = require("../db/client");

/** Compute a deterministic SHA-256 of the manifest body. The contract
 *  will pin the same hash via Phase 5's set_skill_manifest_hash; for
 *  now it's just an integrity check we surface on read. */
function computeManifestHash(body) {
  const stable = JSON.stringify(body, Object.keys(body).sort());
  return crypto.createHash("sha256").update(stable).digest("hex");
}

/** Insert a new manifest version. Called by curators / AZUKA team
 *  when shipping a new skill or bumping an existing one. The on-chain
 *  Skill row must already exist — manifests are an off-chain attachment. */
async function upsertManifest({
  skill_id,
  version,
  category,
  vertical_tags = [],
  prompt_fragment,
  tool_manifest = [],
  required_connectors = [],
  io_schema = {},
  status = "internal",
  // Tier 5 slice 1 added these as nullable mirrors of on-chain skill
  // metadata so FTS / catalog queries don't need RPC fan-out. Either
  // pass them at upsert time (preferred) or backfill via
  // setNameAndDescription() / scripts/backfill-skill-names.js.
  name = null,
  description = null,
}) {
  if (!skill_id || !Number.isInteger(Number(skill_id))) {
    throw new Error("skill_id (integer) required");
  }
  if (!version) throw new Error("version required");
  if (!category) throw new Error("category required");
  if (typeof prompt_fragment !== "string") throw new Error("prompt_fragment must be a string");

  const body = { prompt_fragment, tool_manifest, required_connectors, io_schema };
  const manifest_hash = computeManifestHash(body);

  const sql = `
    INSERT INTO skill_runtime_manifests
      (skill_id, version, category, vertical_tags, prompt_fragment,
       tool_manifest_json, required_connectors, io_schema_json,
       manifest_hash, status, name, description, deployed_at)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9, $10, $11, $12, NOW())
    ON CONFLICT (skill_id, version) DO UPDATE
      SET category = EXCLUDED.category,
          vertical_tags = EXCLUDED.vertical_tags,
          prompt_fragment = EXCLUDED.prompt_fragment,
          tool_manifest_json = EXCLUDED.tool_manifest_json,
          required_connectors = EXCLUDED.required_connectors,
          io_schema_json = EXCLUDED.io_schema_json,
          manifest_hash = EXCLUDED.manifest_hash,
          status = EXCLUDED.status,
          -- Don't clobber a populated name/description with a NULL
          -- upsert from a caller that doesn't know the metadata yet.
          name = COALESCE(EXCLUDED.name, skill_runtime_manifests.name),
          description = COALESCE(EXCLUDED.description, skill_runtime_manifests.description),
          deployed_at = NOW()
    RETURNING id, manifest_hash, deployed_at`;

  const { rows } = await db.query(sql, [
    skill_id,
    version,
    category,
    vertical_tags,
    prompt_fragment,
    JSON.stringify(tool_manifest),
    required_connectors,
    JSON.stringify(io_schema),
    manifest_hash,
    status,
    name,
    description,
  ]);
  return rows[0];
}

/** Backfill / repair the on-chain metadata mirror for a single
 *  (skill_id, version) row. Used by scripts/backfill-skill-names.js
 *  and the admin "Refresh names" action. Idempotent. */
async function setNameAndDescription(skill_id, version, { name, description }) {
  const sql = `
    UPDATE skill_runtime_manifests
       SET name = $3,
           description = $4
     WHERE skill_id = $1 AND version = $2
     RETURNING id, name, description`;
  const { rows } = await db.query(sql, [skill_id, version, name ?? null, description ?? null]);
  return rows[0] || null;
}

/** Set the moderation lifecycle_status (admin slice 3). Distinct from
 *  the runtime `status` column — see project_skill_status_columns
 *  memory entry. Don't conflate the two. Runtime never reads
 *  lifecycle_status; admin paths only write lifecycle_status (with the
 *  one exception of the "pin" action, which writes runtime status). */
async function setLifecycleStatus(skill_id, version, lifecycle_status) {
  if (!["internal", "curated", "public", "deprecated", "slashed"].includes(lifecycle_status)) {
    throw new Error(`Invalid lifecycle_status: ${lifecycle_status}`);
  }
  const sql = `
    UPDATE skill_runtime_manifests
       SET lifecycle_status = $3
     WHERE skill_id = $1 AND version = $2
     RETURNING id, lifecycle_status`;
  const { rows } = await db.query(sql, [skill_id, version, lifecycle_status]);
  return rows[0] || null;
}

/** Mark one (skill_id, version) row as the runtime-active version,
 *  demoting all other versions of the same skill to status='inactive'.
 *  This is the only admin path that touches the runtime status column;
 *  it's exactly that column's purpose. Runs in a single transaction so
 *  there's never a window where zero versions are active. */
async function pinVersion(skill_id, version) {
  return db.transaction(async (client) => {
    const exists = await client.query(
      `SELECT id FROM skill_runtime_manifests WHERE skill_id = $1 AND version = $2`,
      [skill_id, version],
    );
    if (exists.rows.length === 0) return null;
    // Demote every other version to inactive first, then promote the
    // chosen one. Doing it in this order means a concurrent reader of
    // "active version" might briefly see zero rows; the transaction
    // wrapper hides that from anyone except a dirty read.
    await client.query(
      `UPDATE skill_runtime_manifests
          SET status = 'inactive'
        WHERE skill_id = $1 AND version <> $2 AND status = 'active'`,
      [skill_id, version],
    );
    const r = await client.query(
      `UPDATE skill_runtime_manifests
          SET status = 'active'
        WHERE skill_id = $1 AND version = $2
        RETURNING id, version, status`,
      [skill_id, version],
    );
    return r.rows[0];
  });
}

/** Returns the active manifest for a skill_id, or null. */
async function getActiveManifest(skill_id) {
  const sql = `
    SELECT id, skill_id, version, category, vertical_tags, prompt_fragment,
           tool_manifest_json AS tool_manifest,
           required_connectors,
           io_schema_json AS io_schema,
           manifest_hash, status, deployed_at
      FROM skill_runtime_manifests
     WHERE skill_id = $1 AND status = 'active'
     ORDER BY deployed_at DESC
     LIMIT 1`;
  const { rows } = await db.query(sql, [skill_id]);
  return rows[0] || null;
}

async function getManifest(skill_id, version) {
  const sql = `
    SELECT id, skill_id, version, category, vertical_tags, prompt_fragment,
           tool_manifest_json AS tool_manifest,
           required_connectors,
           io_schema_json AS io_schema,
           manifest_hash, status, deployed_at
      FROM skill_runtime_manifests
     WHERE skill_id = $1 AND version = $2`;
  const { rows } = await db.query(sql, [skill_id, version]);
  return rows[0] || null;
}

async function listManifests({ status = null, category = null, limit = 100 } = {}) {
  const clauses = [];
  const params = [];
  if (status) { params.push(status); clauses.push(`status = $${params.length}`); }
  if (category) { params.push(category); clauses.push(`category = $${params.length}`); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  params.push(Math.min(limit, 500));
  const sql = `
    SELECT id, skill_id, version, category, vertical_tags, manifest_hash,
           status, deployed_at
      FROM skill_runtime_manifests
      ${where}
     ORDER BY deployed_at DESC
     LIMIT $${params.length}`;
  const { rows } = await db.query(sql, params);
  return rows;
}

async function setStatus(skill_id, version, status) {
  if (!["internal", "curated", "public", "deprecated", "slashed"].includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }
  const sql = `
    UPDATE skill_runtime_manifests
       SET status = $3
     WHERE skill_id = $1 AND version = $2
     RETURNING id`;
  const { rows } = await db.query(sql, [skill_id, version, status]);
  return rows[0] || null;
}

module.exports = {
  computeManifestHash,
  upsertManifest,
  getActiveManifest,
  getManifest,
  listManifests,
  setStatus,
  setLifecycleStatus,
  setNameAndDescription,
  pinVersion,
};
