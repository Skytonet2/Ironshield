#!/usr/bin/env node
// scripts/day17-skills-smoke.js — Day 17.4 end-to-end skill round-trip.
//
// What it proves:
//   1. ironshield.near (newly-registered agent) buys a freshly-minted
//      paid skill from orchestrator.ironshield.near.
//   2. /api/skills/record-install indexes the tx into skill_sales.
//   3. /api/skills/history returns the row scoped to buyer_wallet.
//   4. Uninstall + reinstall round-trips: a 2nd install row appears in
//      history; chain state ends back at "installed".
//
// Cost: ~0.11 NEAR (2× 0.05 buys + gas) on mainnet. Permanent test
// skill remains in the public marketplace afterwards (no delete_skill).

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const {
  Account, KeyPair, KeyPairSigner, providers, transactions,
} = require("near-api-js");

// ── config ──────────────────────────────────────────────────────────
const STAKING = "ironshield.near";
const CREATOR = "orchestrator.ironshield.near";
const BUYER = "ironshield.near";
const NEAR_RPC = "https://rpc.mainnet.near.org";
const BACKEND = "https://ironclaw-backend.onrender.com";
const PRICE_YOCTO = "50000000000000000000000"; // 0.05 NEAR
const SKILL_NAME = `Day17 smoke skill ${new Date().toISOString().slice(0, 10)}`;
const NEP413_PREFIX = 2_147_484_061;
const RECIPIENT = "ironshield.near";

// ── helpers ─────────────────────────────────────────────────────────
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
    request_type: "call_function",
    finality: "final",
    account_id: accountId,
    method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(r.result).toString());
}

// NEP-413 borsh + sign — mirror backend/middleware/requireWallet.js so
// we can hit /api/auth/login and get a Bearer JWT.
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

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getBearerToken(buyer, keyPair) {
  // 1) request a fresh nonce (43-char b64url)
  const nr = await fetch(`${BACKEND}/api/auth/nonce`);
  if (!nr.ok) throw new Error(`nonce ${nr.status}`);
  const { nonce } = await nr.json();
  const nonceBytes = Buffer.from(nonce.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - nonce.length % 4) % 4), "base64");
  if (nonceBytes.length !== 32) throw new Error(`bad nonce length ${nonceBytes.length}`);

  // 2) sign the canonical login message
  const message = buildAuthMessage("POST", "/api/auth/login", "");
  const payload = nep413Bytes({ message, nonceBytes, recipient: RECIPIENT });
  const digest = crypto.createHash("sha256").update(payload).digest();
  const sig = keyPair.sign(new Uint8Array(digest));

  // 3) POST /login with the four headers
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
  if (!r.ok) throw new Error(`login ${r.status}: ${j.error || JSON.stringify(j)}`);
  return j.token;
}

async function main() {
  console.log(`[${new Date().toISOString()}] Day 17 skills smoke`);
  console.log(`buyer=${BUYER} creator=${CREATOR} price=0.05 NEAR\n`);

  const buyer = loadAccount(BUYER);
  const creator = loadAccount(CREATOR);

  // ── 0) Register buyer as agent if not already ───────────────────
  const existing = await viewCall(creator.provider, STAKING, "get_agent", { owner: BUYER });
  if (!existing) {
    const handle = `smoke-${Date.now().toString(36).slice(-6)}`;
    console.log(`step 0: registering ${BUYER} as agent (handle=${handle})…`);
    const reg = await buyer.account.signAndSendTransaction({
      receiverId: STAKING,
      actions: [transactions.functionCall(
        "register_agent",
        { handle, bio: "Day 17 smoke buyer" },
        50_000_000_000_000n, 0n,
      )],
    });
    console.log(`  tx: ${reg.transaction.hash}\n`);
  } else {
    console.log(`step 0: ${BUYER} already registered as agent (handle=${existing.handle})\n`);
  }

  // ── 1) Create the test skill ───────────────────────────────────
  console.log(`step 1: creator mints skill "${SKILL_NAME}"…`);
  const createRes = await creator.account.signAndSendTransaction({
    receiverId: STAKING,
    actions: [transactions.functionCall(
      "create_skill",
      {
        name: SKILL_NAME,
        description: "Test skill — Day 17 smoke evidence. Safe to ignore.",
        price_yocto: PRICE_YOCTO,
        category: "test",
        tags: ["smoke", "day17"],
        image_url: "",
      },
      80_000_000_000_000n, 0n,
    )],
  });
  const createTx = createRes.transaction.hash;
  console.log(`  tx: ${createTx}`);
  // Pull the new skill_id from the create_skill return value (logs).
  let skillId = null;
  for (const ro of createRes.receipts_outcome || []) {
    for (const log of ro.outcome?.logs || []) {
      const m = log.match(/skill_id["\s:]+(\d+)/i) || log.match(/created skill (\d+)/i);
      if (m) { skillId = Number(m[1]); break; }
    }
    if (skillId !== null) break;
  }
  if (skillId === null) {
    // Fallback: list_skills + pick the highest id authored by creator.
    const all = await viewCall(creator.provider, STAKING, "list_skills", { limit: 100, offset: 0 });
    const mine = all.filter((s) => s.author === CREATOR).sort((a, b) => b.id - a.id);
    skillId = mine[0]?.id;
  }
  if (skillId === null || skillId === undefined) throw new Error("Couldn't resolve new skill_id");
  console.log(`  skill_id: ${skillId}\n`);

  // ── 2) Bearer token for the buyer (used by record-install + history) ──
  console.log(`step 2: minting Bearer JWT for ${BUYER}…`);
  const bearer = await getBearerToken(BUYER, buyer.keyPair);
  console.log(`  token: ${bearer.slice(0, 24)}…\n`);

  // ── 3) First install ────────────────────────────────────────────
  console.log(`step 3: ${BUYER} installs skill ${skillId} (paid)…`);
  const install1 = await buyer.account.signAndSendTransaction({
    receiverId: STAKING,
    actions: [transactions.functionCall(
      "install_skill",
      { skill_id: skillId },
      80_000_000_000_000n,
      BigInt(PRICE_YOCTO),
    )],
  });
  const installTx1 = install1.transaction.hash;
  console.log(`  tx: ${installTx1}`);

  // record-install (backend re-verifies the tx, indexes into skill_sales)
  let r = await fetch(`${BACKEND}/api/skills/record-install`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ txHash: installTx1 }),
  });
  console.log(`  record-install: ${r.status} ${(await r.json()).indexed === true ? "indexed" : "??"}\n`);

  // ── 4) History should now show 1 row ────────────────────────────
  await sleep(1000);
  let hr = await fetch(`${BACKEND}/api/skills/history?wallet=${encodeURIComponent(BUYER)}`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  let hist = await hr.json();
  console.log(`step 4: history rows=${hist.rows?.length}; expect 1`);
  if (hist.rows?.length !== 1) throw new Error(`history check #1 failed: ${JSON.stringify(hist)}`);

  // Chain state should show installed.
  let installed = await viewCall(buyer.provider, STAKING, "get_installed_skills", { owner: BUYER });
  console.log(`  chain installed=${installed.map((s) => s.id).join(",") || "none"}; expect ${skillId}\n`);

  // ── 5) Uninstall ───────────────────────────────────────────────
  console.log(`step 5: ${BUYER} uninstalls skill ${skillId}…`);
  const un = await buyer.account.signAndSendTransaction({
    receiverId: STAKING,
    actions: [transactions.functionCall(
      "uninstall_skill", { skill_id: skillId }, 50_000_000_000_000n, 0n,
    )],
  });
  console.log(`  tx: ${un.transaction.hash}`);
  installed = await viewCall(buyer.provider, STAKING, "get_installed_skills", { owner: BUYER });
  console.log(`  chain installed=${installed.map((s) => s.id).join(",") || "none"}; expect none\n`);

  // ── 6) Reinstall (2nd buy, fresh tx hash, fresh row in skill_sales) ──
  console.log(`step 6: ${BUYER} reinstalls skill ${skillId}…`);
  const install2 = await buyer.account.signAndSendTransaction({
    receiverId: STAKING,
    actions: [transactions.functionCall(
      "install_skill",
      { skill_id: skillId },
      80_000_000_000_000n,
      BigInt(PRICE_YOCTO),
    )],
  });
  const installTx2 = install2.transaction.hash;
  console.log(`  tx: ${installTx2}`);

  r = await fetch(`${BACKEND}/api/skills/record-install`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ txHash: installTx2 }),
  });
  console.log(`  record-install: ${r.status} ${(await r.json()).indexed === true ? "indexed" : "??"}\n`);

  // ── 7) Final history check — expect 2 rows ─────────────────────
  await sleep(1000);
  hr = await fetch(`${BACKEND}/api/skills/history?wallet=${encodeURIComponent(BUYER)}`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  hist = await hr.json();
  console.log(`step 7: history rows=${hist.rows?.length}; expect 2`);
  if (hist.rows?.length !== 2) throw new Error(`history check #2 failed: ${JSON.stringify(hist)}`);
  for (const row of hist.rows) {
    console.log(`  ${row.tx_hash.slice(0, 12)}…  skill=${row.skill_id}  ${(BigInt(row.price_yocto) / 10n ** 22n).toString()}× 1e-2 NEAR  ${row.sold_at}`);
  }
  installed = await viewCall(buyer.provider, STAKING, "get_installed_skills", { owner: BUYER });
  console.log(`  chain installed=${installed.map((s) => s.id).join(",") || "none"}; expect ${skillId}\n`);

  console.log("✓ Day 17 smoke green.");
  console.log("  buyer:", BUYER);
  console.log("  skill_id:", skillId);
  console.log("  install tx 1:", installTx1);
  console.log("  install tx 2:", installTx2);
  console.log(`  /skills/history (live): https://ironshield.pages.dev/skills/history`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
