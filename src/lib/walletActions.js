"use client";
// Universal wallet action builder for @near-wallet-selector v10.
//
// Different wallet adapters accept different action shapes:
//   MeteorWallet, HOT, HERE, Intear → NAJ-style  { transfer: { deposit }, functionCall: { ... } }
//   MyNearWallet                    → typed-style { type: "Transfer", params: { ... } }
//
// The core's najActionToInternal() (line ~4437 in core/index.js) ONLY recognises
// NAJ-style keys. MeteorWallet passes every action through this function, so
// typed-style objects hit the "Unsupported NAJ action" fallthrough.
//
// Strategy: try NAJ-style first (widest compatibility), fall back to typed-style
// if the wallet rejects it (MyNearWallet on some versions).

// ── Action builders ────────────────────────────────────────────────────

export function transferAction(depositYocto) {
  return {
    naj: { transfer: { deposit: String(depositYocto) } },
    typed: { type: "Transfer", params: { deposit: String(depositYocto) } },
  };
}

export function functionCallAction({ methodName, args, gas = "100000000000000", deposit = "0" }) {
  // NAJ-style: args can be a plain object — the adapter JSON-stringifies + encodes.
  return {
    naj: {
      functionCall: {
        methodName,
        args,
        gas: String(gas),
        deposit: String(deposit),
      },
    },
    typed: {
      type: "FunctionCall",
      params: {
        methodName,
        args,
        gas: String(gas),
        deposit: String(deposit),
      },
    },
  };
}

// ── Universal sender ───────────────────────────────────────────────────

/**
 * Sign and send a single transaction, auto-detecting the action format
 * the active wallet adapter accepts.
 *
 * @param {Object} wallet  - resolved wallet from `selector.wallet()`
 * @param {string} signerId
 * @param {string} receiverId
 * @param {Array} actionPairs - array of { naj, typed } from builders above
 * @returns {Object} raw wallet result
 */
export async function sendTx(wallet, signerId, receiverId, actionPairs) {
  const najActions = actionPairs.map(a => a.naj);
  const typedActions = actionPairs.map(a => a.typed);

  try {
    return await wallet.signAndSendTransaction({
      signerId,
      receiverId,
      actions: najActions,
    });
  } catch (e1) {
    const m1 = String(e1?.message || e1);
    // If this was a user rejection, don't retry with different format
    if (/reject|cancel|denied|user closed/i.test(m1)) throw e1;
    console.warn("[walletActions] NAJ-style failed:", m1, "→ trying typed-style");
    try {
      return await wallet.signAndSendTransaction({
        signerId,
        receiverId,
        actions: typedActions,
      });
    } catch (e2) {
      const m2 = String(e2?.message || e2);
      if (/reject|cancel|denied|user closed/i.test(m2)) throw e2;
      // Both failed — throw the more informative error
      console.error("[walletActions] Typed-style also failed:", m2);
      throw new Error(`Wallet signing failed. NAJ: ${m1.slice(0, 120)} | Typed: ${m2.slice(0, 120)}`);
    }
  }
}

/**
 * Sign and send multiple transactions in a batch.
 */
export async function sendTxBatch(wallet, transactions) {
  // Each tx: { signerId, receiverId, actionPairs: [{ naj, typed }] }
  const najTxs = transactions.map(tx => ({
    signerId: tx.signerId,
    receiverId: tx.receiverId,
    actions: tx.actionPairs.map(a => a.naj),
  }));
  const typedTxs = transactions.map(tx => ({
    signerId: tx.signerId,
    receiverId: tx.receiverId,
    actions: tx.actionPairs.map(a => a.typed),
  }));

  try {
    return await wallet.signAndSendTransactions({ transactions: najTxs });
  } catch (e1) {
    const m1 = String(e1?.message || e1);
    if (/reject|cancel|denied|user closed/i.test(m1)) throw e1;
    console.warn("[walletActions] batch NAJ failed:", m1, "→ typed");
    try {
      return await wallet.signAndSendTransactions({ transactions: typedTxs });
    } catch (e2) {
      const m2 = String(e2?.message || e2);
      if (/reject|cancel|denied|user closed/i.test(m2)) throw e2;
      throw new Error(`Batch signing failed. NAJ: ${m1.slice(0, 120)} | Typed: ${m2.slice(0, 120)}`);
    }
  }
}

// ── Tx hash extractor ──────────────────────────────────────────────────
export function extractTxHash(result) {
  if (!result) return null;
  const first = Array.isArray(result) ? result[result.length - 1] : result;
  return (
    first?.transaction?.hash ||
    first?.transaction_outcome?.id ||
    first?.hash ||
    (Array.isArray(result) ? result[0]?.transaction?.hash : null) ||
    null
  );
}
