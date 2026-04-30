// backend/services/balanceLookup.js
//
// Cash-out balance read for the agent dashboard. Wraps the existing
// getBalance / getFtBalance helpers from custodialBotWallet so we don't
// open a second NEAR provider just for view calls.
//
// Today's call sites: GET /api/payments/agent/balance (chip 2 thin
// slice — read-only). When the PingPay client lands, the cash-out
// flow will reuse this same lookup as the source-of-truth balance
// shown in the quote step.
//
// Token set is intentionally narrow (NEAR + USDC variants) — those
// are the only assets PingPay's off-ramp accepts on the NEAR rails.
// Adding more tokens is one PRICE_BOOK entry away if PingPay opens
// up additional bridges.

const { getBalance, getFtBalance } = require("./custodialBotWallet");

// USDC contracts on NEAR mainnet, in order of preference. Sum across
// because a wallet can hold both the modern OmniBridge and the
// legacy rainbow-bridged flavour. Decimals are 6 for every USDC
// variant. Source-of-truth for these contract ids:
//   - omft:     bot/commands/custodial.js:164
//   - factory:  src/lib/tokens.js:21
const USDC_CONTRACTS = [
  "eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",
  "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near",
];
const USDC_DECIMALS = 6;
const NEAR_DECIMALS = 24;

// Sum BigInt strings safely. Any single failed lookup falls back to 0
// rather than blowing up the whole response — a missing FT contract
// or RPC blip should not blank out the agent's NEAR balance too.
async function sumUsdc(accountId) {
  let total = 0n;
  for (const c of USDC_CONTRACTS) {
    try {
      const b = await getFtBalance(accountId, c);
      total += BigInt(b || "0");
    } catch {
      // ignore — best-effort
    }
  }
  return total.toString();
}

/** Returns {near_yocto, usdc_base, near_decimals, usdc_decimals}.
 *  All amounts are base-unit strings; the frontend formats. */
async function getAgentBalance(accountId) {
  const [nearYocto, usdcBase] = await Promise.all([
    getBalance(accountId).catch(() => "0"),
    sumUsdc(accountId),
  ]);
  return {
    account_id:    accountId,
    near_yocto:    String(nearYocto || "0"),
    near_decimals: NEAR_DECIMALS,
    usdc_base:     usdcBase,
    usdc_decimals: USDC_DECIMALS,
  };
}

module.exports = { getAgentBalance, USDC_CONTRACTS, USDC_DECIMALS, NEAR_DECIMALS };
