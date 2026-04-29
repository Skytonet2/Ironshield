// backend/connectors/credentialStore.js
//
// AES-256-GCM-encrypted CRUD over the connector_credentials table
// (Phase 10 schema). Reuses CUSTODIAL_ENCRYPT_KEY — same key, same
// rotation procedure as backend/services/agents/connectionStore.js
// and backend/services/custodialBotWallet.js.
//
// Credentials are stored as a JSON payload (e.g. { access_token,
// refresh_token, expires_at, ... }) inside the encrypted blob. The
// connector_credentials.expires_at column mirrors the OAuth expiry
// in plaintext so the refresh worker can find them without
// decrypting every row.
//
// Plaintext secrets NEVER cross a public API boundary. `getDecrypted`
// is the only path that returns plaintext and runs server-side from
// inside a connector adapter.

const crypto = require("crypto");
const db = require("../db/client");

const ALGO = "aes-256-gcm";

function _key() {
  const hex = process.env.CUSTODIAL_ENCRYPT_KEY;
  if (!hex) throw new Error("CUSTODIAL_ENCRYPT_KEY not set — connector creds need encryption at rest");
  const buf = Buffer.from(hex, "hex");
  if (buf.length !== 32) {
    throw new Error(`CUSTODIAL_ENCRYPT_KEY must be 32 bytes hex (got ${buf.length})`);
  }
  return buf;
}

/** Encrypt a JSON-serialisable payload. Returns Buffer (BYTEA-friendly). */
function encrypt(payload) {
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, _key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]); // 12B IV + 16B tag + ciphertext
}

/** Decrypt a Buffer produced by encrypt(). Returns the original payload. */
function decrypt(blob) {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  const iv  = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, _key(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return JSON.parse(dec.toString("utf8"));
}

/**
 * Upsert a credential row. payload is encrypted before write.
 * expiresAt (Date | ISO string | null) is stored alongside in plaintext.
 */
async function upsert({ wallet, connector, payload, expiresAt = null }) {
  if (!wallet || !connector || !payload) {
    throw new Error("wallet, connector, payload required");
  }
  const blob = encrypt(payload);
  const exp = expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt;
  const { rows } = await db.query(
    `INSERT INTO connector_credentials (user_wallet, connector_name, encrypted_blob, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_wallet, connector_name)
       DO UPDATE SET encrypted_blob = EXCLUDED.encrypted_blob,
                     expires_at     = EXCLUDED.expires_at,
                     updated_at     = NOW()
       RETURNING id, user_wallet, connector_name, expires_at, created_at, updated_at`,
    [wallet, connector, blob, exp]
  );
  return rows[0];
}

async function getDecrypted({ wallet, connector }) {
  const { rows } = await db.query(
    `SELECT encrypted_blob, expires_at FROM connector_credentials
       WHERE user_wallet = $1 AND connector_name = $2 LIMIT 1`,
    [wallet, connector]
  );
  if (!rows.length) return null;
  return { payload: decrypt(rows[0].encrypted_blob), expiresAt: rows[0].expires_at };
}

async function listForWallet(wallet) {
  const { rows } = await db.query(
    `SELECT connector_name, expires_at, created_at, updated_at
       FROM connector_credentials WHERE user_wallet = $1
       ORDER BY connector_name`,
    [wallet]
  );
  return rows;
}

async function remove({ wallet, connector }) {
  const { rowCount } = await db.query(
    `DELETE FROM connector_credentials WHERE user_wallet = $1 AND connector_name = $2`,
    [wallet, connector]
  );
  return rowCount > 0;
}

/** Return rows whose expires_at is within the lookahead window.
 *
 *  `limit` caps the number of rows returned (default 50, max 500).
 *  Without it, a long backend downtime could surface hundreds of
 *  expired rows in one query — the connectorRefresh worker only
 *  processes MAX_PER_TICK=25 per tick anyway, so paging at the SQL
 *  layer keeps the wire traffic small. */
async function findExpiring({ withinMs = 5 * 60 * 1000, limit = 50 } = {}) {
  const { rows } = await db.query(
    `SELECT user_wallet, connector_name, expires_at FROM connector_credentials
       WHERE expires_at IS NOT NULL
         AND expires_at < NOW() + make_interval(secs => $1::numeric / 1000.0)
       ORDER BY expires_at ASC
       LIMIT $2`,
    [String(withinMs), Math.max(1, Math.min(500, limit))]
  );
  return rows;
}

module.exports = {
  encrypt, decrypt,
  upsert, getDecrypted, listForWallet, remove, findExpiring,
};
