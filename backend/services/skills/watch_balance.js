// backend/services/skills/watch_balance.js
//
// Phase 10 — Wallet Watch Kit, Scout role.
//
// Reads the NEAR balance for an account via the JsonRpcProvider
// view_account query and reports the delta vs. a previous reading the
// caller threads through. Stateless: the caller (cron poller, mission
// audit log) is responsible for remembering prev_balance_yocto across
// invocations. Returning the raw balance plus the delta lets downstream
// steps (`detect_drain`) reason about both shape and magnitude.
//
// No connected agent; no LLM. The skill is a thin wrapper over
// `provider.query({ request_type: "view_account", ... })`.
//
// For tests: pass `params._provider` to inject a fake provider so the
// integration test doesn't have to hit testnet RPC.

const { providers } = require("near-api-js");

const DEFAULT_RPC_URL = process.env.NEAR_RPC_URL || "https://rpc.mainnet.near.org";

async function fetchBalanceYocto(provider, address) {
  const res = await provider.query({
    request_type: "view_account",
    finality:     "final",
    account_id:   address,
  });
  return String(res.amount);
}

module.exports = {
  id: "watch_balance",
  manifest: {
    title:   "Wallet balance watcher",
    summary: "Reads a NEAR account's balance and reports the delta vs. the previous reading.",
    params: [
      { key: "address",            type: "string", hint: "NEAR account to watch" },
      { key: "prev_balance_yocto", type: "string", default: null, hint: "Previous balance in yoctoNEAR; null on first poll" },
    ],
  },
  async execute({ params = {} }) {
    const address = String(params.address || "").trim();
    if (!address) throw new Error("watch_balance: params.address required");

    const provider = params._provider
      || new providers.JsonRpcProvider({ url: params.rpc_url || DEFAULT_RPC_URL });

    const balance_yocto      = await fetchBalanceYocto(provider, address);
    const prev_balance_yocto = params.prev_balance_yocto != null
      ? String(params.prev_balance_yocto)
      : null;

    let delta_yocto = null;
    if (prev_balance_yocto != null) {
      try {
        delta_yocto = (BigInt(prev_balance_yocto) - BigInt(balance_yocto)).toString();
      } catch {
        delta_yocto = null;
      }
    }

    return {
      address,
      balance_yocto,
      prev_balance_yocto,
      delta_yocto,
      polled_at: new Date().toISOString(),
    };
  },
};
