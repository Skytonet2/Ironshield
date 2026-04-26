#!/usr/bin/env node
// Resumes the Day 17 smoke after the v1 script's race-on-list_skills
// hit free skill #3 instead of the freshly-minted paid #4.
//
// Plan: uninstall the rogue #3, then run the real round-trip on #4.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { Account, KeyPair, KeyPairSigner, providers, transactions } = require("near-api-js");

const STAKING = "ironshield.near";
const BUYER = "ironshield.near";
const NEAR_RPC = "https://rpc.mainnet.near.org";
const BACKEND = "https://ironclaw-backend.onrender.com";
const SKILL_ID = 4; // pre-minted by v1 script (orchestrator, 0.05 NEAR)
const PRICE_YOCTO = "50000000000000000000000";
const NEP413_PREFIX = 2_147_484_061;
const RECIPIENT = "ironshield.near";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadAccount(accountId) {
  const credPath = path.join(os.homedir(), ".near-credentials", "mainnet", `${accountId}.json`);
  const creds = JSON.parse(fs.readFileSync(credPath, "utf8"));
  const keyPair = KeyPair.fromString(creds.private_key);
  const signer = new KeyPairSigner(keyPair);
  const provider = new providers.JsonRpcProvider({ url: NEAR_RPC });
  return { account: new Account(accountId, provider, signer), keyPair, provider };
}
async function viewCall(provider, accountId, methodName, args) {
  const r = await provider.query({
    request_type: "call_function", finality: "final",
    account_id: accountId, method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(r.result).toString());
}
function nep413Bytes({ message, nonceBytes, recipient }) {
  const msg = Buffer.from(message, "utf8");
  const rec = Buffer.from(recipient, "utf8");
  const out = Buffer.alloc(4 + 4 + msg.length + 32 + 4 + rec.length + 1);
  let o = 0;
  out.writeUInt32LE(NEP413_PREFIX, o); o += 4;
  out.writeUInt32LE(msg.length, o); o += 4;
  msg.copy(out, o); o += msg.length;
  Buffer.from(nonceBytes).copy(out, o); o += 32;
  out.writeUInt32LE(rec.length, o); o += 4;
  rec.copy(out, o); o += rec.length;
  out.writeUInt8(0, o);
  return out;
}
function buildAuthMessage(method, urlPath, rawBody) {
  const bodyHex = crypto.createHash("sha256").update(rawBody || "").digest("hex");
  return `ironshield-auth:v1\n${method.toUpperCase()}\n${urlPath}\n${bodyHex}`;
}
async function getBearerToken(buyer, keyPair) {
  const nr = await fetch(`${BACKEND}/api/auth/nonce`);
  const { nonce } = await nr.json();
  const nonceBytes = Buffer.from(nonce.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - nonce.length % 4) % 4), "base64");
  const message = buildAuthMessage("POST", "/api/auth/login", "");
  const payload = nep413Bytes({ message, nonceBytes, recipient: RECIPIENT });
  const digest = crypto.createHash("sha256").update(payload).digest();
  const sig = keyPair.sign(new Uint8Array(digest));
  const r = await fetch(`${BACKEND}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-wallet": buyer,
      "x-public-key": keyPair.getPublicKey().toString(),
      "x-nonce": nonce,
      "x-signature": Buffer.from(sig.signature).toString("base64"),
    },
    body: "",
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`login: ${JSON.stringify(j)}`);
  return j.token;
}

async function main() {
  console.log(`[${new Date().toISOString()}] Day 17 smoke RESUME — skill_id=${SKILL_ID}`);
  const buyer = loadAccount(BUYER);

  // ── 0) Clean up rogue install of skill #3 from v1 script ────────
  let installed = await viewCall(buyer.provider, STAKING, "get_installed_skills", { owner: BUYER });
  console.log(`pre: chain installed=${installed.map((s) => s.id).join(",") || "none"}`);
  if (installed.some((s) => Number(s.id) === 3)) {
    console.log(`step 0: uninstalling rogue free skill #3…`);
    const t = await buyer.account.signAndSendTransaction({
      receiverId: STAKING,
      actions: [transactions.functionCall("uninstall_skill", { skill_id: 3 }, 50_000_000_000_000n, 0n)],
    });
    console.log(`  tx: ${t.transaction.hash}\n`);
  }
  if (installed.some((s) => Number(s.id) === SKILL_ID)) {
    console.log(`step 0b: uninstalling pre-existing #${SKILL_ID} (so we exercise a fresh install)…`);
    const t = await buyer.account.signAndSendTransaction({
      receiverId: STAKING,
      actions: [transactions.functionCall("uninstall_skill", { skill_id: SKILL_ID }, 50_000_000_000_000n, 0n)],
    });
    console.log(`  tx: ${t.transaction.hash}\n`);
  }

  // ── 1) Bearer token ─────────────────────────────────────────────
  const bearer = await getBearerToken(BUYER, buyer.keyPair);
  console.log(`step 1: bearer ready: ${bearer.slice(0, 24)}…\n`);

  // ── 2) baseline: how many history rows currently? ───────────────
  let hr = await fetch(`${BACKEND}/api/skills/history?wallet=${encodeURIComponent(BUYER)}`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  const baseline = (await hr.json()).rows?.length || 0;
  console.log(`step 2: history baseline=${baseline} rows\n`);

  // ── 3) First paid install of #4 ────────────────────────────────
  console.log(`step 3: install skill ${SKILL_ID} (1st)…`);
  const i1 = await buyer.account.signAndSendTransaction({
    receiverId: STAKING,
    actions: [transactions.functionCall(
      "install_skill", { skill_id: SKILL_ID },
      80_000_000_000_000n, BigInt(PRICE_YOCTO),
    )],
  });
  console.log(`  tx: ${i1.transaction.hash}`);

  let r = await fetch(`${BACKEND}/api/skills/record-install`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ txHash: i1.transaction.hash }),
  });
  const ri1 = await r.json();
  console.log(`  record-install: ${r.status} ${JSON.stringify(ri1)}\n`);

  // ── 4) history should now show baseline+1 rows ──────────────────
  await sleep(1500);
  hr = await fetch(`${BACKEND}/api/skills/history?wallet=${encodeURIComponent(BUYER)}`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  let hist = await hr.json();
  console.log(`step 4: history rows=${hist.rows?.length} (baseline+1=${baseline + 1})`);
  if (hist.rows?.length !== baseline + 1) throw new Error(`history #1 mismatch: ${JSON.stringify(hist)}`);

  // ── 5) Uninstall ───────────────────────────────────────────────
  console.log(`step 5: uninstall #${SKILL_ID}…`);
  const u = await buyer.account.signAndSendTransaction({
    receiverId: STAKING,
    actions: [transactions.functionCall("uninstall_skill", { skill_id: SKILL_ID }, 50_000_000_000_000n, 0n)],
  });
  console.log(`  tx: ${u.transaction.hash}`);
  installed = await viewCall(buyer.provider, STAKING, "get_installed_skills", { owner: BUYER });
  console.log(`  chain installed=${installed.map((s) => s.id).join(",") || "none"}\n`);

  // history rows should still be baseline+1 — uninstall doesn't remove rows
  hr = await fetch(`${BACKEND}/api/skills/history?wallet=${encodeURIComponent(BUYER)}`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  hist = await hr.json();
  console.log(`step 5b: history rows after uninstall=${hist.rows?.length} (still baseline+1=${baseline + 1})`);
  if (hist.rows?.length !== baseline + 1) throw new Error(`history #2 mismatch: ${JSON.stringify(hist)}`);

  // ── 6) Reinstall (2nd buy, fresh row) ──────────────────────────
  console.log(`step 6: reinstall #${SKILL_ID}…`);
  const i2 = await buyer.account.signAndSendTransaction({
    receiverId: STAKING,
    actions: [transactions.functionCall(
      "install_skill", { skill_id: SKILL_ID },
      80_000_000_000_000n, BigInt(PRICE_YOCTO),
    )],
  });
  console.log(`  tx: ${i2.transaction.hash}`);
  r = await fetch(`${BACKEND}/api/skills/record-install`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ txHash: i2.transaction.hash }),
  });
  const ri2 = await r.json();
  console.log(`  record-install: ${r.status} ${JSON.stringify(ri2)}\n`);

  await sleep(1500);
  hr = await fetch(`${BACKEND}/api/skills/history?wallet=${encodeURIComponent(BUYER)}`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  hist = await hr.json();
  console.log(`step 7: history rows=${hist.rows?.length} (baseline+2=${baseline + 2})`);
  if (hist.rows?.length !== baseline + 2) throw new Error(`history #3 mismatch: ${JSON.stringify(hist)}`);
  for (const row of hist.rows) {
    const near = (Number(BigInt(row.price_yocto) / 10n ** 18n) / 1e6).toFixed(4);
    console.log(`  ${row.tx_hash.slice(0, 12)}…  skill=${row.skill_id}  ${near} NEAR  ${row.sold_at}`);
  }
  installed = await viewCall(buyer.provider, STAKING, "get_installed_skills", { owner: BUYER });
  console.log(`  chain installed=${installed.map((s) => s.id).join(",") || "none"}; expect ${SKILL_ID}\n`);

  console.log("✓ Day 17 smoke green.");
  console.log(`  https://ironshield.pages.dev/skills/history`);
  console.log(`  install tx 1: ${i1.transaction.hash}`);
  console.log(`  install tx 2: ${i2.transaction.hash}`);
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
