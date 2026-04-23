"use client";
import { useWallet, getReadAccount } from "@/lib/contexts";

export const IRONCLAW_TOKEN    = "claw.ironshield.near";
export const STAKING_CONTRACT  = "ironshield.near";

export default function useNear() {
  const { connected, address, selector } = useWallet();

  const viewMethod = async (contractId, methodName, args = {}) => {
    try {
      // Shared, lazily-built read-only account on fastnear RPC.
      // Avoids reconstructing a connection on every navigation.
      const account = await getReadAccount();
      const result  = await account.viewFunction({ contractId, methodName, args });
      return result;
    } catch (err) {
      // Contract not deployed yet: return null silently so UI shows placeholders
      const msg = err?.message || "";
      if (
        msg.includes("MethodNotFound") ||
        msg.includes("method is not found") ||
        msg.includes("Contract method is not found") ||
        msg.includes("does not exist") ||
        msg.includes("account does not exist") ||
        msg.includes("CodeDoesNotExist")
      ) {
        return null;
      }
      console.warn("viewMethod unavailable:", methodName, msg);
      return null;
    }
  };

  const callMethod = async (contractId, methodName, args = {}, depositYocto = "0") => {
    if (!selector) throw new Error("Wallet not connected. Please connect your wallet first.");
    try {
      const wallet = await selector.wallet();
      // wallet-selector v10 adapters (Meteor, HERE, HOT, Intear) all call
      // najActionToInternal on incoming actions, so they expect NAJ Action
      // objects — NOT the internal {type,params} shape older versions took.
      // Passing the internal shape throws "Unsupported NAJ action" because
      // the NAJ→internal decoder can't find action.functionCall on it.
      const { transactions } = await import("near-api-js");
      const action = transactions.functionCall(
        methodName,
        args,
        30_000_000_000_000n,
        BigInt(depositYocto || "0"),
      );
      const result = await wallet.signAndSendTransaction({
        receiverId: contractId,
        actions: [action],
      });
      return result;
    } catch (err) {
      throw new Error("Transaction failed [" + methodName + "]: " + err.message);
    }
  };

  return { accountId: address, isConnected: connected, viewMethod, callMethod };
}
