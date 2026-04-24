// backend/services/nearSigner.js
// Loads NEAR accounts from env and exposes Account instances that can
// sign and send transactions to ironshield.near.
//
// Two distinct identities:
//   - Agent account (AGENT_ACCOUNT_ID / AGENT_PRIVATE_KEY): signs
//     finalize_proposal / execute_proposal for governanceListener.
//   - Orchestrator account (ORCHESTRATOR_ACCOUNT / ORCHESTRATOR_KEY):
//     signs award_points, record_submission, record_mission_complete,
//     complete_task, set_agent_reputation, submit_mission_result.
//     Must match `orchestrator_id` on the contract (currently
//     orchestrator.ironshield.near).
//
// Both loaders fail soft: if creds are missing, they return null and
// callers should log + skip. Never throw at startup — the listener
// keeps running in read-only mode for the Telegram pusher, and the
// orchestrator bot keeps polling so it can surface the missing-creds
// state in logs for the operator.

const { Account, KeyPair, KeyPairSigner, providers } = require("near-api-js");

const NODE_URL = process.env.NEAR_RPC_URL || "https://rpc.mainnet.near.org";

function loadAccount(accountId, privateKey, label) {
  if (!accountId || !privateKey) return null;
  try {
    const keyPair  = KeyPair.fromString(privateKey);
    const signer   = new KeyPairSigner(keyPair);
    const provider = new providers.JsonRpcProvider({ url: NODE_URL });
    const account  = new Account(accountId, provider, signer);
    console.log(`[nearSigner] ${label} account loaded: ${accountId}`);
    return account;
  } catch (err) {
    console.error(`[nearSigner] Failed to load ${label} account: ${err.message}`);
    return null;
  }
}

let cachedAgent = null;
function getAgentAccount() {
  if (cachedAgent !== null) return cachedAgent || null;
  cachedAgent = loadAccount(
    process.env.AGENT_ACCOUNT_ID,
    process.env.AGENT_PRIVATE_KEY,
    "Agent",
  ) || false;
  return cachedAgent || null;
}

let cachedOrchestrator = null;
function getOrchestratorAccount() {
  if (cachedOrchestrator !== null) return cachedOrchestrator || null;
  cachedOrchestrator = loadAccount(
    process.env.ORCHESTRATOR_ACCOUNT,
    process.env.ORCHESTRATOR_KEY,
    "Orchestrator",
  ) || false;
  return cachedOrchestrator || null;
}

module.exports = { getAgentAccount, getOrchestratorAccount };
