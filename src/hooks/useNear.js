"use client";
import { connect, keyStores } from "near-api-js";
import { useWallet } from "@/lib/contexts";

export const IRONCLAW_TOKEN    = "ironclaw.near";
export const STAKING_CONTRACT  = "ironshield.near";

const NEAR_CONFIG = {
  networkId: "mainnet",
  nodeUrl:   "https://rpc.mainnet.near.org",
  walletUrl: "https://wallet.mainnet.near.org",
  helperUrl: "https://helper.mainnet.near.org",
};

export default function useNear() {
  const { connected, address, selector } = useWallet();

  const viewMethod = async (contractId, methodName, args = {}) => {
    try {
      const keyStore = new keyStores.BrowserLocalStorageKeyStore();
      const near    = await connect({ ...NEAR_CONFIG, keyStore });
      const account = await near.account("anonymous");
      const result  = await account.viewFunction({ contractId, methodName, args });
      return result;
    } catch (err) {
      // Contract not deployed yet — return null silently so UI shows placeholders
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
      const result = await wallet.signAndSendTransaction({
        receiverId: contractId,
        actions: [{
          type: "FunctionCall",
          params: {
            methodName,
            args,
            gas:     "30000000000000",
            deposit: depositYocto,
          },
        }],
      });
      return result;
    } catch (err) {
      throw new Error("Transaction failed [" + methodName + "]: " + err.message);
    }
  };

  return { accountId: address, isConnected: connected, viewMethod, callMethod };
}
