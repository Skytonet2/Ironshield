"use client";
// Publishes IronFeed posts to NEAR's canonical social contract (social.near)
// so every post has a real, verifiable on-chain tx hash.
//
// Contract: social.near — FunctionCall `set` with data keyed under the
// signer's account. Storage deposit: ~0.05 N per post (returned on delete).

import { functionCallAction, sendTx, extractTxHash } from "@/lib/walletActions";

const SOCIAL_CONTRACT = "social.near";
const STORAGE_DEPOSIT_YOCTO = "50000000000000000000000"; // 0.05 N

export async function postToNearSocial({ selector, accountId, text, media }) {
  if (!selector || !accountId) throw new Error("Wallet not connected");

  const main = { type: "md", text };
  if (media?.url) {
    if (media.type === "VIDEO") main.video = { url: media.url };
    else main.image = { url: media.url };
  }

  const data = {
    [accountId]: {
      post: { main: JSON.stringify(main) },
      index: { post: JSON.stringify({ key: "main", value: { type: "md" } }) },
    },
  };

  const wallet = await selector.wallet();
  const walletId = wallet?.id || wallet?.metadata?.name || "";
  console.log("[NEAR Social] signing with wallet:", walletId, "for", accountId);

  const action = functionCallAction({
    methodName: "set",
    args: { data },
    gas: "100000000000000",
    deposit: STORAGE_DEPOSIT_YOCTO,
  });

  const result = await sendTx(wallet, accountId, SOCIAL_CONTRACT, [action]);
  console.log("[NEAR Social] signAndSendTransaction result:", result);

  const txHash = extractTxHash(result);
  return { txHash, result };
}

export const NEAR_SOCIAL_CONTRACT = SOCIAL_CONTRACT;
