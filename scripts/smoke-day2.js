#!/usr/bin/env node
// scripts/smoke-day2.js — Day 2.5 verify
//
// Exercises the five attack vectors Day 2 hardens against and reports
// pass/fail. Designed to run against a deployed backend (Render preview
// or production) after each Day-2 deploy.
//
// Setup:
//   export BACKEND_URL=https://ironclaw-backend-preview.onrender.com
//   # Optional — needed for vectors 2 and 5:
//   export NEAR_ACCOUNT_ID=alice.near
//   export NEAR_PRIVATE_KEY=ed25519:...
//   node scripts/smoke-day2.js
//
// Vectors:
//   1. Unsigned POST → 401 missing-sig                  (no wallet needed)
//   2. Replayed signed POST → 401 replay                (wallet needed)
//   3. Oversized body (1MB) on /api/posts → 413         (no wallet needed)
//   4. CORS preflight from evil.example → no ACAO       (no wallet needed)
//   5. 25 signed /api/research calls → 429 on 21-25     (wallet needed)

const crypto = require("node:crypto");
const path   = require("node:path");

require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env.local"), override: true });

const BACKEND   = process.env.BACKEND_URL    || "http://localhost:3001";
const ACCOUNT   = process.env.NEAR_ACCOUNT_ID;
const PRIV_KEY  = process.env.NEAR_PRIVATE_KEY;
const HAS_WALLET = Boolean(ACCOUNT && PRIV_KEY);
const RECIPIENT = "ironshield.near";

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  const icon = pass ? "PASS" : "FAIL";
  console.log(`[${icon}] ${name}${detail ? " — " + detail : ""}`);
};

// ── crypto helpers (match backend/middleware/requireWallet.js) ───────
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
  out.writeUInt8(0, o);
  return out;
}
function buildMessage(method, p, rawBody) {
  const hash = crypto.createHash("sha256").update(rawBody || "").digest("hex");
  return `ironshield-auth:v1\n${method}\n${p}\n${hash}`;
}
function decodeBase64Url(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}
async function fetchNonce() {
  const r = await fetch(`${BACKEND}/api/auth/nonce`);
  if (!r.ok) throw new Error(`nonce ${r.status}`);
  return (await r.json()).nonce;
}
async function signedPost(targetPath, body, kp, publicKey) {
  const nonceB64 = await fetchNonce();
  const message  = buildMessage("POST", targetPath, body);
  const payload  = nep413Bytes({ message, nonce: decodeBase64Url(nonceB64), recipient: RECIPIENT });
  const digest   = crypto.createHash("sha256").update(payload).digest();
  const sig      = Buffer.from(kp.sign(new Uint8Array(digest)).signature).toString("base64");
  const headers = {
    "content-type":  "application/json",
    "x-wallet":      ACCOUNT,
    "x-public-key":  publicKey,
    "x-nonce":       nonceB64,
    "x-signature":   sig,
  };
  return { headers, nonceB64 };
}

// ── Vector 1 — unsigned POST → 401 missing-sig ───────────────────────
async function vec1() {
  const r = await fetch(`${BACKEND}/api/posts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "hi" }),
  });
  const j = await r.json().catch(() => ({}));
  record("1. unsigned POST → 401 missing-sig",
    r.status === 401 && j.code === "missing-sig",
    `HTTP ${r.status} code=${j.code}`);
}

// ── Vector 2 — replayed signed POST → 401 replay ─────────────────────
async function vec2() {
  if (!HAS_WALLET) return record("2. replayed signed POST → 401 replay", true, "skipped (no wallet)");
  const { KeyPair } = require("near-api-js");
  const kp = KeyPair.fromString(PRIV_KEY);
  const publicKey = kp.getPublicKey().toString();
  const body = JSON.stringify({ content: `smoke-${Date.now()}` });
  const { headers } = await signedPost("/api/posts", body, kp, publicKey);
  // First call should pass auth (might 400/422 for content shape, but not 401);
  // second call with the same nonce must 401 replay.
  await fetch(`${BACKEND}/api/posts`, { method: "POST", headers, body });
  const r2 = await fetch(`${BACKEND}/api/posts`, { method: "POST", headers, body });
  const j2 = await r2.json().catch(() => ({}));
  record("2. replayed signed POST → 401 replay",
    r2.status === 401 && j2.code === "replay",
    `HTTP ${r2.status} code=${j2.code}`);
}

// ── Vector 3 — oversized body (1MB) → 413 ────────────────────────────
async function vec3() {
  const big = "x".repeat(1024 * 1024); // 1MB body
  const r = await fetch(`${BACKEND}/api/posts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: big }),
  });
  record("3. 1MB body on /api/posts → 413",
    r.status === 413,
    `HTTP ${r.status}`);
}

// ── Vector 4 — CORS preflight from evil → no ACAO ────────────────────
async function vec4() {
  const r = await fetch(`${BACKEND}/api/posts`, {
    method: "OPTIONS",
    headers: {
      "Origin": "https://evil.example.com",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type, x-wallet",
    },
  });
  const acao = r.headers.get("access-control-allow-origin");
  record("4. CORS preflight from evil.example → no ACAO",
    !acao || (acao !== "https://evil.example.com" && acao !== "*"),
    `Access-Control-Allow-Origin: ${acao || "(absent)"}`);
}

// ── Vector 5 — 25 signed /api/research → 429 on 21-25 ────────────────
async function vec5() {
  if (!HAS_WALLET) return record("5. 25 signed /api/research → 429 on 21-25", true, "skipped (no wallet)");
  const { KeyPair } = require("near-api-js");
  const kp = KeyPair.fromString(PRIV_KEY);
  const publicKey = kp.getPublicKey().toString();
  const codes = [];
  for (let i = 1; i <= 25; i++) {
    const body = JSON.stringify({ query: `smoke-${i}-${Date.now()}`, chain: "near" });
    const { headers } = await signedPost("/api/research", body, kp, publicKey);
    const r = await fetch(`${BACKEND}/api/research`, { method: "POST", headers, body });
    codes.push(r.status);
  }
  const allowed = codes.slice(0, 20).every((c) => c < 400);
  const blocked = codes.slice(20).every((c) => c === 429);
  record("5. 25 signed /api/research → 429 on 21-25",
    allowed && blocked,
    `first 20: ${codes.slice(0, 20).join(",")} | 21-25: ${codes.slice(20).join(",")}`);
}

(async () => {
  console.log(`Smoke target: ${BACKEND}\nWallet env: ${HAS_WALLET ? `${ACCOUNT} ✓` : "absent (vectors 2 + 5 skipped)"}\n`);
  for (const fn of [vec1, vec2, vec3, vec4, vec5]) {
    try { await fn(); }
    catch (e) { record(fn.name, false, e.message); }
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length} checks, ${failed.length} failed.`);
  process.exit(failed.length ? 1 : 0);
})();
