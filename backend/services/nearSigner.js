// backend/services/nearSigner.js
// Loads the IronClaw agent NEAR account from env and exposes an Account
// instance that can sign and send transactions to ironshield.near.
//
// Required env vars:
//   AGENT_ACCOUNT_ID  — e.g. "ironclaw-agent.near"
//   AGENT_PRIVATE_KEY — full key string, e.g. "ed25519:..."
//
// If either is missing, getAgentAccount() returns null and callers should
// log + skip — never throw at startup, so the listener can keep running in
// read-only mode for the Telegram pusher.

const { Account, KeyPair, KeyPairSigner, providers } = require("near-api-js");

const NODE_URL = process.env.NEAR_RPC_URL || "https://rpc.mainnet.near.org";

let cached = null;

function getAgentAccount() {
  if (cached !== null) return cached;

  const accountId  = process.env.AGENT_ACCOUNT_ID;
  const privateKey = process.env.AGENT_PRIVATE_KEY;

  if (!accountId || !privateKey) {
    cached = false; // memoize the negative so we don't re-check on every poll
    return null;
  }

  try {
    const keyPair  = KeyPair.fromString(privateKey);
    const signer   = new KeyPairSigner(keyPair);
    const provider = new providers.JsonRpcProvider({ url: NODE_URL });
    cached = new Account(accountId, provider, signer);
    console.log(`[nearSigner] Agent account loaded: ${accountId}`);
    return cached;
  } catch (err) {
    console.error(`[nearSigner] Failed to load agent account: ${err.message}`);
    cached = false;
    return null;
  }
}

module.exports = { getAgentAccount };
