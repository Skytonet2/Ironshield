// backend/services/psp/floatManager.js
//
// NEAR float for instant on-chain mission funding from a fiat (naira)
// payment. The platform holds a working NEAR balance in a dedicated
// account; when a Paystack tx is confirmed, we sign create_mission with
// the float wallet's key and the buyer's mission goes live in seconds —
// way before the naira deposits clear into our holding bank account.
//
// We later refill the float by buying NEAR from a Nigerian crypto
// exchange (Quidax preferred — see floatRefill.job.js).
//
// Threshold model:
//   FLOAT_MIN_NEAR    — refill kicks in when balance drops below this
//   FLOAT_TARGET_NEAR — refill aims to top up to this
//   FLOAT_MAX_NEAR    — refuse to ever hold more than this (inventory
//                       cap; protects us from sitting on too much NEAR)
//
// Inventory risk: NEAR price can move between buyer pays naira and us
// buying NEAR back from the exchange. Cap at FLOAT_MAX_NEAR (default ~$10k
// equiv). The cron alerts via console + telemetry if float runs dry; ops
// can manually disable the naira option until refill resolves.
//
// Custodial key safety: FLOAT_PRIVATE_KEY should be a function-call-
// access key restricted to `create_mission` on STAKING_CONTRACT_ID
// (≤25 N attached deposit per call), NOT a full-access key. That way a
// stolen float key can at most spend the float wallet's NEAR via mission
// creation, not transfer it out. The loader logs which key kind it gets.

const { Account, KeyPair, KeyPairSigner, providers } = require("near-api-js");
const { hashPayload } = require("../missionEngine");

const NODE_URL = process.env.NEAR_RPC_URL || "https://rpc.mainnet.near.org";
const STAKING_CONTRACT = process.env.STAKING_CONTRACT_ID || "ironshield.near";

// 30 TGas matches orchestratorBot.js — create_mission is a single
// storage write + an event log, well under that limit.
const GAS = BigInt("30000000000000");

// 1 NEAR = 1e24 yoctoNEAR
const YOCTO_PER_NEAR = 10n ** 24n;

function floatNearMin()    { return Number(process.env.FLOAT_MIN_NEAR    || "20");  }
function floatNearTarget() { return Number(process.env.FLOAT_TARGET_NEAR || "50");  }
function floatNearMax()    { return Number(process.env.FLOAT_MAX_NEAR    || "200"); }

function nearToYocto(n) {
  // Avoid floating-point loss for fractional NEAR by passing the value
  // through a string with up to 8 decimals — sufficient resolution for
  // any float operation we run from here.
  const [intPart, fracPart = ""] = String(n).split(".");
  const frac = (fracPart + "0".repeat(24)).slice(0, 24);
  return BigInt(intPart) * YOCTO_PER_NEAR + BigInt(frac || "0");
}

function yoctoToNear(yocto) {
  const y = BigInt(yocto);
  const whole = y / YOCTO_PER_NEAR;
  const frac = (y % YOCTO_PER_NEAR).toString().padStart(24, "0").slice(0, 6);
  return Number(`${whole}.${frac}`);
}

let cachedAccount = null;
function loadFloatAccount() {
  if (cachedAccount !== null) return cachedAccount || null;
  const accountId = (process.env.FLOAT_ACCOUNT_ID || "").trim();
  const privateKey = (process.env.FLOAT_PRIVATE_KEY || "").trim();
  if (!accountId || !privateKey) {
    console.warn("[floatManager] FLOAT_ACCOUNT_ID / FLOAT_PRIVATE_KEY not set — naira on-ramp settlement disabled");
    cachedAccount = false;
    return null;
  }
  try {
    const keyPair  = KeyPair.fromString(privateKey);
    const signer   = new KeyPairSigner(keyPair);
    const provider = new providers.JsonRpcProvider({ url: NODE_URL });
    const account  = new Account(accountId, provider, signer);
    console.log(`[floatManager] Float account loaded: ${accountId}`);
    cachedAccount = account;
    return account;
  } catch (err) {
    console.error(`[floatManager] failed to load float account: ${err.message}`);
    cachedAccount = false;
    return null;
  }
}

/** Live float wallet balance, in yoctoNEAR. Returns null if the wallet
 *  isn't configured. */
async function getBalance() {
  const acc = loadFloatAccount();
  if (!acc) return null;
  const state = await acc.getAccountBalance();
  // near-api-js returns string yocto. Use the available portion (state.available)
  // — total includes locked/staked balance the contract can't actually pull.
  return BigInt(state.available);
}

/** Sign create_mission against the configured staking contract using
 *  the float wallet's key. Returns { on_chain_id, tx_hash }.
 *
 *  inputs_json is hashed here (sha256 over canonical JSON) so the
 *  on-chain inputs_hash matches what missionEngine.recordCreated will
 *  re-derive — keeping the integrity anchor consistent. */
async function fundMission({
  template_slug,
  kit_slug = null,
  inputs_json = {},
  escrow_yocto,
  review_window_secs = null,
}) {
  const acc = loadFloatAccount();
  if (!acc) throw new Error("Float account not configured");
  if (!template_slug) throw new Error("template_slug required");
  if (!escrow_yocto) throw new Error("escrow_yocto required");

  const escrowBig = BigInt(escrow_yocto);
  if (escrowBig <= 0n) throw new Error("escrow_yocto must be positive");

  const inputs_hash = hashPayload(inputs_json || {});

  const balance = await getBalance();
  if (balance != null && balance < escrowBig) {
    const need = yoctoToNear(escrowBig);
    const have = yoctoToNear(balance);
    throw new Error(
      `Float insufficient — need ${need} N, have ${have} N. Trigger refill or fall back to a different funding flow.`,
    );
  }

  const args = { template_id: template_slug, inputs_hash };
  if (kit_slug) args.kit_slug = kit_slug;
  if (review_window_secs) args.review_window_secs = Number(review_window_secs);

  // create_mission returns the new mission id (u64). near-api-js's
  // functionCall resolves with the FinalExecutionOutcome — we parse the
  // SuccessValue for the id and surface the tx hash.
  const result = await acc.functionCall({
    contractId: STAKING_CONTRACT,
    methodName: "create_mission",
    args,
    gas: GAS,
    attachedDeposit: escrowBig,
  });

  const txHash = result?.transaction?.hash || null;
  let onChainId = null;
  try {
    const successValue = result?.status?.SuccessValue;
    if (successValue) {
      const decoded = Buffer.from(successValue, "base64").toString("utf8");
      // create_mission returns u64 as a JSON number.
      const parsed = JSON.parse(decoded);
      if (typeof parsed === "number" || typeof parsed === "string") {
        onChainId = Number(parsed);
      }
    }
  } catch (err) {
    console.warn(`[floatManager] could not parse create_mission return: ${err.message}`);
  }

  return {
    on_chain_id: onChainId,
    tx_hash:     txHash,
    inputs_hash,
    escrow_yocto: escrowBig.toString(),
  };
}

/** Health summary used by the refill cron + the /admin reconcile page. */
async function status() {
  const acc = loadFloatAccount();
  if (!acc) return { configured: false };
  const balance = await getBalance();
  return {
    configured:   true,
    account_id:   acc.accountId,
    balance_yocto: balance?.toString() ?? null,
    balance_near: balance != null ? yoctoToNear(balance) : null,
    min_near:     floatNearMin(),
    target_near:  floatNearTarget(),
    max_near:     floatNearMax(),
    needs_refill: balance != null && balance < nearToYocto(floatNearMin()),
    over_cap:     balance != null && balance > nearToYocto(floatNearMax()),
  };
}

module.exports = {
  loadFloatAccount,
  getBalance,
  fundMission,
  status,
  nearToYocto,
  yoctoToNear,
  YOCTO_PER_NEAR,
};
