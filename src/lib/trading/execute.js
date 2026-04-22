"use client";
// execute — one call site for "actually do the swap" across chains.
//
// Handles: quote → sign → send → (backend persist). Returns a
// TradeResult the OrderPanel can pipe into a success toast and the
// positions table.
//
// NEAR (Ref Finance) is a stub today; Phase 3B-2 fills it in. The
// dispatch shape is already in place so the OrderPanel doesn't grow
// a chain branch.

import { getQuote, buildSwapTx, signAndSendSwap } from "./jupiter";
import { swapOnRef } from "./ref";
import { FEE_BPS, getFeeWallet, splitFeeBaseUnits } from "./fees";

const BACKEND_BASE = (() => {
  if (typeof window === "undefined") return "";
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3001";
  return "https://ironclaw-backend.onrender.com";
})();

async function logPosition(row) {
  try {
    await fetch(`${BACKEND_BASE}/api/trading/positions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
  } catch { /* soft-fail: a missed log shouldn't prevent a swap succeeding */ }
}

async function logFee(row) {
  try {
    await fetch(`${BACKEND_BASE}/api/trading/fees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    });
  } catch { /* soft-fail */ }
}

/* ── Solana via Jupiter ─────────────────────────────────────────── */

async function swapSolana({ side, token, amount, slippageBps, privySolWallet, priceUsd }) {
  if (!privySolWallet) throw new Error("Connect a Solana wallet");
  if (!token?.baseMint || !token?.quoteMint) {
    throw new Error(
      "Token missing mint metadata. Pick it from search again — the " +
      "selector enriches automatically on click."
    );
  }
  const userPublicKey = privySolWallet.address;
  const feeAccount = getFeeWallet("sol");

  // Direction — buy = quote→base (you're paying USDC/SOL for the base
  // token); sell = base→quote (you're unloading). Base/quote convention
  // is GeckoTerminal's and matches how the chart is priced.
  const inputMint       = side === "buy" ? token.quoteMint      : token.baseMint;
  const outputMint      = side === "buy" ? token.baseMint       : token.quoteMint;
  const inputDecimals   = side === "buy" ? token.quoteDecimals  : token.baseDecimals;
  const inputSymbol     = side === "buy" ? token.quoteSymbol    : token.baseSymbol;
  const outputSymbol    = side === "buy" ? token.baseSymbol     : token.quoteSymbol;
  const outputDecimals  = side === "buy" ? token.baseDecimals   : token.quoteDecimals;

  if (!Number.isFinite(inputDecimals)) {
    throw new Error(`Missing decimals for ${inputSymbol} — pick the pair again from search.`);
  }

  // Scale UI amount → base units. BigInt keeps us safe from the
  // float-precision cliff at 10^15+ (SPL tokens can hit it for
  // 9-decimal tokens above ~1M units).
  const factor = 10n ** BigInt(inputDecimals);
  const whole = BigInt(Math.floor(Number(amount)));
  const frac = Math.floor((Number(amount) - Math.floor(Number(amount))) * Number(factor));
  const amountBase = (whole * factor + BigInt(frac)).toString();
  if (amountBase === "0") throw new Error("Amount too small");

  const quote = await getQuote({
    inputMint, outputMint, amountBase, slippageBps, feeAccount,
  });
  const base64Tx = await buildSwapTx({ quote, userPublicKey, feeAccount });
  const { signature } = await signAndSendSwap({ base64Tx, privySolWallet });

  const { fee: feeBaseStr, afterFee } = splitFeeBaseUnits(amountBase);
  const feeUsd = priceUsd ? (Number(feeBaseStr) / Number(factor)) * priceUsd : 0;

  // Fire-and-forget backend writes so the UI settles immediately.
  logPosition({
    chain: "sol",
    wallet: userPublicKey,
    token_address: outputMint,
    token_symbol: outputSymbol,
    token_decimals: outputDecimals || 0,
    amount_base: quote.outAmount,
    entry_price_usd: priceUsd || 0,
    cost_basis_usd: priceUsd ? Number(amount) * priceUsd : 0,
    entry_tx_hash: signature,
  });
  logFee({
    chain: "sol",
    wallet: userPublicKey,
    token_in:  inputMint,
    token_out: outputMint,
    amount_in_base:  amountBase,
    fee_amount_base: feeBaseStr,
    fee_amount_usd:  feeUsd,
    swap_tx_hash: signature,
    fee_tx_hash:  signature,        // same tx — Jupiter baked the fee in
    platform_wallet: feeAccount,
  });

  return { signature, feeBaseStr, afterFee, source: "jupiter" };
}

/* ── NEAR via Ref Finance ───────────────────────────────────────── */

async function swapNear({ side, token, amount, slippageBps, nearSelector, signerAccountId, priceUsd }) {
  if (!nearSelector || !signerAccountId) {
    throw new Error("Connect a NEAR wallet");
  }
  if (!token?.baseMint || !token?.quoteMint) {
    throw new Error("Token missing contract metadata. Pick the pair again from search.");
  }

  const feeWallet = getFeeWallet("near");

  // buy = quote→base (spend USDC/NEAR for base); sell = base→quote.
  // On NEAR the "mint" field holds the NEP-141 contract address.
  const tokenIn = side === "buy"
    ? { address: token.quoteMint, decimals: token.quoteDecimals, symbol: token.quoteSymbol }
    : { address: token.baseMint,  decimals: token.baseDecimals,  symbol: token.baseSymbol };
  const tokenOut = side === "buy"
    ? { address: token.baseMint,  decimals: token.baseDecimals,  symbol: token.baseSymbol }
    : { address: token.quoteMint, decimals: token.quoteDecimals, symbol: token.quoteSymbol };

  if (!Number.isFinite(tokenIn.decimals)) {
    throw new Error(`Missing decimals for ${tokenIn.symbol} — re-pick the pair.`);
  }

  // BigInt scaling: whole * 10^decimals + floor(frac * 10^decimals).
  const factor = 10n ** BigInt(tokenIn.decimals);
  const whole = BigInt(Math.floor(Number(amount)));
  const frac  = Math.floor((Number(amount) - Math.floor(Number(amount))) * Number(factor));
  const amountBase = (whole * factor + BigInt(frac)).toString();
  if (amountBase === "0") throw new Error("Amount too small");

  const res = await swapOnRef({
    selector: nearSelector,
    signerAccountId,
    tokenIn, tokenOut,
    amountBase,
    slippageBps,
    feeWallet,
    // token.poolAddress for NEAR is Ref's numeric pool ID (GeckoTerminal's
    // NETWORK_SLUG=near-protocol uses the same numeric convention Ref
    // assigns on pool creation). Required by swapOnRef for the
    // get_return view + swap-action payload.
    poolId: token.poolAddress,
  });

  const { fee: feeBaseStr } = splitFeeBaseUnits(amountBase);
  const feeUsd = priceUsd ? (Number(feeBaseStr) / 10 ** tokenIn.decimals) * priceUsd : 0;

  logPosition({
    chain: "near",
    wallet: signerAccountId,
    token_address: tokenOut.address,
    token_symbol: tokenOut.symbol,
    token_decimals: tokenOut.decimals || 0,
    amount_base: res.estimateOut || "0",
    entry_price_usd: priceUsd || 0,
    cost_basis_usd: priceUsd ? Number(amount) * priceUsd : 0,
    entry_tx_hash: res.swapTxHash,
  });
  logFee({
    chain: "near",
    wallet: signerAccountId,
    token_in:  tokenIn.address,
    token_out: tokenOut.address,
    amount_in_base:  amountBase,
    fee_amount_base: feeBaseStr,
    fee_amount_usd:  feeUsd,
    swap_tx_hash: res.swapTxHash,
    fee_tx_hash:  res.feeTxHash,
    platform_wallet: feeWallet,
  });

  return { signature: res.swapTxHash, source: "ref" };
}

/* ── Dispatch ───────────────────────────────────────────────────── */

export async function executeSwap(opts) {
  const { chain } = opts;
  if (chain === "sol")  return swapSolana(opts);
  if (chain === "near") return swapNear(opts);
  throw new Error(`Chain ${chain} not supported for trading`);
}
