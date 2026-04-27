// src/lib/dmCrypto.js
// End-to-end encryption for IronFeed DMs using tweetnacl (Curve25519 + XSalsa20-Poly1305).
//
// Flow:
//  1. Each user has a Curve25519 keypair. The secret key lives in
//     localStorage (per-wallet). The public key is published to
//     feed_users.pubkey so others can encrypt to them.
//  2. Sender encrypts: nacl.box(msg, nonce, recipientPub, mySecret) -> cipher
//  3. Recipient decrypts: nacl.box.open(cipher, nonce, senderPub, mySecret)
//
// Nonce is 24 random bytes generated per message. Cipher + nonce are the only
// things the server ever sees.
//
// Day 8.3 — key history. Past keypairs are kept in localStorage so we can
// still decrypt messages that were encrypted to a now-rotated public key.
// Each keypair carries a short fingerprint (BLAKE2b prefix of the raw
// public key); ciphertext rows also carry sender_key_fp + recipient_key_fp
// so the recipient can pick the right secret. Legacy single-key entries
// from before 8.3 migrate forward on first read.
import nacl from "tweetnacl";
import util from "tweetnacl-util";

const LEGACY_PREFIX = "ironfeed:dm:sk:";    // pre-8.3: single base64 secret per wallet
const KEYS_PREFIX = "ironfeed:dm:keys:";    // 8.3+: JSON history

function legacyKey(wallet) { return LEGACY_PREFIX + (wallet || "").toLowerCase(); }
function historyKey(wallet) { return KEYS_PREFIX + (wallet || "").toLowerCase(); }

// 16-hex-char prefix of BLAKE2b(public-key raw bytes). nacl.hash returns
// a Uint8Array; the prefix is enough to distinguish the handful of keys
// a single wallet ever holds without bloating every row.
export function fingerprint(pubkey) {
  if (!pubkey) return null;
  const raw = pubkey instanceof Uint8Array ? pubkey : util.decodeBase64(pubkey);
  const h = nacl.hash(raw);
  let out = "";
  for (let i = 0; i < 8; i++) out += h[i].toString(16).padStart(2, "0");
  return out;
}

function readHistory(wallet) {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(historyKey(wallet));
    if (raw) {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    }
  } catch { /* corrupt JSON — treat as empty, will be rewritten on first save */ }
  // Migrate the pre-8.3 single-key entry on first read. The old entry
  // is left in place so an older client build can still find it if the
  // user rolls back; cleanup happens once the new flow is verified.
  const legacy = localStorage.getItem(legacyKey(wallet));
  if (legacy) {
    try {
      const sk = util.decodeBase64(legacy);
      const pk = nacl.box.keyPair.fromSecretKey(sk).publicKey;
      const entry = {
        fp: fingerprint(pk),
        sk: util.encodeBase64(sk),
        pk: util.encodeBase64(pk),
        createdAt: Date.now(),
        legacy: true,
      };
      writeHistory(wallet, [entry]);
      return [entry];
    } catch { /* malformed legacy key — ignore, we'll mint fresh */ }
  }
  return [];
}

function writeHistory(wallet, entries) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(historyKey(wallet), JSON.stringify(entries)); }
  catch { /* quota — drop silently, next session will regenerate */ }
}

function entryToKp(entry) {
  if (!entry) return null;
  const secretKey = util.decodeBase64(entry.sk);
  const publicKey = util.decodeBase64(entry.pk);
  return { publicKey, secretKey, fp: entry.fp };
}

export function getOrCreateKeypair(wallet) {
  if (!wallet || typeof window === "undefined") return null;
  const hist = readHistory(wallet);
  if (hist.length) return entryToKp(hist[hist.length - 1]);
  // No history and no legacy key — mint fresh.
  const kp = nacl.box.keyPair();
  const entry = {
    fp: fingerprint(kp.publicKey),
    sk: util.encodeBase64(kp.secretKey),
    pk: util.encodeBase64(kp.publicKey),
    createdAt: Date.now(),
  };
  writeHistory(wallet, [entry]);
  return { publicKey: kp.publicKey, secretKey: kp.secretKey, fp: entry.fp };
}

// Look up a keypair from history by fingerprint. Returns null if not
// found — caller renders the "encrypted with rotated key" placeholder.
export function getKeypairByFp(wallet, fp) {
  if (!wallet || !fp || typeof window === "undefined") return null;
  const hist = readHistory(wallet);
  const entry = hist.find((e) => e.fp === fp);
  return entry ? entryToKp(entry) : null;
}

// Read the key-rotation history for the /settings UI. Returns an
// array of { fp, pk, createdAt, legacy? } entries ordered oldest →
// newest; the last entry is the current key. Secrets are intentionally
// stripped from the return value — settings should never need them
// in component state.
export function getKeyHistory(wallet) {
  if (!wallet || typeof window === "undefined") return [];
  return readHistory(wallet).map((e) => ({
    fp: e.fp,
    pk: e.pk,
    createdAt: e.createdAt,
    legacy: !!e.legacy,
  }));
}

// v1.1.5 — symmetric per-attachment encryption for DM media.
//
// Image bytes used to upload in plaintext (Day 8.4) and the URL was
// the only thing encrypted in the message body. Now the SENDER
// generates a fresh 32-byte symmetric key + 24-byte nonce, runs
// nacl.secretbox over the file bytes, and uploads the ciphertext to
// the media host. The symmetric key gets embedded in the encrypted
// message body alongside the URL, so only the recipient (who
// already has the wallet's dmCrypto secret) can derive the symmetric
// key, fetch the ciphertext, and decrypt the bytes.
//
// Receiver recombines via decryptAttachmentBytes(ciphertext, key,
// nonce) and renders the resulting Blob.
export function generateAttachmentKey() {
  const key   = nacl.randomBytes(nacl.secretbox.keyLength);   // 32 bytes
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength); // 24 bytes
  return { key, nonce };
}

/** Encrypt a Uint8Array of file bytes. Returns Uint8Array ciphertext. */
export function encryptAttachmentBytes(plainBytes, key, nonce) {
  return nacl.secretbox(plainBytes, nonce, key);
}

/** Decrypt ciphertext bytes back to plain bytes. Returns null on failure. */
export function decryptAttachmentBytes(cipherBytes, keyB64, nonceB64) {
  try {
    const key   = util.decodeBase64(keyB64);
    const nonce = util.decodeBase64(nonceB64);
    const plain = nacl.secretbox.open(cipherBytes, nonce, key);
    return plain || null;
  } catch { return null; }
}

export function attachmentKeyToBase64(key)     { return util.encodeBase64(key); }
export function attachmentNonceToBase64(nonce) { return util.encodeBase64(nonce); }

// v1.1.1 — group-chat E2E helpers (sender-keys flavor).
//
// Each E2E group has a 32-byte symmetric key. The owner mints it on
// group creation and wraps a copy to each member by nacl.box-encrypting
// the key bytes to that member's published dm_pubkey. Members fetch
// their wrap from the server on first read of the group, unwrap with
// their dmCrypto secret + the wrappedByPubkey, and cache the resulting
// symmetric key keyed by (wallet, group_id).
//
// Send: nacl.secretbox(content, nonce, group_key). Receive: same key
// recovers the plaintext.
//
// Cache lives in localStorage under "ironfeed:dm:group-keys:<wallet>"
// so the user doesn't re-fetch the wrap on every page reload. Key
// rotation is out-of-scope for v1.1 — adding a new member means the
// owner re-distributes the existing key to that one member, which
// implies new members can read all prior group history. Documented
// in docs/dm-crypto-review.md.

const GROUP_KEYS_PREFIX = "ironfeed:dm:group-keys:"; // + wallet

function groupKeysKey(wallet) { return GROUP_KEYS_PREFIX + (wallet || "").toLowerCase(); }

function readGroupKeys(wallet) {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(groupKeysKey(wallet));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function writeGroupKeys(wallet, obj) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(groupKeysKey(wallet), JSON.stringify(obj)); } catch {}
}

/** Cache a freshly-unwrapped group key. */
export function cacheGroupKey(wallet, groupId, keyB64) {
  if (!wallet || groupId == null || !keyB64) return;
  const obj = readGroupKeys(wallet);
  obj[String(groupId)] = keyB64;
  writeGroupKeys(wallet, obj);
}

/** Look up a cached group key. Returns base64 string or null. */
export function getCachedGroupKey(wallet, groupId) {
  if (!wallet || groupId == null) return null;
  const obj = readGroupKeys(wallet);
  return obj[String(groupId)] || null;
}

/** Unwrap a wrapped group key with the caller's dmCrypto secret.
 *  `wrappedByPubkey` was the owner's dm_pubkey at wrap time — the
 *  recipient does nacl.box.open(wrappedKey, wrapNonce, wrappedByPubkey,
 *  myDmSecret) to recover the symmetric key bytes. Returns base64
 *  string or null on failure. */
export function unwrapGroupKey(myKp, wrappedKeyB64, wrapNonceB64, wrappedByPubkeyB64) {
  try {
    const wk = util.decodeBase64(wrappedKeyB64);
    const wn = util.decodeBase64(wrapNonceB64);
    const ownerPub = util.decodeBase64(wrappedByPubkeyB64);
    const sym = nacl.box.open(wk, wn, ownerPub, myKp.secretKey);
    if (!sym) return null;
    return util.encodeBase64(sym);
  } catch { return null; }
}

/** Encrypt a group message body with the cached symmetric key.
 *  Returns { encryptedContent, nonce, senderKeyFp } in base64. */
export function encryptGroup(plain, groupKeyB64, myKp) {
  const groupKey = util.decodeBase64(groupKeyB64);
  const nonce    = nacl.randomBytes(nacl.secretbox.nonceLength);
  const cipher   = nacl.secretbox(util.decodeUTF8(plain), nonce, groupKey);
  return {
    encryptedContent: util.encodeBase64(cipher),
    nonce:            util.encodeBase64(nonce),
    senderKeyFp:      myKp?.fp || (myKp ? fingerprint(myKp.publicKey) : null),
  };
}

/** Decrypt a group ciphertext with the cached symmetric key. Returns
 *  the plaintext string or null. */
export function decryptGroup(encryptedContentB64, nonceB64, groupKeyB64) {
  try {
    const groupKey = util.decodeBase64(groupKeyB64);
    const nonce    = util.decodeBase64(nonceB64);
    const cipher   = util.decodeBase64(encryptedContentB64);
    const plain    = nacl.secretbox.open(cipher, nonce, groupKey);
    return plain ? util.encodeUTF8(plain) : null;
  } catch { return null; }
}

/** Owner-side: mint a fresh group symmetric key, base64 of 32 bytes.
 *  Does NOT cache it — caller is responsible for caching after
 *  successful distribution. */
export function generateGroupKey() {
  return util.encodeBase64(nacl.randomBytes(nacl.secretbox.keyLength));
}

/** Owner-side: wrap a symmetric group key to a single member's
 *  dm_pubkey. Used during group creation (one wrap per member) and
 *  later when a new member joins (one wrap for that member). */
export function wrapGroupKey(groupKeyB64, memberDmPubkeyB64, ownerKp) {
  try {
    const groupKey = util.decodeBase64(groupKeyB64);
    const memberPub = util.decodeBase64(memberDmPubkeyB64);
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const wrapped = nacl.box(groupKey, nonce, memberPub, ownerKp.secretKey);
    return {
      wrappedKey:  util.encodeBase64(wrapped),
      wrapNonce:   util.encodeBase64(nonce),
      wrappedByPubkey: util.encodeBase64(ownerKp.publicKey),
    };
  } catch { return null; }
}

// Force a new keypair into history. Used by /settings (Day 18+) and by
// tests to verify the rotation path. The previous current key stays in
// history so old messages remain readable.
export function rotateKeypair(wallet) {
  if (!wallet || typeof window === "undefined") return null;
  const hist = readHistory(wallet);
  const kp = nacl.box.keyPair();
  const entry = {
    fp: fingerprint(kp.publicKey),
    sk: util.encodeBase64(kp.secretKey),
    pk: util.encodeBase64(kp.publicKey),
    createdAt: Date.now(),
  };
  writeHistory(wallet, [...hist, entry]);
  return { publicKey: kp.publicKey, secretKey: kp.secretKey, fp: entry.fp };
}

export function exportPublicKey(kp) {
  return kp ? util.encodeBase64(kp.publicKey) : null;
}

// Current ciphertext envelope version. Bumped when the wire format
// changes in a way decryptors must branch on. Backend stores it on
// feed_dms.format_version; legacy rows default to 0 (Day 8.x bytes
// without fingerprints) and decrypt via the same path because v0 +
// v1 share the underlying nacl.box body — the column just exists so
// future versions can branch without another schema migration.
export const FORMAT_VERSION = 1;

// Returns ciphertext + nonce + both fingerprints + version so the
// recipient can pick the right secret half from their key history
// AND the storage layer can future-proof the envelope shape.
export function encrypt(plain, peerPublicKeyB64, myKp) {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const peerPub = util.decodeBase64(peerPublicKeyB64);
  const cipher = nacl.box(util.decodeUTF8(plain), nonce, peerPub, myKp.secretKey);
  return {
    encryptedPayload: util.encodeBase64(cipher),
    nonce: util.encodeBase64(nonce),
    senderKeyFp: myKp.fp || fingerprint(myKp.publicKey),
    recipientKeyFp: fingerprint(peerPub),
    formatVersion: FORMAT_VERSION,
  };
}

export function decrypt(payload, nonceB64, peerPublicKeyB64, myKp) {
  try {
    const cipher = util.decodeBase64(payload);
    const nonce = util.decodeBase64(nonceB64);
    const peerPub = util.decodeBase64(peerPublicKeyB64);
    const msg = nacl.box.open(cipher, nonce, peerPub, myKp.secretKey);
    if (!msg) return null;
    return util.encodeUTF8(msg);
  } catch { return null; }
}
