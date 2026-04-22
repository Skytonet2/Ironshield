#!/usr/bin/env node
// scripts/gen-platform-wallets.js
//
// Generate the three fee-collection wallets used by the trading-fee
// path (Phase 3). Writes the full keypairs to /secrets/platform-
// wallets.json (gitignored) and prints the public addresses so they
// can be pasted into .env.local + Render's env-var UI.
//
// Idempotent: refuses to overwrite an existing secrets file. To
// regenerate, delete /secrets/platform-wallets.json and re-run; the
// old addresses + keys live in git history of the prior run only in
// the operator's memory, so be careful.
//
// Run: `node scripts/gen-platform-wallets.js`

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const OUT_DIR = path.join(__dirname, "..", "secrets");
const OUT_FILE = path.join(OUT_DIR, "platform-wallets.json");

function exit(code, msg) {
  console.error(msg);
  process.exit(code);
}

if (fs.existsSync(OUT_FILE)) {
  exit(1,
    `\nRefusing to overwrite existing ${path.relative(process.cwd(), OUT_FILE)}.` +
    `\nIf you really want to rotate platform wallets, back up the file and delete it first.\n`
  );
}

async function genNear() {
  // Random ed25519 keypair → implicit account ID = hex(public_key).
  // near-api-js v6 exposes utils.KeyPairEd25519.fromRandom().
  const { KeyPair } = require("near-api-js");
  const kp = KeyPair.fromRandom("ed25519");
  // Implicit account: 64-char hex of the public key bytes (no prefix).
  const pk = kp.getPublicKey();
  const raw = pk.data; // Uint8Array(32)
  const accountId = Buffer.from(raw).toString("hex");
  return {
    chain: "near",
    accountId,
    publicKey: pk.toString(),        // ed25519:...
    secretKey: kp.toString(),        // ed25519:...
  };
}

async function genSol() {
  const { Keypair } = require("@solana/web3.js");
  const kp = Keypair.generate();
  return {
    chain: "sol",
    address: kp.publicKey.toBase58(),
    // Save the 64-byte secret as a base64 string. Solana tools also
    // accept the Uint8Array form — documented next to the key so the
    // operator can pick their preferred format.
    secretKeyBase64: Buffer.from(kp.secretKey).toString("base64"),
    secretKeyByteArray: Array.from(kp.secretKey),
  };
}

async function genBnb() {
  const { ethers } = require("ethers");
  const wallet = ethers.Wallet.createRandom();
  return {
    chain: "bnb",
    address: wallet.address,
    privateKey: wallet.privateKey,
    mnemonic: wallet.mnemonic?.phrase || null,
  };
}

(async () => {
  const near = await genNear();
  const sol  = await genSol();
  const bnb  = await genBnb();

  const out = {
    generatedAt: new Date().toISOString(),
    note: "Platform fee-collection wallets. Treat as root secrets — rotate by deleting this file and re-running the script.",
    integritySalt: crypto.randomBytes(16).toString("hex"),
    near,
    sol,
    bnb,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), { mode: 0o600 });

  console.log("\n✓ Platform wallets generated.\n");
  console.log(`  Secrets file: ${path.relative(process.cwd(), OUT_FILE)}  (chmod 600, gitignored)\n`);
  console.log("  Add these to .env.local (and Render env vars for prod):\n");
  console.log(`    PLATFORM_WALLET_NEAR=${near.accountId}`);
  console.log(`    PLATFORM_WALLET_SOL=${sol.address}`);
  console.log(`    PLATFORM_WALLET_BNB=${bnb.address}\n`);
  console.log("  Then fund each address with enough native token for");
  console.log("  gas (NEAR: 0.5 NEAR, SOL: 0.05 SOL, BNB: 0.01 BNB)\n");
})().catch((e) => exit(2, "Generation failed: " + e.message));
