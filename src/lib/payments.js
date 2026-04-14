"use client";
// Wallet-signed NEAR transfers for IronFeed (agent deploy, org badge, ad boost).
// Uses the existing @near-wallet-selector session. Deducts NEAR directly from
// the user's wallet and returns the transaction hash.

export const PLATFORM_TREASURY = process.env.NEXT_PUBLIC_TREASURY_ACCOUNT || "ironshield.near";

// Balance check helper — returns available NEAR as a Number.
export async function getAvailableNear(accountId) {
  const { getNearInstance } = await import("@/lib/contexts");
  const near = await getNearInstance();
  const account = await near.account(accountId);
  const { balance } = await account.getState();
  const YOCTO = 1_000_000_000_000_000_000_000_000n;
  const whole = Number(balance.available / YOCTO);
  const frac  = Number((balance.available % YOCTO) / 1_000_000_000_000_000_000_000n) / 1000;
  return whole + frac;
}

// Parse NEAR float → yoctoNEAR string
export function toYocto(near) {
  const [w, f = ""] = String(near).split(".");
  const padded = (f + "0".repeat(24)).slice(0, 24);
  return BigInt(w || "0") * 1_000_000_000_000_000_000_000_000n + BigInt(padded || "0");
}

/**
 * Prompt the user's wallet to sign a NEAR transfer.
 * Throws InsufficientFundsError if the wallet can't cover it.
 */
export async function payNear({ selector, accountId, amountNear, memo = "" }) {
  if (!selector || !accountId) throw new Error("Wallet not connected");

  const available = await getAvailableNear(accountId);
  // Reserve ~0.05 NEAR for gas + storage
  if (available < Number(amountNear) + 0.05) {
    const err = new Error(`Insufficient balance: ${available.toFixed(2)} NEAR available, need ${amountNear} NEAR`);
    err.code = "INSUFFICIENT_FUNDS";
    throw err;
  }

  const wallet = await selector.wallet();
  const yocto = toYocto(amountNear).toString();

  const result = await wallet.signAndSendTransaction({
    signerId: accountId,
    receiverId: PLATFORM_TREASURY,
    actions: [{
      type: "Transfer",
      params: { deposit: yocto },
    }],
  });

  const txHash = result?.transaction?.hash || result?.transaction_outcome?.id || null;
  return { txHash, result, memo };
}
