// backend/services/custodialBotWallet.js
//
// Per-TG-user custodial trading account.
//
// Why custodial at all: the TG bot needs to sign /swap and /send
// transactions without a per-tx wallet popup. Two options:
//   A) full custodial — we hold the key (this file)
//   B) scoped function-call access key — user adds a bot-owned key
//      to their main NEAR account with restricted permissions
//
// We went with (A) but scoped to a fresh IMPLICIT account per user,
// not the user's main wallet. User deposits what they're willing to
// trade with; the rest of their funds stay safe on wallets we never
// touch. This matches the BONKBot / Maestro / Banana Gun model that
// everyone already understands.
//
// Key material:
//   - ed25519 keypair generated with near-api-js KeyPair.fromRandom
//   - Private key encrypted at rest with AES-256-GCM keyed on
//     process.env.CUSTODIAL_ENCRYPT_KEY (32-byte hex, generated
//     once and kept OUT of git — stored in /secrets/platform-
//     wallets.json alongside the platform fee-wallet keys).
//   - Implicit account id = hex(publicKey.bytes) — free to create,
//     materializes on first deposit, globally unique by definition.
//
// Rotation: to rotate a compromised CUSTODIAL_ENCRYPT_KEY, decrypt
// all feed_tg_links rows with the old key, re-encrypt with the new,
// UPDATE the rows in a single transaction. Not automated; if it
// happens you'll write a one-off script.

const crypto = require("crypto");
const db = require("../db/client");

const ALGO = "aes-256-gcm";
const KEY_HEX = process.env.CUSTODIAL_ENCRYPT_KEY || "";

function getKey() {
  if (!KEY_HEX) {
    throw new Error(
      "CUSTODIAL_ENCRYPT_KEY not set — run `openssl rand -hex 32` and put it " +
      "in .env.local plus /secrets/platform-wallets.json."
    );
  }
  const buf = Buffer.from(KEY_HEX, "hex");
  if (buf.length !== 32) {
    throw new Error(`CUSTODIAL_ENCRYPT_KEY must be 32 bytes hex (got ${buf.length})`);
  }
  return buf;
}

/** Encrypt a private-key string into a compact base64 blob. */
function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12);             // 96-bit nonce per GCM best-practice
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Layout: iv(12) || tag(16) || ciphertext. Base64-encoded for
  // compact TEXT-column storage.
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decrypt(blob) {
  const key = getKey();
  const raw = Buffer.from(blob, "base64");
  const iv  = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

/**
 * Get-or-create the custodial NEAR account for a TG user.
 * Returns { accountId, publicKey }. Key material is never returned
 * from this function — use `loadKeyPairFor` when you need to sign.
 */
async function getOrCreateForTgId(tgId) {
  if (!tgId) throw new Error("tgId required");
  const existing = await db.query(
    "SELECT bot_account_id, bot_public_key FROM feed_tg_links WHERE tg_id = $1",
    [tgId]
  );
  if (existing.rows[0]?.bot_account_id) {
    return {
      accountId: existing.rows[0].bot_account_id,
      publicKey: existing.rows[0].bot_public_key,
      existing: true,
    };
  }

  // Generate a fresh ed25519 keypair. KeyPair.toString() returns
  // "ed25519:<base58>" which is the canonical NEAR key format.
  const { KeyPair } = require("near-api-js");
  const kp = KeyPair.fromRandom("ed25519");
  const pk = kp.getPublicKey();
  const accountId = Buffer.from(pk.data).toString("hex");  // 64-char hex implicit ID
  const pkStr = pk.toString();
  const skStr = kp.toString();
  const encrypted = encrypt(skStr);

  // INSERT-with-fallback-UPDATE so direct custodial endpoints work
  // before /start has been run (e.g. an ops admin probing the API).
  // When /start runs normally, the UPDATE branch hits.
  const ins = await db.query(
    `INSERT INTO feed_tg_links (tg_id, tg_chat_id, bot_account_id, bot_public_key, bot_key_encrypted, bot_created_at)
       VALUES ($1, $1, $2, $3, $4, NOW())
     ON CONFLICT (tg_id) DO UPDATE
        SET bot_account_id    = EXCLUDED.bot_account_id,
            bot_public_key    = EXCLUDED.bot_public_key,
            bot_key_encrypted = EXCLUDED.bot_key_encrypted,
            bot_created_at    = COALESCE(feed_tg_links.bot_created_at, EXCLUDED.bot_created_at)
      WHERE feed_tg_links.bot_account_id IS NULL
      RETURNING bot_account_id, bot_public_key`,
    [tgId, accountId, pkStr, encrypted]
  );

  // If RETURNING came back empty, another transaction provisioned
  // between our SELECT and our INSERT. Re-read and return the winner
  // so we never hand out a second key that was never persisted.
  if (!ins.rows[0]) {
    const raced = await db.query(
      "SELECT bot_account_id, bot_public_key FROM feed_tg_links WHERE tg_id = $1",
      [tgId]
    );
    if (raced.rows[0]?.bot_account_id) {
      return {
        accountId: raced.rows[0].bot_account_id,
        publicKey: raced.rows[0].bot_public_key,
        existing: true,
      };
    }
  }
  return { accountId, publicKey: pkStr, existing: false };
}

/**
 * Decrypt and return the KeyPair for a TG user's custodial wallet.
 * Throws if the user has no bot account (caller should provision
 * via getOrCreateForTgId first).
 *
 * Caller: keep the returned KeyPair in local scope and let it fall
 * out of references after signing. Don't cache or export.
 */
async function loadKeyPairFor(tgId) {
  const r = await db.query(
    "SELECT bot_account_id, bot_key_encrypted FROM feed_tg_links WHERE tg_id = $1",
    [tgId]
  );
  const row = r.rows[0];
  if (!row?.bot_account_id || !row.bot_key_encrypted) {
    throw new Error("No custodial wallet for this user — /start first.");
  }
  const sk = decrypt(row.bot_key_encrypted);
  const { KeyPair } = require("near-api-js");
  return { accountId: row.bot_account_id, keyPair: KeyPair.fromString(sk) };
}

module.exports = {
  encrypt,
  decrypt,
  getOrCreateForTgId,
  loadKeyPairFor,
};
