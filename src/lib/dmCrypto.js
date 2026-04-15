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
import nacl from "tweetnacl";
import util from "tweetnacl-util";

const KEY_PREFIX = "ironfeed:dm:sk:"; // + wallet

function lsKey(wallet) { return KEY_PREFIX + (wallet || "").toLowerCase(); }

export function getOrCreateKeypair(wallet) {
  if (!wallet || typeof window === "undefined") return null;
  const k = lsKey(wallet);
  const existing = localStorage.getItem(k);
  if (existing) {
    const secretKey = util.decodeBase64(existing);
    const publicKey = nacl.box.keyPair.fromSecretKey(secretKey).publicKey;
    return { publicKey, secretKey };
  }
  const kp = nacl.box.keyPair();
  localStorage.setItem(k, util.encodeBase64(kp.secretKey));
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

export function exportPublicKey(kp) {
  return kp ? util.encodeBase64(kp.publicKey) : null;
}

export function encrypt(plain, peerPublicKeyB64, myKp) {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const peerPub = util.decodeBase64(peerPublicKeyB64);
  const cipher = nacl.box(util.decodeUTF8(plain), nonce, peerPub, myKp.secretKey);
  return {
    encryptedPayload: util.encodeBase64(cipher),
    nonce: util.encodeBase64(nonce),
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
