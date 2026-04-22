"use client";
// fees — single source of truth for the 0.2% trading fee.
//
// Same number shows up in the OrderPanel breakdown, the swap builders,
// and the backend trade_fees audit rows. Keep them in sync here.

export const FEE_BPS = 20;          // 0.20%
export const FEE_FRACTION = FEE_BPS / 10_000;

/** Given a raw base-unit input amount (BigInt-safe as string or bigint),
 *  returns { fee, afterFee } as strings for lossless arithmetic. */
export function splitFeeBaseUnits(amountBaseStr) {
  const amount = BigInt(amountBaseStr);
  const fee = (amount * BigInt(FEE_BPS)) / 10_000n;
  const afterFee = amount - fee;
  return { fee: fee.toString(), afterFee: afterFee.toString() };
}

/** Platform-wallet destinations per chain. Server + client can both
 *  read these — never hardcode elsewhere. Undefined = chain opted out. */
export function getFeeWallet(chain) {
  if (chain === "near") return process.env.NEXT_PUBLIC_PLATFORM_WALLET_NEAR
    || process.env.PLATFORM_WALLET_NEAR
    || "fees.ironshield.near";
  if (chain === "sol")  return process.env.NEXT_PUBLIC_PLATFORM_WALLET_SOL
    || process.env.PLATFORM_WALLET_SOL
    || null;
  return null; // bnb opted out for now
}
