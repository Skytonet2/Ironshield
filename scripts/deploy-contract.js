// scripts/deploy-contract.js
//
// Atomic upgrade of ironshield.near from Phase 1 to Phase 2.
//
// Sends a single transaction with two actions:
//   1. DeployContract — uploads the new wasm
//   2. FunctionCall   — calls migrate() to transform the existing state
//
// If migrate() panics (state shape mismatch, etc.), the entire tx reverts
// and the contract stays on the old code. This is the only safe way to
// combine deploy + migrate on NEAR.
//
// Requires ~/.near-credentials/mainnet/<contract>.json
// Run: node scripts/deploy-contract.js [--dry-run]

const fs   = require("fs");
const os   = require("os");
const path = require("path");
const {
  Account,
  KeyPair,
  KeyPairSigner,
  providers,
  transactions,
} = require("near-api-js");

const CONTRACT_ID = process.env.STAKING_CONTRACT_ID || "ironshield.near";
const NETWORK     = "mainnet";
const NODE_URL    = process.env.NEAR_RPC_URL || "https://rpc.mainnet.near.org";
const WASM_PATH   = path.join(
  __dirname,
  "..",
  "contract",
  "target",
  "near",
  "ironshield_staking.wasm"
);

const DRY_RUN = process.argv.includes("--dry-run");

function loadKey() {
  const credPath = path.join(os.homedir(), ".near-credentials", NETWORK, `${CONTRACT_ID}.json`);
  if (!fs.existsSync(credPath)) {
    throw new Error(`No credentials at ${credPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(credPath, "utf8"));
  return KeyPair.fromString(raw.private_key);
}

async function main() {
  if (!fs.existsSync(WASM_PATH)) {
    console.error(`✗ Wasm not found at ${WASM_PATH}`);
    console.error(`  Run: cd contract && cargo near build non-reproducible-wasm --no-abi`);
    process.exit(1);
  }
  const wasm     = fs.readFileSync(WASM_PATH);
  const wasmHash = require("crypto").createHash("sha256").update(wasm).digest("hex");

  console.log(`Contract:   ${CONTRACT_ID}`);
  console.log(`Network:    ${NETWORK}`);
  console.log(`Wasm:       ${WASM_PATH}`);
  console.log(`Wasm size:  ${wasm.length} bytes (${(wasm.length / 1024).toFixed(1)} KB)`);
  console.log(`Wasm sha256: ${wasmHash}`);

  const keyPair  = loadKey();
  const signer   = new KeyPairSigner(keyPair);
  const provider = new providers.JsonRpcProvider({ url: NODE_URL });
  const account  = new Account(CONTRACT_ID, provider, signer);

  // Check pre-state
  const pre = await provider.query({
    request_type: "view_account",
    finality:     "final",
    account_id:   CONTRACT_ID,
  });
  console.log(`Balance:    ${(BigInt(pre.amount) / 10n ** 24n).toString()} NEAR`);
  console.log(`Old code:   ${pre.code_hash}`);
  console.log(`Old state:  ${pre.storage_usage} bytes`);

  if (DRY_RUN) {
    console.log("\n[dry-run] Would send DeployContract + FunctionCall(migrate) atomically. Exiting.");
    process.exit(0);
  }

  console.log("\n→ Sending atomic deploy + migrate transaction...");

  const actions = [
    transactions.deployContract(wasm),
    transactions.functionCall(
      "migrate",
      {},                              // args
      BigInt("100000000000000"),       // 100 Tgas
      0n                               // 0 deposit
    ),
  ];

  const result = await account.signAndSendTransaction({
    receiverId: CONTRACT_ID,
    actions,
    waitUntil:  "FINAL",
  });

  const txHash = result.transaction.hash;
  console.log(`\n✓ Transaction landed: ${txHash}`);
  console.log(`  Explorer: https://nearblocks.io/txns/${txHash}`);

  // Show migration logs
  const allLogs = (result.receipts_outcome || [])
    .flatMap(r => r.outcome?.logs || []);
  if (allLogs.length) {
    console.log("\nLogs:");
    for (const l of allLogs) console.log("  ", l);
  }

  // Confirm new code is live
  const post = await provider.query({
    request_type: "view_account",
    finality:     "final",
    account_id:   CONTRACT_ID,
  });
  console.log(`\nNew code:   ${post.code_hash}`);
  console.log(`New state:  ${post.storage_usage} bytes`);
  console.log(`New balance: ${(BigInt(post.amount) / 10n ** 24n).toString()} NEAR`);

  // Smoke test the new methods
  console.log("\n→ Smoke test:");
  for (const m of ["get_pretoken_mode", "get_vanguard_token_id_max", "get_proposals", "get_pools"]) {
    try {
      const r = await provider.query({
        request_type: "call_function",
        finality:     "final",
        account_id:   CONTRACT_ID,
        method_name:  m,
        args_base64:  "e30=",
      });
      const out = Buffer.from(r.result).toString("utf8").slice(0, 80);
      console.log(`  ${m} → ${out}`);
    } catch (e) {
      console.log(`  ${m} → ERROR: ${e.message.split("\n")[0].slice(0, 100)}`);
    }
  }

  console.log("\n✓ Upgrade complete.");
}

main().catch(err => {
  console.error("\n✗ Deploy failed:", err.message);
  if (err.transaction_outcome) {
    console.error("Tx outcome:", JSON.stringify(err.transaction_outcome, null, 2));
  }
  process.exit(1);
});
