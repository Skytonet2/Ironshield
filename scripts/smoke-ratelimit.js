#!/usr/bin/env node
// scripts/smoke-ratelimit.js — Day 2.3 verify
//
// Fires 25 signed POSTs at /api/research and confirms calls 21-25 return
// 429 with `code: rate-limited` (or `error: rate-limited` per the spec
// shape). Run against a deployed backend after each Day-2 deploy.
//
// Setup (one-time):
//   1. cd C:\Users\SKYTONET\ironshield\.claude\worktrees\intelligent-cerf-61cb60
//   2. Set env:
//        export BACKEND_URL=https://ironclaw-backend-preview.onrender.com
//        export NEAR_ACCOUNT_ID=alice.near
//        export NEAR_PRIVATE_KEY=ed25519:...     # full-access key
//   3. node scripts/smoke-ratelimit.js
//
// The script signs each call via NEP-413 using the same body-binding
// scheme the production middleware verifies (docs/auth-contract.md §2.3).

const crypto = require("node:crypto");
const path   = require("node:path");

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env.local"), override: true });

const BACKEND   = process.env.BACKEND_URL    || "http://localhost:3001";
const ACCOUNT   = process.env.NEAR_ACCOUNT_ID;
const PRIV_KEY  = process.env.NEAR_PRIVATE_KEY;
const RECIPIENT = "ironshield.near";
const TARGET    = "/api/research";
const N         = 25;

if (!ACCOUNT || !PRIV_KEY) {
  console.error("Missing NEAR_ACCOUNT_ID or NEAR_PRIVATE_KEY in env.");
  console.error("This smoke needs a real wallet because /api/research requires");
  console.error("signed-message auth. The unit tests in backend/__tests__/rateLimit.test.js");
  console.error("verify the same property in-process without a wallet.");
  process.exit(2);
}

const { KeyPair } = require("near-api-js");
const kp = KeyPair.fromString(PRIV_KEY);
const publicKey = kp.getPublicKey().toString();

// Hand-rolled NEP-413 borsh, same shape as backend/middleware/requireWallet.js.
function nep413Bytes({ message, nonce, recipient }) {
  const msg = Buffer.from(message, "utf8");
  const rec = Buffer.from(recipient, "utf8");
  const out = Buffer.alloc(4 + 4 + msg.length + 32 + 4 + rec.length + 1);
  let o = 0;
  out.writeUInt32LE(2_147_484_061, o); o += 4;
  out.writeUInt32LE(msg.length, o);    o += 4;
  msg.copy(out, o);                    o += msg.length;
  Buffer.from(nonce).copy(out, o);     o += 32;
  out.writeUInt32LE(rec.length, o);    o += 4;
  rec.copy(out, o);                    o += rec.length;
  out.writeUInt8(0, o);                // callbackUrl: None
  return out;
}

async function fetchNonce() {
  const r = await fetch(`${BACKEND}/api/auth/nonce`);
  if (!r.ok) throw new Error(`nonce fetch failed: ${r.status}`);
  return (await r.json()).nonce;
}

function buildMessage(method, p, rawBody) {
  const hash = crypto.createHash("sha256").update(rawBody || "").digest("hex");
  return `ironshield-auth:v1\n${method}\n${p}\n${hash}`;
}

function decodeBase64Url(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

async function fireOne(i) {
  const nonceB64 = await fetchNonce();
  const body     = JSON.stringify({ query: `smoke-${i}-${Date.now()}`, chain: "near" });
  const message  = buildMessage("POST", TARGET, body);
  const payload  = nep413Bytes({ message, nonce: decodeBase64Url(nonceB64), recipient: RECIPIENT });
  const digest   = crypto.createHash("sha256").update(payload).digest();
  const sig      = Buffer.from(kp.sign(new Uint8Array(digest)).signature).toString("base64");

  const r = await fetch(`${BACKEND}${TARGET}`, {
    method: "POST",
    headers: {
      "content-type":  "application/json",
      "x-wallet":      ACCOUNT,
      "x-public-key":  publicKey,
      "x-nonce":       nonceB64,
      "x-signature":   sig,
    },
    body,
  });
  let parsed = null;
  try { parsed = await r.json(); } catch {}
  return { status: r.status, code: parsed?.code, error: parsed?.error };
}

(async () => {
  console.log(`Firing ${N} signed POSTs at ${BACKEND}${TARGET} as ${ACCOUNT}…`);
  const results = [];
  for (let i = 1; i <= N; i++) {
    const out = await fireOne(i);
    results.push(out);
    process.stdout.write(`  ${i.toString().padStart(2)}: HTTP ${out.status}${out.error ? ` (${out.error})` : ""}\n`);
  }

  const expected = Array.from({ length: N }, (_, i) => i < 20 ? 200 : 429);
  let pass = true;
  results.forEach((r, i) => {
    if (r.status !== expected[i]) {
      pass = false;
      console.error(`FAIL: call ${i + 1} expected ${expected[i]}, got ${r.status}`);
    }
  });
  if (pass) console.log("\nPASS: first 20 succeed, calls 21-25 return 429.");
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error("Smoke crashed:", e); process.exit(1); });
