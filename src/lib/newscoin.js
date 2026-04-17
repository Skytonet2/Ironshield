"use client";
// NewsCoin client — contract interactions for the bonding curve news tokens.

import { functionCallAction, sendTx, extractTxHash } from "@/lib/walletActions";
import { getReadAccount } from "@/lib/contexts";
import { toYocto } from "@/lib/payments";

// Contract addresses
export const FACTORY_CONTRACT = "newscoin-factory.ironshield.near";
export const REGISTRY_CONTRACT = "newscoin-registry.ironshield.near";

// ─── View methods (read-only, no wallet needed) ─────────────────────

export async function getCoinInfo(coinAddress) {
  const account = await getReadAccount();
  return account.viewFunction({ contractId: coinAddress, methodName: "get_info", args: {} });
}

export async function getCoinBalance(coinAddress, accountId) {
  const account = await getReadAccount();
  const result = await account.viewFunction({ contractId: coinAddress, methodName: "get_balance", args: { account_id: accountId } });
  return result; // U128 string
}

export async function getCurveState(coinAddress) {
  const account = await getReadAccount();
  return account.viewFunction({ contractId: coinAddress, methodName: "get_curve_state", args: {} });
}

export async function getCoinsForStory(storyId) {
  const account = await getReadAccount();
  return account.viewFunction({ contractId: FACTORY_CONTRACT, methodName: "get_coins_for_story", args: { story_id: storyId } });
}

export async function getTopHolders(coinAddress, limit = 20) {
  const account = await getReadAccount();
  return account.viewFunction({ contractId: coinAddress, methodName: "get_top_holders", args: { limit } });
}

// ─── Write methods (require wallet) ─────────────────────────────────

// Create a new coin for a story (2 NEAR creation fee; 0 if waived on-chain)
export async function createCoin({ selector, accountId, storyId, name, ticker, headline }) {
  const wallet = await selector.wallet();
  // Check if the caller is on the fee-waiver list — if so, attach 0 NEAR.
  let deposit = toYocto(2);
  try {
    const acct = await getReadAccount();
    const waived = await acct.viewFunction({
      contractId: FACTORY_CONTRACT,
      methodName: "is_fee_waived",
      args: { account_id: accountId },
    });
    if (waived) deposit = "0";
  } catch (_) { /* ignore; fall back to paid */ }

  const action = functionCallAction({
    methodName: "create_coin",
    args: { story_id: storyId, name, ticker, headline },
    gas: "300000000000000",
    deposit,
  });
  const result = await sendTx(wallet, accountId, FACTORY_CONTRACT, [action]);
  return { txHash: extractTxHash(result), result };
}

// Buy tokens on a bonding curve
export async function buyCoin({ selector, accountId, coinAddress, nearAmount }) {
  const wallet = await selector.wallet();
  const action = functionCallAction({
    methodName: "buy",
    args: {},
    gas: "100000000000000",
    deposit: toYocto(nearAmount),
  });
  const result = await sendTx(wallet, accountId, coinAddress, [action]);
  return { txHash: extractTxHash(result), result };
}

// Sell tokens from a bonding curve
export async function sellCoin({ selector, accountId, coinAddress, amount }) {
  const wallet = await selector.wallet();
  const action = functionCallAction({
    methodName: "sell",
    args: { amount: String(amount) },
    gas: "100000000000000",
    deposit: "1", // 1 yoctoNEAR for storage
  });
  const result = await sendTx(wallet, accountId, coinAddress, [action]);
  return { txHash: extractTxHash(result), result };
}

// Claim creator fees
export async function claimCreatorFees({ selector, accountId, coinAddress }) {
  const wallet = await selector.wallet();
  const action = functionCallAction({
    methodName: "claim_fees",
    args: {},
    gas: "50000000000000",
    deposit: "0",
  });
  const result = await sendTx(wallet, accountId, coinAddress, [action]);
  return { txHash: extractTxHash(result), result };
}

// Claim refund after coin kill
export async function claimRefund({ selector, accountId, coinAddress }) {
  const wallet = await selector.wallet();
  const action = functionCallAction({
    methodName: "claim_refund",
    args: {},
    gas: "50000000000000",
    deposit: "0",
  });
  const result = await sendTx(wallet, accountId, coinAddress, [action]);
  return { txHash: extractTxHash(result), result };
}

// ─── Price helpers ──────────────────────────────────────────────────

const NEAR_PRICE_USD = 5.20; // TODO: fetch from price feed

export function mcapToUsd(mcapNear) {
  return Number(mcapNear) * NEAR_PRICE_USD;
}

export function formatMcap(usd) {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${usd.toFixed(0)}`;
}

export function formatNear(amount) {
  const n = Number(amount);
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(3);
  return n.toFixed(6);
}

// Bonding progress (0 to 1)
export function bondingProgress(mcapUsd) {
  return Math.min(1, mcapUsd / 70_000);
}

// Age category
export function coinAge(createdAt) {
  const hours = (Date.now() - new Date(createdAt).getTime()) / 3600000;
  if (hours < 1) return `${Math.floor(hours * 60)}m`;
  if (hours < 24) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}
