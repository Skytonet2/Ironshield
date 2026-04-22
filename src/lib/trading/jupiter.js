"use client";
// jupiter — Solana swaps via Jupiter v6 aggregator.
//
// Flow: getQuote → (optional fee ATA lookup) → buildSwapTx → sign via
// Privy → send → confirm. Jupiter's `platformFeeBps` + `feeAccount`
// options bake our 0.2% into the same tx Jupiter builds, so the fee
// is atomic with the swap and we don't need to mutate a
// VersionedTransaction post-build.
//
// Caveat: `feeAccount` must be an SPL token account for the OUTPUT
// token (or native SOL-WSOL account if output is SOL). Users' first
// swap into a new output token fails if our referral ATA doesn't
// exist yet. The caller can pre-create the ATA via
// getAssociatedTokenAddressSync + SystemProgram.createAccount, or
// accept the failure and retry after ATA creation. For Phase 3B-1
// we document the limitation and skip the fee when the ATA isn't
// ready — no silent fee-free swaps.

import { FEE_BPS } from "./fees";

const JUP_BASE = "https://quote-api.jup.ag/v6";

const SOLANA_RPC =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

/* ── Quote ─────────────────────────────────────────────────────── */

/**
 * Get a swap quote. `amountBase` is the raw base-unit amount of inputMint
 * (e.g. 1 SOL = 1_000_000_000). Returns Jupiter's JSON quote as-is for
 * direct pass-through to the swap endpoint.
 */
export async function getQuote({
  inputMint, outputMint, amountBase, slippageBps = 100,
  feeAccount = null,
  signal,
}) {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: String(amountBase),
    slippageBps: String(slippageBps),
    swapMode: "ExactIn",
    onlyDirectRoutes: "false",
  });
  if (feeAccount) {
    params.set("platformFeeBps", String(FEE_BPS));
  }
  const res = await fetch(`${JUP_BASE}/quote?${params}`, { signal, cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`jupiter quote ${res.status}: ${body.slice(0, 140)}`);
  }
  return res.json();
}

/* ── Build swap tx (returns base64-encoded VersionedTransaction) ── */

export async function buildSwapTx({ quote, userPublicKey, feeAccount = null, signal }) {
  const body = {
    quoteResponse: quote,
    userPublicKey,
    wrapAndUnwrapSol: true,
    // Prioritization: let Jupiter auto-select a reasonable compute
    // budget. For power users we'll expose a slider in a later phase.
    dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: "auto",
  };
  if (feeAccount) body.feeAccount = feeAccount;

  const res = await fetch(`${JUP_BASE}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`jupiter swap build ${res.status}: ${errBody.slice(0, 200)}`);
  }
  const j = await res.json();
  return j.swapTransaction; // base64 VersionedTransaction
}

/* ── Sign + send via Privy embedded Solana wallet ──────────────── */

/**
 * Sign and send a pre-built Jupiter swap tx. `privySolWallet` is an
 * element from usePrivy().solanaWallets / useSolanaWallets().wallets —
 * anything exposing signTransaction.
 */
export async function signAndSendSwap({ base64Tx, privySolWallet }) {
  // Lazy-load web3 to keep the main bundle light. These imports pull
  // ~80kb each; loading them only on Execute keeps the initial /trading
  // paint fast.
  const [{ VersionedTransaction, Connection }] = await Promise.all([
    import("@solana/web3.js"),
  ]);

  const rawTx = Buffer.from(base64Tx, "base64");
  const tx = VersionedTransaction.deserialize(rawTx);

  // Privy's Solana wallet wrapper exposes signTransaction; this is the
  // generic interface that also lets a user replace the embedded wallet
  // with Phantom/Solflare via Privy's external-wallet support later.
  const signed = await privySolWallet.signTransaction(tx);

  const conn = new Connection(SOLANA_RPC, "confirmed");
  const raw = signed.serialize();
  const sig = await conn.sendRawTransaction(raw, {
    skipPreflight: false,
    maxRetries: 3,
  });

  // Poll until landed or the blockhash expires. confirmed commitment
  // is sufficient for a trading UI — absolute finality would take
  // another 10s for no user-visible benefit.
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  await conn.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed"
  );

  return { signature: sig };
}
