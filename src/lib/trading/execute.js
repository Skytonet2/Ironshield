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
  if (!token?.inputMint || !token?.outputMint) {
    throw new Error("Token missing mint metadata (inputMint/outputMint)");
  }
  const userPublicKey = privySolWallet.address;
  const feeAccount = getFeeWallet("sol");

  // Amount is passed in token units (e.g. "0.5"). Scale to base
  // units using inputDecimals. For Phase 3B-1 we trust the caller
  // to pass a sane amount; a decimal-by-mint helper lands next turn.
  const inputDecimals = token.inputDecimals ?? (side === "buy" ? 9 : token.baseDecimals);
  const amountBase = Math.floor(Number(amount) * 10 ** inputDecimals).toString();
  if (!amountBase || amountBase === "0") throw new Error("Amount too small");

  const quote = await getQuote({
    inputMint:  token.inputMint,
    outputMint: token.outputMint,
    amountBase,
    slippageBps,
    feeAccount,
  });
  const base64Tx = await buildSwapTx({ quote, userPublicKey, feeAccount });
  const { signature } = await signAndSendSwap({ base64Tx, privySolWallet });

  const { fee: feeBaseStr, afterFee } = splitFeeBaseUnits(amountBase);
  const feeUsd = priceUsd ? (Number(feeBaseStr) / 10 ** inputDecimals) * priceUsd : 0;

  // Fire-and-forget backend writes so the UI settles immediately.
  logPosition({
    chain: "sol",
    wallet: userPublicKey,
    token_address: token.poolAddress || token.outputMint,
    token_symbol: side === "buy" ? token.baseSymbol : token.quoteSymbol,
    token_decimals: token.baseDecimals || 6,
    amount_base: quote.outAmount,
    entry_price_usd: priceUsd || 0,
    cost_basis_usd: priceUsd ? Number(amount) * priceUsd : 0,
    entry_tx_hash: signature,
  });
  logFee({
    chain: "sol",
    wallet: userPublicKey,
    token_in:  token.inputMint,
    token_out: token.outputMint,
    amount_in_base:  amountBase,
    fee_amount_base: feeBaseStr,
    fee_amount_usd:  feeUsd,
    swap_tx_hash: signature,
    fee_tx_hash:  signature,        // same tx — Jupiter baked the fee in
    platform_wallet: feeAccount,
  });

  return { signature, feeBaseStr, afterFee, source: "jupiter" };
}

/* ── NEAR via Ref Finance (Phase 3B-2) ──────────────────────────── */

async function swapNear() {
  throw new Error(
    "NEAR swap via Ref Finance lands in the next session. Use the existing " +
    "Ref Finance frontend for now: app.ref.finance."
  );
}

/* ── Dispatch ───────────────────────────────────────────────────── */

export async function executeSwap(opts) {
  const { chain } = opts;
  if (chain === "sol")  return swapSolana(opts);
  if (chain === "near") return swapNear(opts);
  throw new Error(`Chain ${chain} not supported for trading`);
}
