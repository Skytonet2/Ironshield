#!/usr/bin/env node
// scripts/day14-bridge-evidence.js — Day 14 bridge end-to-end evidence.
//
// Bridges 0.1 NEAR (mainnet) -> SOL (mainnet) via NEAR Intents 1-click,
// then polls status until COMPLETE. Captures both sides' tx hashes and
// the appFees stamp so the v0.95.0-beta tag has a real bridge artifact.
//
// Why mainnet: 1-click has no testnet/devnet endpoints (probed) -- the
// only honest path to "real bridge story" is a tiny mainnet transfer.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { connect, KeyPair, keyStores, utils, transactions } = require("near-api-js");
const { functionCall } = transactions;

// ── config ──────────────────────────────────────────────────────────
const SENDER = "ironshield.near";
const REFUND_TO = "ironshield.near";
const SOL_RECIPIENT = "6UP6LumJUY6Hy2TQzfhsuKhVtxzPriq99LS7qdeP2ruJ";
const ORIGIN_ASSET = "nep141:wrap.near";
const DEST_ASSET = "nep141:sol.omft.near";
const BRIDGE_AMOUNT_HUMAN = "0.1";
const BRIDGE_AMOUNT_YOCTO = "100000000000000000000000"; // 0.1 * 10^24
const STORAGE_DEPOSIT_YOCTO = "1250000000000000000000"; // 0.00125 NEAR
const FEE_RECIPIENT = "fees.ironshield.near";
const FEE_BPS = 20;
const ONECLICK_BASE = "https://1click.chaindefuser.com/v0";
const NEAR_RPC = "https://rpc.mainnet.near.org";
const SOL_RPC = "https://api.mainnet-beta.solana.com";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getSolBalance(addr) {
  const r = await fetch(SOL_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [addr] }),
  });
  const j = await r.json();
  return j?.result?.value ?? null; // lamports
}

async function getNearAccountBalance(account) {
  const state = await account.state();
  return state.amount; // yocto string
}

async function main() {
  const t0 = new Date();
  console.log(`[${t0.toISOString()}] Day 14 bridge evidence — ${SENDER} -> ${SOL_RECIPIENT}`);

  // 1. Load credentials
  const credsPath = path.join(os.homedir(), ".near-credentials", "mainnet", `${SENDER}.json`);
  const creds = JSON.parse(fs.readFileSync(credsPath, "utf8"));
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey("mainnet", SENDER, KeyPair.fromString(creds.private_key));
  const near = await connect({ networkId: "mainnet", keyStore, nodeUrl: NEAR_RPC });
  const account = await near.account(SENDER);

  const preNearBalance = await getNearAccountBalance(account);
  const preSolLamports = await getSolBalance(SOL_RECIPIENT);
  console.log(`pre-balances:  NEAR=${utils.format.formatNearAmount(preNearBalance, 6)} | SOL_lamports=${preSolLamports}`);

  // 2. Get a non-dry quote from 1-click (returns depositAddress + signature)
  const quotePayload = {
    dry: false,
    depositMode: "SIMPLE",
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: ORIGIN_ASSET,
    destinationAsset: DEST_ASSET,
    amount: BRIDGE_AMOUNT_YOCTO,
    depositType: "ORIGIN_CHAIN",
    refundTo: REFUND_TO,
    refundType: "ORIGIN_CHAIN",
    recipient: SOL_RECIPIENT,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
    appFees: [{ recipient: FEE_RECIPIENT, fee: FEE_BPS }],
  };
  const qr = await fetch(`${ONECLICK_BASE}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(quotePayload),
  });
  const qj = await qr.json();
  if (!qr.ok) {
    console.error("quote failed:", qj);
    process.exit(1);
  }
  const depositAddress = qj.quote.depositAddress;
  console.log(`quote ok: depositAddress=${depositAddress} amountOut=${qj.quote.amountOutFormatted} SOL ETA=${qj.quote.timeEstimate}s`);
  console.log(`appFees stamped on quote:`, JSON.stringify(qj.quoteRequest.appFees));

  // 3. Build batch tx to wrap.near: storage_deposit + near_deposit + ft_transfer
  console.log(`[${new Date().toISOString()}] signing+sending wrap+transfer tx from ${SENDER}...`);
  const tStart = Date.now();
  // 1click's deposit address is a fresh NEAR implicit account each
  // quote — never pre-registered on wrap.near. ft_transfer panics
  // ("not registered") unless we storage_deposit for it first. So
  // four actions, all to wrap.near:
  //   0. storage_deposit(SENDER)         — register self for wNEAR
  //   1. near_deposit                    — wrap 0.1 NEAR -> 0.1 wNEAR
  //   2. storage_deposit(depositAddress) — register the receiver
  //   3. ft_transfer -> depositAddress
  const result = await account.signAndSendTransaction({
    receiverId: "wrap.near",
    actions: [
      functionCall(
        "storage_deposit",
        { account_id: SENDER, registration_only: true },
        30000000000000n,
        BigInt(STORAGE_DEPOSIT_YOCTO),
      ),
      functionCall(
        "near_deposit",
        {},
        30000000000000n,
        BigInt(BRIDGE_AMOUNT_YOCTO),
      ),
      functionCall(
        "storage_deposit",
        { account_id: depositAddress, registration_only: true },
        30000000000000n,
        BigInt(STORAGE_DEPOSIT_YOCTO),
      ),
      functionCall(
        "ft_transfer",
        {
          receiver_id: depositAddress,
          amount: BRIDGE_AMOUNT_YOCTO,
          memo: "ironshield-day14-bridge-evidence",
        },
        30000000000000n,
        1n,
      ),
    ],
  });
  const depositTxHash = result.transaction.hash;
  console.log(`deposit tx hash: ${depositTxHash}`);
  console.log(`nearblocks: https://nearblocks.io/txns/${depositTxHash}`);

  // 4. Poll 1-click status until terminal state
  let final = null;
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const sr = await fetch(`${ONECLICK_BASE}/status?depositAddress=${encodeURIComponent(depositAddress)}`);
    const sj = await sr.json();
    const stage = sj?.status || sj?.state || "UNKNOWN";
    process.stdout.write(`[${new Date().toISOString()}] poll ${i + 1}: status=${stage}\n`);
    if (sr.ok && (stage === "SUCCESS" || stage === "COMPLETE" || stage === "REFUNDED" || stage === "FAILED")) {
      final = sj;
      break;
    }
  }
  const tEnd = Date.now();
  const elapsedSec = ((tEnd - tStart) / 1000).toFixed(1);
  console.log(`bridge finished in ${elapsedSec}s. final status:`, JSON.stringify(final, null, 2));

  // 5. Post-balances
  await sleep(3000);
  const postNearBalance = await getNearAccountBalance(account);
  const postSolLamports = await getSolBalance(SOL_RECIPIENT);
  console.log(`post-balances: NEAR=${utils.format.formatNearAmount(postNearBalance, 6)} | SOL_lamports=${postSolLamports}`);
  console.log(`SOL delta: ${(postSolLamports ?? 0) - (preSolLamports ?? 0)} lamports`);

  // 6. Emit machine-parseable summary for the evidence doc
  const summary = {
    timestamp_start: t0.toISOString(),
    timestamp_end: new Date().toISOString(),
    elapsed_seconds: Number(elapsedSec),
    sender: SENDER,
    recipient_solana: SOL_RECIPIENT,
    bridge_amount_near: BRIDGE_AMOUNT_HUMAN,
    deposit_address: depositAddress,
    deposit_tx_hash: depositTxHash,
    nearblocks_url: `https://nearblocks.io/txns/${depositTxHash}`,
    quote_response: qj,
    final_status: final,
    near_balance_pre_yocto: preNearBalance,
    near_balance_post_yocto: postNearBalance,
    sol_lamports_pre: preSolLamports,
    sol_lamports_post: postSolLamports,
    sol_lamports_delta: (postSolLamports ?? 0) - (preSolLamports ?? 0),
  };
  const outPath = path.join(__dirname, "..", "docs", "bridge-mainnet-evidence.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`wrote ${outPath}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
