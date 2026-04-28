#!/usr/bin/env node
// scripts/register-wallet-watch-kit.js
//
// Phase 10 Tier 3 — On-chain Wallet Watch Kit registration.
//
// Reads the off-chain agent_kits row that the seed job
// (backend/jobs/seedWalletWatchKit.job.js) created, then calls
// `register_kit` on the staking contract with the same manifest_hash
// so the on-chain row anchors the off-chain payload.
//
// Owner-only on the contract side. Uses the same orchestrator account
// pattern as seedBuiltinSkills.job.js.
//
// Usage:
//   node scripts/register-wallet-watch-kit.js [--update-hash-only]
//
//     --update-hash-only   call update_kit_manifest instead of register_kit
//                          (for re-bumping the hash after a manifest edit)
//
// Required env:
//   STAKING_CONTRACT       contract account (default ironshield.near)
//   NEAR_RPC_URL           RPC endpoint     (default mainnet)
//   ORCHESTRATOR_ACCOUNT   signer (must be the contract owner)
//   ORCHESTRATOR_KEY       full-access key for ORCHESTRATOR_ACCOUNT
//
// Note: at the time of writing, mainnet ironshield.near is on Phase 9
// (no Kit registry). Run this against testnet, a near-workspaces
// sandbox, or wait until the Phase 10 contract upgrade lands. The
// Phase 10 deploy gate (testnet round-trip of migrate_v10_economy)
// must pass before mainnet.

require("dotenv").config();
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local"), override: true });

const db = require("../backend/db/client");
const { getOrchestratorAccount } = require("../backend/services/nearSigner");

const STAKING_CONTRACT = process.env.STAKING_CONTRACT || "ironshield.near";
const KIT_SLUG         = "wallet-watch-kit";
const GAS              = 100_000_000_000_000n; // 100 Tgas
const KIT_STATUS       = "beta";

function parseArgs(argv) {
  const args = { updateHashOnly: false };
  for (const a of argv) {
    if (a === "--update-hash-only") args.updateHashOnly = true;
  }
  return args;
}

async function readKitRow() {
  const { rows } = await db.query(
    `SELECT slug, title, vertical, curator_wallet, manifest_hash,
            kit_curator_bps, agent_owner_bps, platform_bps, status
       FROM agent_kits WHERE slug = $1`,
    [KIT_SLUG],
  );
  return rows[0] || null;
}

async function callRegister(orchestrator, kit) {
  console.log(`[chain] register_kit(${kit.slug}) on ${STAKING_CONTRACT}`);
  const out = await orchestrator.functionCall({
    contractId: STAKING_CONTRACT,
    methodName: "register_kit",
    args: {
      slug:             kit.slug,
      title:            kit.title,
      vertical:         kit.vertical,
      curator:          kit.curator_wallet,
      manifest_hash:    kit.manifest_hash,
      kit_curator_bps:  kit.kit_curator_bps,
      agent_owner_bps:  kit.agent_owner_bps,
      platform_bps:     kit.platform_bps,
      status:           kit.status || KIT_STATUS,
    },
    gas: GAS,
    attachedDeposit: 0n,
  });
  return out?.transaction?.hash || null;
}

async function callUpdateHash(orchestrator, kit) {
  console.log(`[chain] update_kit_manifest(${kit.slug}) on ${STAKING_CONTRACT}`);
  const out = await orchestrator.functionCall({
    contractId: STAKING_CONTRACT,
    methodName: "update_kit_manifest",
    args: { slug: kit.slug, manifest_hash: kit.manifest_hash },
    gas: GAS,
    attachedDeposit: 0n,
  });
  return out?.transaction?.hash || null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const orchestrator = getOrchestratorAccount();
  if (!orchestrator) {
    console.error("[chain] ORCHESTRATOR_ACCOUNT / ORCHESTRATOR_KEY not configured. Aborting.");
    process.exit(1);
  }

  const kit = await readKitRow();
  if (!kit) {
    console.error(`[chain] agent_kits row "${KIT_SLUG}" not found — run seedWalletWatchKit.job.js first.`);
    process.exit(2);
  }
  console.log(`[chain] off-chain kit hash = ${kit.manifest_hash}`);

  let txHash = null;
  try {
    if (args.updateHashOnly) txHash = await callUpdateHash(orchestrator, kit);
    else                     txHash = await callRegister(orchestrator, kit);
  } catch (e) {
    console.error(`[chain] call failed: ${e.message}`);
    process.exit(3);
  }
  console.log(`[chain] tx hash: ${txHash || "(none surfaced)"}`);
  console.log(`[chain] done.`);
  try { await db.close(); } catch { /* ignore */ }
  process.exit(0);
}

if (require.main === module) main();

module.exports = { readKitRow, callRegister, callUpdateHash };
