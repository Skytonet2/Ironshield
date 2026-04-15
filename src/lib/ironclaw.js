"use client";
// Shared $IRONCLAW token utilities: price, tier thresholds, tip glow logic,
// gate evaluation, and mocked-but-structured NEAR contract callers. Every
// on-chain call in this file uses the real `wallet.signAndSendTransaction`
// shape so the placeholder contract IDs (tips.ironshield.near,
// rooms.ironshield.near, revenue.ironshield.near) can be swapped for live
// deploys with zero component changes.

import { useEffect, useState } from "react";

// ─── Token metadata ──────────────────────────────────────────────────
export const IRONCLAW_TOKEN_CONTRACT = "ironclaw.near";
export const IRONCLAW_SYMBOL         = "$IRONCLAW";
export const IRONCLAW_DECIMALS       = 18;

// TODO: wire Ref Finance pool price. Hardcoded placeholder for now.
export const IRONCLAW_PRICE_USD = 0.042;

export function useIronclawPrice() {
  // Shape for future: swap body for Ref Finance or Pyth price fetcher.
  const [price, setPrice] = useState(IRONCLAW_PRICE_USD);
  useEffect(() => { setPrice(IRONCLAW_PRICE_USD); }, []);
  return price;
}

// Format $IRONCLAW with K/M suffixes for display in tight action rows.
export function formatIronclawCompact(amount) {
  const n = Number(amount || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 1)         return `${Math.round(n)}`;
  return n.toFixed(2);
}

export function formatUsd(amount, price = IRONCLAW_PRICE_USD) {
  const usd = Number(amount || 0) * price;
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}K`;
  if (usd >= 1)    return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(3)}`;
}

// ─── Tip glow tiers ──────────────────────────────────────────────────
// Thresholds are USD-denominated so they work across all tip tokens
// (NEAR, USDC, $IRONCLAW once launched, any NEP-141). Each tip row
// freezes its USD value at tip time; sum = post.tipTotalUsd.
export const TIP_TIERS = [
  { name: "gold",   minUsd: 100, color: "#f5b301", label: "Hot Post" },
  { name: "silver", minUsd: 25,  color: "#c0c0c0", label: null },
  { name: "bronze", minUsd: 5,   color: "#cd7f32", label: null },
];

export function getTipTier(tipTotalUsd) {
  const n = Number(tipTotalUsd || 0);
  for (const tier of TIP_TIERS) if (n >= tier.minUsd) return tier;
  return null;
}

// ─── Staking tiers (for gated posts) ─────────────────────────────────
// Align with StakingPage. Change here, gate dropdowns + balance checks follow.
export const STAKING_TIERS = [
  { name: "Bronze",    min: 1_000 },
  { name: "Silver",    min: 10_000 },
  { name: "Gold",      min: 50_000 },
  { name: "Legendary", min: 250_000 },
];

export function tierIndex(name) {
  return STAKING_TIERS.findIndex(t => t.name === name);
}

// Returns the wallet's current tier name based on staked amount,
// or null if below the lowest tier.
export function getStakingTier(stakedAmount) {
  const n = Number(stakedAmount || 0);
  let current = null;
  for (const tier of STAKING_TIERS) if (n >= tier.min) current = tier;
  return current?.name || null;
}

// ─── Gate evaluation ─────────────────────────────────────────────────
// Post gate metadata shape:
//   { type: "balance"|"tier"|"allowlist",
//     minBalance?: number, minTier?: "Bronze"|...,
//     allowlist?: string[] }
//
// Evaluates client-side against a viewer snapshot:
//   { wallet, ironclawBalance, stakedAmount }
//
// Returns: { met: bool, reason: string, almostThere: bool, needed: number|null }
export function evaluateGate(gate, viewer) {
  if (!gate) return { met: true, reason: "", almostThere: false, needed: null };
  if (!viewer?.wallet) {
    return { met: false, reason: "Connect wallet to unlock", almostThere: false, needed: null };
  }

  if (gate.type === "balance") {
    const have = Number(viewer.ironclawBalance || 0);
    const need = Number(gate.minBalance || 0);
    if (have >= need) return { met: true, reason: "", almostThere: false, needed: 0 };
    const short = need - have;
    const almost = have / need >= 0.8;
    return {
      met: false,
      reason: `Hold ${formatIronclawCompact(need)} ${IRONCLAW_SYMBOL} to unlock`,
      almostThere: almost,
      needed: short,
    };
  }

  if (gate.type === "tier") {
    const required = tierIndex(gate.minTier);
    const current  = tierIndex(getStakingTier(viewer.stakedAmount));
    if (current >= required && required >= 0) {
      return { met: true, reason: "", almostThere: false, needed: 0 };
    }
    return {
      met: false,
      reason: `Stake to ${gate.minTier} tier to unlock`,
      almostThere: false,
      needed: null,
    };
  }

  if (gate.type === "allowlist") {
    const list = (gate.allowlist || []).map(a => a.toLowerCase());
    if (list.includes(String(viewer.wallet).toLowerCase())) {
      return { met: true, reason: "", almostThere: false, needed: 0 };
    }
    return {
      met: false,
      reason: "Wallet not on allowlist",
      almostThere: false,
      needed: null,
    };
  }

  return { met: true, reason: "", almostThere: false, needed: null };
}

// ─── Viewer snapshot hook ────────────────────────────────────────────
// Single source-of-truth for "what does this wallet hold/stake right now?"
// For MVP: reads stubbed values; shape is real so the ft_balance_of and
// get_user_stake view calls slot in later without touching callers.
export function useViewerSnapshot(wallet) {
  const [snap, setSnap] = useState({
    wallet: wallet || null,
    ironclawBalance: 0,
    stakedAmount: 0,
    accountAgeDays: 0,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!wallet) {
        setSnap({ wallet: null, ironclawBalance: 0, stakedAmount: 0, accountAgeDays: 0 });
        return;
      }
      // Deterministic stub per wallet so UI states are stable across refresh.
      // Swap these blocks for real view calls on first integration pass.
      let sum = 0;
      for (const c of wallet) sum = (sum * 31 + c.charCodeAt(0)) >>> 0;
      const seeded = (n) => ((sum = (sum * 1103515245 + 12345) >>> 0) % n);
      const snapshot = {
        wallet,
        ironclawBalance: seeded(500_000),         // TODO: ft_balance_of(ironclaw.near)
        stakedAmount:    seeded(300_000),         // TODO: get_user_stake(ironshield.near)
        accountAgeDays:  14 + seeded(400),        // TODO: use feed_users.created_at
      };
      if (!cancelled) setSnap(snapshot);
    })();
    return () => { cancelled = true; };
  }, [wallet]);

  return snap;
}

// ─── Mocked-but-real-shaped NEAR contract callers ────────────────────
// Yocto amount for a 1 $IRONCLAW attached deposit (not used for NEP-141
// transfers — ft_transfer requires 1 yoctoNEAR plus on-chain amount arg).
const ONE_YOCTO = "1";

export const TIPS_CONTRACT     = "tips.ironshield.near";
export const ROOMS_CONTRACT    = "rooms.ironshield.near";
export const REVENUE_CONTRACT  = "revenue.ironshield.near";

// Convert whole $IRONCLAW → on-chain u128 string (18 decimals).
export function toIronclawBase(amount) {
  const [w, f = ""] = String(amount).split(".");
  const padded = (f + "0".repeat(IRONCLAW_DECIMALS)).slice(0, IRONCLAW_DECIMALS);
  return (BigInt(w || "0") * 10n ** BigInt(IRONCLAW_DECIMALS) + BigInt(padded || "0")).toString();
}

// NOTE: the per-post tip caller lives in @/lib/tokens.js (`callTipPost`)
// because tips can be paid in any wallet-held token, not just $IRONCLAW.

// open_room: host stakes $IRONCLAW to create a room. Mocked like tips.
export async function callOpenRoom({ selector, accountId, title, topic, stakeAmount, durationMins, accessType }) {
  if (!selector || !accountId) throw new Error("Wallet not connected");
  const args = {
    title, topic,
    stake: toIronclawBase(stakeAmount),
    duration_mins: Number(durationMins),
    access_type: accessType,
  };
  if (process.env.NEXT_PUBLIC_ROOMS_REAL !== "1") {
    await new Promise(r => setTimeout(r, 600));
    return { txHash: `mock_room_${Date.now().toString(36)}`, mocked: true };
  }
  const wallet = await selector.wallet();
  const result = await wallet.signAndSendTransaction({
    signerId: accountId,
    receiverId: ROOMS_CONTRACT,
    actions: [{
      type: "FunctionCall",
      params: { methodName: "open_room", args, gas: "50000000000000", deposit: ONE_YOCTO },
    }],
  });
  return {
    txHash: result?.transaction?.hash || result?.transaction_outcome?.id,
    result,
    mocked: false,
  };
}
