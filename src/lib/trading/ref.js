"use client";
// ref — hand-rolled NEAR swap via Ref Finance.
//
// Why not @ref-finance/ref-sdk: the SDK imports node's `fs` at module
// top-level (branch not guarded by a dynamic import), which Turbopack
// refuses to bundle for the browser. Rather than mock `fs` we call
// Ref's view method for the quote and build the ft_transfer_call
// action ourselves. Functionally identical, 300 lines lighter.
//
// Flow per swap:
//   1. get_return view on v2.ref-finance.near → estimated out
//   2. minAmountOut = estimated * (10_000 - slippageBps) / 10_000
//   3. tx[0] ft_transfer   of 0.2% to fees.ironshield.near
//      tx[1] ft_transfer_call to Ref with the swap msg
//   4. selector.wallet().signAndSendTransactions([tx0, tx1])
//
// Known limitations (documented for future unlock, not crashes):
//   - Native NEAR needs to be pre-wrapped via wrap.near.near_deposit.
//     We operate on NEP-141 addresses only. If tokenIn is wrap.near
//     and user's native NEAR balance is higher than their wrap.near
//     balance, the swap just fails with "not enough balance" — user
//     wraps first via app.ref.finance or the existing wallet UI.
//   - Storage registration: ft_transfer/ft_transfer_call panic if
//     receiver isn't storage-registered for the token. We assume
//     v2.ref-finance.near and fees.ironshield.near are registered
//     for listed tokens (a platform-ops batch job would do this on
//     token listing; manual for now).

import { getReadAccount } from "@/lib/contexts";

const REF_ROUTER = "v2.ref-finance.near";
const FEE_BPS = 20;                                   // 0.20%
const GAS_SWAP  = "180000000000000";                  // 180 TGas — Ref swaps are hefty
const GAS_XFER  =  "30000000000000";                  //  30 TGas — plain ft_transfer

function minAmountOut(estimatedOutStr, slippageBps) {
  // estimatedOut * (10_000 - slippageBps) / 10_000, BigInt-safe.
  const est = BigInt(estimatedOutStr);
  const mult = BigInt(10_000 - slippageBps);
  return ((est * mult) / 10_000n).toString();
}

export async function swapOnRef({
  selector, signerAccountId,
  tokenIn, tokenOut, amountBase, slippageBps,
  feeWallet,
  poolId,       // numeric Ref pool ID from TokenSelector (GT returns it as poolAddress)
}) {
  if (!selector) throw new Error("NEAR wallet not connected");
  if (poolId == null || poolId === "") {
    throw new Error(
      "Missing Ref pool ID. Pick the pair again from search — the selector " +
      "provides the pool ID as part of the enriched token."
    );
  }

  // Split: 99.8% of input goes to the swap, 0.2% to the fee wallet.
  const inAmount   = BigInt(amountBase);
  const feeAmount  = (inAmount * BigInt(FEE_BPS)) / 10_000n;
  const swapAmount = inAmount - feeAmount;

  // Quote via Ref view — returns U128 as string.
  const acc = await getReadAccount();
  let estimatedOut;
  try {
    estimatedOut = await acc.viewFunction({
      contractId: REF_ROUTER,
      methodName: "get_return",
      args: {
        pool_id: Number(poolId),
        token_in: tokenIn.address,
        amount_in: swapAmount.toString(),
        token_out: tokenOut.address,
      },
    });
  } catch (e) {
    throw new Error(
      `Ref quote failed: ${e.message || e}. The pool ID may be stale or ` +
      `the tokens may not be paired on Ref.`
    );
  }
  if (!estimatedOut || estimatedOut === "0") {
    throw new Error("Ref returned zero output — pool may be drained or tokens mismatched.");
  }

  const minOut = minAmountOut(estimatedOut, slippageBps);

  // The Ref msg carries swap actions. Single-pool is enough for MVP;
  // multi-hop would append extra entries with token_in omitted so the
  // router threads the previous action's output through.
  const swapMsg = JSON.stringify({
    actions: [{
      pool_id: Number(poolId),
      token_in: tokenIn.address,
      amount_in: swapAmount.toString(),
      token_out: tokenOut.address,
      min_amount_out: minOut,
    }],
  });

  // tx[0] = fee ft_transfer. Separate tx so the fee lands whether or
  // not the Ref swap succeeds (both share the signer's sign-and-send
  // approval though, so a cancellation cancels both).
  const feeTx = {
    signerId: signerAccountId,
    receiverId: tokenIn.address,
    actions: [{
      type: "FunctionCall",
      params: {
        methodName: "ft_transfer",
        args: {
          receiver_id: feeWallet,
          amount: feeAmount.toString(),
          memo: "ironshield platform fee",
        },
        gas: GAS_XFER,
        deposit: "1",
      },
    }],
  };

  // tx[1] = the swap. Sent as ft_transfer_call from the user's tokenIn
  // NEP-141 to the Ref router; Ref's ft_on_transfer handler reads the
  // msg and performs the swap, sending tokenOut back to the user.
  const swapTx = {
    signerId: signerAccountId,
    receiverId: tokenIn.address,
    actions: [{
      type: "FunctionCall",
      params: {
        methodName: "ft_transfer_call",
        args: {
          receiver_id: REF_ROUTER,
          amount: swapAmount.toString(),
          msg: swapMsg,
        },
        gas: GAS_SWAP,
        deposit: "1",
      },
    }],
  };

  const wallet = await selector.wallet();
  const result = await wallet.signAndSendTransactions({ transactions: [feeTx, swapTx] });

  // wallet.signAndSendTransactions returns FinalExecutionOutcome[] in
  // the same order as the input. Some wallets wrap it differently —
  // defend against both shapes.
  const outcomes = Array.isArray(result) ? result : (result ? [result] : []);
  const feeOutcome  = outcomes[0];
  const swapOutcome = outcomes[outcomes.length - 1];
  const feeTxHash  = feeOutcome?.transaction?.hash  || feeOutcome?.transaction_outcome?.id || null;
  const swapTxHash = swapOutcome?.transaction?.hash || swapOutcome?.transaction_outcome?.id || null;

  return {
    swapTxHash,
    feeTxHash,
    estimateOut: estimatedOut,
    feeBase: feeAmount.toString(),
    swapAmountBase: swapAmount.toString(),
  };
}
