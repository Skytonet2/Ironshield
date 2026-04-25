// backend/services/agents/connectionStore.js
//
// Agent-connection persistence. Reuses the AES-256-GCM scheme already
// in use for custodial bot keys (CUSTODIAL_ENCRYPT_KEY in .env.local)
// so we don't proliferate key material — same operational discipline,
// same rotation procedure.
//
// All public functions take a plain object and never expose the
// decrypted secret to callers that don't ask for it explicitly.
// `getDecryptedAuth` is the only path that returns plaintext, and it
// only runs server-side from inside an adapter.

const crypto = require("crypto");
const db = require("../../db/client");

const ALGO = "aes-256-gcm";

function getKey() {
  const hex = process.env.CUSTODIAL_ENCRYPT_KEY;
  if (!hex) throw new Error("CUSTODIAL_ENCRYPT_KEY not set — agent connections need encryption at rest");
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) throw new Error(`CUSTODIAL_ENCRYPT_KEY must be 32 bytes hex (got ${buf.length})`);
  return buf;
}

function encrypt(plaintext) {
  if (!plaintext) return null;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decrypt(blob) {
  if (!blob) return null;
  const key = getKey();
  const raw = Buffer.from(blob, "base64");
  const iv  = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

const KNOWN_FRAMEWORKS = new Set(["openclaw", "ironclaw", "self_hosted"]);

/** Sanitise + return the row a public API can safely surface. */
function publicRow(row) {
  if (!row) return null;
  const { auth_encrypted, ...rest } = row;
  return {
    ...rest,
    has_auth: Boolean(auth_encrypted),
  };
}

/**
 * Upsert a connection row. Accepts a plaintext `auth` value which is
 * encrypted before being persisted. Pass `auth: null` to keep the
 * existing encrypted blob untouched (useful for status-only updates).
 */
async function upsert({
  owner, agent_account, framework, external_id, endpoint, auth, status, meta,
}) {
  if (!owner || !agent_account || !framework) {
    throw new Error("owner, agent_account, framework are required");
  }
  if (!KNOWN_FRAMEWORKS.has(framework)) {
    throw new Error(`Unknown framework: ${framework}`);
  }
  const cols = ["owner", "agent_account", "framework", "updated_at"];
  const vals = [owner, agent_account, framework, "NOW()"];
  const place = ["$1", "$2", "$3", "NOW()"];
  const params = [owner, agent_account, framework];

  let i = params.length;
  const push = (col, val) => {
    cols.push(col);
    place.push(val === "NOW()" ? "NOW()" : `$${++i}`);
    if (val !== "NOW()") params.push(val);
  };

  if (external_id !== undefined) push("external_id", external_id);
  if (endpoint    !== undefined) push("endpoint",    endpoint);
  if (auth        !== undefined && auth !== null) push("auth_encrypted", encrypt(auth));
  if (status      !== undefined) push("status",      status);
  if (meta        !== undefined) push("meta",        JSON.stringify(meta || {}));

  // ON CONFLICT update — same logic, but skip auth_encrypted if caller
  // didn't provide a fresh value (auth === undefined).
  const updateSet = cols
    .filter((c) => c !== "owner" && c !== "agent_account" && c !== "framework")
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(", ");

  const sql = `
    INSERT INTO agent_connections (${cols.join(", ")})
    VALUES (${place.join(", ")})
    ON CONFLICT (owner, agent_account, framework)
    DO UPDATE SET ${updateSet}
    RETURNING *;
  `;
  const { rows } = await db.query(sql, params);
  return publicRow(rows[0]);
}

async function listForOwner(owner) {
  const { rows } = await db.query(
    `SELECT * FROM agent_connections WHERE owner = $1 ORDER BY created_at DESC`,
    [owner]
  );
  return rows.map(publicRow);
}

async function listForAccount(agent_account) {
  const { rows } = await db.query(
    `SELECT * FROM agent_connections WHERE agent_account = $1 ORDER BY created_at DESC`,
    [agent_account]
  );
  return rows.map(publicRow);
}

async function getOne({ owner, agent_account, framework }) {
  const { rows } = await db.query(
    `SELECT * FROM agent_connections
       WHERE owner = $1 AND agent_account = $2 AND framework = $3 LIMIT 1`,
    [owner, agent_account, framework]
  );
  return publicRow(rows[0] || null);
}

/** Server-side only — never return this from an HTTP handler. */
async function getDecryptedAuth({ owner, agent_account, framework }) {
  const { rows } = await db.query(
    `SELECT auth_encrypted FROM agent_connections
       WHERE owner = $1 AND agent_account = $2 AND framework = $3 LIMIT 1`,
    [owner, agent_account, framework]
  );
  if (!rows[0]?.auth_encrypted) return null;
  return decrypt(rows[0].auth_encrypted);
}

async function markSeen({ owner, agent_account, framework, status = "active" }) {
  await db.query(
    `UPDATE agent_connections
        SET last_seen = NOW(), status = $4, updated_at = NOW()
      WHERE owner = $1 AND agent_account = $2 AND framework = $3`,
    [owner, agent_account, framework, status]
  );
}

async function remove({ owner, agent_account, framework }) {
  const { rowCount } = await db.query(
    `DELETE FROM agent_connections
        WHERE owner = $1 AND agent_account = $2 AND framework = $3`,
    [owner, agent_account, framework]
  );
  return rowCount > 0;
}

module.exports = {
  encrypt, decrypt,
  upsert, listForOwner, listForAccount, getOne, getDecryptedAuth, markSeen, remove,
  KNOWN_FRAMEWORKS,
};
