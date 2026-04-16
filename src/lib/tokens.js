"use client";
// Multi-token wallet inventory + tip caller.
//
// Tips can be paid in ANY token the user holds — NEAR (native) or any
// NEP-141 FT. Because $IRONCLAW isn't launched yet, this is the primary
// code path. $IRONCLAW becomes "just another FT" on launch.
//
// Lists the wallet's holdings via FastNEAR's account index
// (https://api.fastnear.com/v1/account/{id}/ft) and hydrates each entry with
// ft_metadata + ft_balance_of view calls, then layers NEAR on top.

import { getReadAccount, getNearInstance } from "@/lib/contexts";

// Known tokens we can attach USD prices + icons to without hitting a price
// feed. Extend as needed. TODO: replace with Ref Finance / Pyth price feed.
const PRICE_BOOK = {
  near:                                          { symbol: "NEAR",  priceUsd: 5.20, decimals: 24 },
  "wrap.near":                                   { symbol: "wNEAR", priceUsd: 5.20, decimals: 24 },
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac500f31778368b8893fbf080": { symbol: "USDC", priceUsd: 1.00, decimals: 6 },
  "usdt.tether-token.near":                      { symbol: "USDT",  priceUsd: 1.00, decimals: 6 },
  "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near":    { symbol: "USDC.e", priceUsd: 1.00, decimals: 6 },
  "dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near":    { symbol: "USDT.e", priceUsd: 1.00, decimals: 6 },
  "blackdragon.tkn.near":                        { symbol: "BLACKDRAGON", priceUsd: 0.000001, decimals: 24 },
  "intel.tkn.near":                              { symbol: "INTEL", priceUsd: 0.01, decimals: 18 },
  "ironclaw.near":                               { symbol: "IRONCLAW", priceUsd: 0.042, decimals: 18 },
};

// Native NEAR sentinel. We use the string "near" as the contract id everywhere
// a token picker talks to, and branch on it in the tip caller.
export const NATIVE_NEAR = "near";

// ─── Amount conversions ──────────────────────────────────────────────
export function toBase(amount, decimals) {
  const [w, f = ""] = String(amount).split(".");
  const padded = (f + "0".repeat(decimals)).slice(0, decimals);
  return (BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0")).toString();
}

export function fromBase(base, decimals) {
  const s = String(base || "0");
  if (s === "0") return 0;
  const b = BigInt(s);
  const div = 10n ** BigInt(decimals);
  const whole = b / div;
  const frac  = b % div;
  return Number(whole) + Number(frac) / Number(div);
}

export function formatTokenAmount(amount, decimals = 0) {
  const n = typeof amount === "number" ? amount : fromBase(amount, decimals);
  if (n === 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000)     return `${(n / 1000).toFixed(2)}K`;
  if (n >= 1)        return n.toFixed(2);
  if (n >= 0.01)     return n.toFixed(3);
  return n.toFixed(6);
}

// ─── Wallet inventory ────────────────────────────────────────────────
// Returns [{ contractId, symbol, decimals, balance (base-units string),
//            balanceHuman (Number), priceUsd, usdValue, iconUrl, isNative }]
// NEAR always listed first; FTs sorted by USD value desc.
export async function fetchWalletTokens(accountId) {
  if (!accountId) return [];

  const out = [];

  // ── NEAR native ─────────────────────────────────────────────────────
  try {
    const near = await getNearInstance();
    const acct = await near.account(accountId);
    const { balance } = await acct.getState();
    const YOCTO = 10n ** 24n;
    const available = BigInt(balance.available);
    const whole = Number(available / YOCTO);
    const frac  = Number((available % YOCTO) / (10n ** 21n)) / 1000;
    const balanceHuman = whole + frac;
    out.push({
      contractId: NATIVE_NEAR,
      symbol: "NEAR",
      decimals: 24,
      balance: available.toString(),
      balanceHuman,
      priceUsd: PRICE_BOOK.near.priceUsd,
      usdValue: balanceHuman * PRICE_BOOK.near.priceUsd,
      iconUrl: "https://near.org/favicon.ico",
      isNative: true,
    });
  } catch (err) {
    console.warn("[tokens] NEAR balance fetch failed:", err?.message || err);
    out.push({
      contractId: NATIVE_NEAR, symbol: "NEAR", decimals: 24,
      balance: "0", balanceHuman: 0, priceUsd: PRICE_BOOK.near.priceUsd,
      usdValue: 0, iconUrl: "https://near.org/favicon.ico", isNative: true,
    });
  }

  // ── NEP-141 via FastNEAR index ──────────────────────────────────────
  let contracts = [];
  try {
    const r = await fetch(`https://api.fastnear.com/v1/account/${accountId}/ft`);
    if (r.ok) {
      const data = await r.json();
      // FastNEAR shape: { account_id, tokens: [{ contract_id, balance, last_update_block_height }] }
      contracts = (data?.tokens || []).map(t => t.contract_id).filter(Boolean);
    }
  } catch (err) {
    console.warn("[tokens] FastNEAR FT list failed:", err?.message || err);
  }

  // Hydrate each FT with metadata + balance. Cap to 30 tokens to keep the
  // picker responsive; user rarely tips with obscure airdrop dust.
  const read = await getReadAccount();
  const hydrated = await Promise.all(contracts.slice(0, 30).map(async (contractId) => {
    try {
      const [meta, balance] = await Promise.all([
        read.viewFunction({ contractId, methodName: "ft_metadata", args: {} }),
        read.viewFunction({ contractId, methodName: "ft_balance_of", args: { account_id: accountId } }),
      ]);
      const decimals = meta?.decimals ?? PRICE_BOOK[contractId]?.decimals ?? 18;
      const symbol   = meta?.symbol   || PRICE_BOOK[contractId]?.symbol    || contractId.split(".")[0];
      const priceUsd = PRICE_BOOK[contractId]?.priceUsd ?? 0;
      const balanceHuman = fromBase(balance, decimals);
      if (balanceHuman <= 0) return null;
      return {
        contractId,
        symbol,
        decimals,
        balance: String(balance || "0"),
        balanceHuman,
        priceUsd,
        usdValue: balanceHuman * priceUsd,
        iconUrl: meta?.icon || null,
        isNative: false,
      };
    } catch {
      return null;
    }
  }));

  for (const token of hydrated) if (token) out.push(token);

  // NEAR stays first; sort the rest by USD value (then balance as fallback).
  const [native, ...fts] = out;
  fts.sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0) || (b.balanceHuman - a.balanceHuman));
  return [native, ...fts];
}

// ─── Tip caller (multi-token, direct wallet-to-wallet) ───────────────
// Tokens move straight from tipper → creator. No middleman contract.
//   Native NEAR: Transfer action → recipient wallet.
//   NEP-141:     ft_transfer on the token contract with receiver_id = recipient.
//                Requires recipient to be storage-registered on that token.
//
// Uses the universal walletActions helper so action format works across
// MeteorWallet (NAJ-style) and MyNearWallet (typed-style).
import { transferAction, functionCallAction, sendTx, sendTxBatch, extractTxHash } from "@/lib/walletActions";

export const TIPS_CONTRACT = "tips.ironshield.near";

export async function callTipPost({ selector, accountId, postId, token, amount, anonymous, recipient }) {
  if (!selector || !accountId) throw new Error("Wallet not connected");
  if (!token?.contractId) throw new Error("Token not selected");
  if (!(Number(amount) > 0)) throw new Error("Amount must be positive");
  if (!recipient) throw new Error("Recipient wallet missing");
  if (String(recipient).toLowerCase() === String(accountId).toLowerCase()) {
    throw new Error("Can't tip yourself");
  }

  const amountBase = toBase(amount, token.decimals);
  const memo = JSON.stringify({ post_id: String(postId), anonymous: !!anonymous });

  // Explicit opt-out for demos: NEXT_PUBLIC_TIPS_REAL=0 → mocked (no wallet popup).
  if (process.env.NEXT_PUBLIC_TIPS_REAL === "0") {
    await new Promise(r => setTimeout(r, 600));
    return {
      txHash: `mock_tip_${postId}_${Date.now().toString(36)}`,
      mocked: true,
      amountBase,
      memo,
    };
  }

  const wallet = await selector.wallet();
  let result;

  if (token.contractId === NATIVE_NEAR) {
    // Native NEAR transfer straight to the creator.
    const action = transferAction(amountBase);
    result = await sendTx(wallet, accountId, String(recipient), [action]);
  } else {
    // NEP-141 ft_transfer. Defensive storage_deposit first (0.00125 N, idempotent).
    const STORAGE = "1250000000000000000000"; // 0.00125 N
    const storageTx = {
      signerId: accountId,
      receiverId: token.contractId,
      actionPairs: [functionCallAction({
        methodName: "storage_deposit",
        args: { account_id: String(recipient), registration_only: true },
        gas: "30000000000000",
        deposit: STORAGE,
      })],
    };
    const transferTx = {
      signerId: accountId,
      receiverId: token.contractId,
      actionPairs: [functionCallAction({
        methodName: "ft_transfer",
        args: { receiver_id: String(recipient), amount: amountBase, memo },
        gas: "30000000000000",
        deposit: "1",
      })],
    };
    result = await sendTxBatch(wallet, [storageTx, transferTx]);
  }

  const txHash = extractTxHash(result);
  return { txHash, result, mocked: false, amountBase, memo };
}
