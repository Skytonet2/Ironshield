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

// Returns ciphertext + nonce + both fingerprints so the recipient can
// pick the right secret half from their key history.
export function encrypt(plain, peerPublicKeyB64, myKp) {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const peerPub = util.decodeBase64(peerPublicKeyB64);
  const cipher = nacl.box(util.decodeUTF8(plain), nonce, peerPub, myKp.secretKey);
  return {
    encryptedPayload: util.encodeBase64(cipher),
    nonce: util.encodeBase64(nonce),
    senderKeyFp: myKp.fp || fingerprint(myKp.publicKey),
    recipientKeyFp: fingerprint(peerPub),
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
