// scripts/deploy-contract-code-only.js
//
// Code-only redeploy for ironshield.near. Use when the new wasm is
// drop-in compatible with existing state — i.e. no struct shape change,
// no new collections, just function-body fixes.
//
// Phase 9 use case: the vote() pretoken_mode bug fix that landed in
// PR #50 for testnet (gated by `testnet-fast`). Mainnet's struct shape
// is unchanged from Phase 8, so we only need DeployContract — no
// migrate. Calling the existing migrate() (Phase 1 -> 2) on Phase 8
// state would either panic-revert or wipe agent_profiles/skills.
//
// Run: node scripts/deploy-contract-code-only.js [--dry-run]

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
  __dirname, "..", "contract", "target", "near", "ironshield_staking.wasm"
);
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  if (!fs.existsSync(WASM_PATH)) {
    console.error(`✗ Wasm not found at ${WASM_PATH}`);
    console.error(`  Run: cd contract && cargo near build non-reproducible-wasm --no-abi`);
    process.exit(1);
  }
  const wasm     = fs.readFileSync(WASM_PATH);
  const sha256   = require("crypto").createHash("sha256").update(wasm).digest();

  console.log(`Contract:   ${CONTRACT_ID}`);
  console.log(`Network:    ${NETWORK}`);
  console.log(`Wasm size:  ${wasm.length} bytes (${(wasm.length / 1024).toFixed(1)} KB)`);
  console.log(`Wasm sha256 hex: ${sha256.toString("hex")}`);

  const credPath = path.join(os.homedir(), ".near-credentials", NETWORK, `${CONTRACT_ID}.json`);
  const keyPair  = KeyPair.fromString(JSON.parse(fs.readFileSync(credPath, "utf8")).private_key);
  const signer   = new KeyPairSigner(keyPair);
  const provider = new providers.JsonRpcProvider({ url: NODE_URL });
  const account  = new Account(CONTRACT_ID, provider, signer);

  const pre = await provider.query({
    request_type: "view_account",
    finality:     "final",
    account_id:   CONTRACT_ID,
  });
  console.log(`Old code_hash: ${pre.code_hash}`);
  console.log(`Old state:     ${pre.storage_usage} bytes`);
  console.log(`Balance:       ${(BigInt(pre.amount) / 10n ** 24n).toString()} NEAR`);

  if (DRY_RUN) {
    console.log("\n[dry-run] Would send a single DeployContract action (no migrate). Exiting.");
    process.exit(0);
  }

  console.log("\n→ Sending code-only DeployContract...");
  const result = await account.signAndSendTransaction({
    receiverId: CONTRACT_ID,
    actions:    [transactions.deployContract(wasm)],
    waitUntil:  "FINAL",
  });
  const txHash = result.transaction.hash;
  console.log(`\n✓ Transaction landed: ${txHash}`);
  console.log(`  Explorer: https://nearblocks.io/txns/${txHash}`);

  const post = await provider.query({
    request_type: "view_account",
    finality:     "final",
    account_id:   CONTRACT_ID,
  });
  console.log(`\nNew code_hash: ${post.code_hash}`);
  console.log(`New state:     ${post.storage_usage} bytes`);
  if (post.storage_usage !== pre.storage_usage) {
    console.log(`⚠ storage_usage changed (${pre.storage_usage} -> ${post.storage_usage}) — investigate`);
  }

  // Smoke: read methods that exercise reachable state. These should
  // succeed iff the new code can deserialize the existing storage layout.
  console.log("\n→ Smoke: view methods (must succeed for state-shape compat):");
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
}

main().catch((err) => {
  console.error("\n✗ Deploy failed:", err.message);
  if (err.transaction_outcome) {
    console.error("Tx outcome:", JSON.stringify(err.transaction_outcome, null, 2));
  }
  process.exit(1);
});
