"use client";
// Publishes IronFeed posts to NEAR's canonical social contract (social.near)
// so every post has a real, verifiable on-chain tx hash.
//
// Contract: social.near — FunctionCall `set` with data keyed under the
// signer's account. Storage deposit: ~0.01 N per post (returned on delete).

const SOCIAL_CONTRACT = "social.near";
const STORAGE_DEPOSIT_YOCTO = "50000000000000000000000"; // 0.05 N (covers multiple posts)

// Post payload that follows the near-social schema:
// social.near.set({ data: { "<signer>": { post: { main: JSON.stringify({type,text,image?,video?}) } } } })
export async function postToNearSocial({ selector, accountId, text, media }) {
  if (!selector || !accountId) throw new Error("Wallet not connected");

  const main = { type: "md", text };
  if (media?.url) {
    if (media.type === "VIDEO") main.video = { url: media.url };
    else main.image = { url: media.url };
  }

  const data = {
    [accountId]: { post: { main: JSON.stringify(main) }, index: { post: JSON.stringify({ key: "main", value: { type: "md" } }) } },
  };

  const wallet = await selector.wallet();
  console.log("[NEAR Social] signing with wallet:", wallet?.id || wallet?.metadata?.name, "for", accountId);

  const result = await wallet.signAndSendTransaction({
    signerId: accountId,
    receiverId: SOCIAL_CONTRACT,
    actions: [{
      type: "FunctionCall",
      params: {
        methodName: "set",
        args: { data },
        gas: "100000000000000",           // 100 Tgas
        deposit: STORAGE_DEPOSIT_YOCTO,
      },
    }],
  });

  console.log("[NEAR Social] signAndSendTransaction result:", result);

  // Extract hash from the multiple shapes different wallets return
  const txHash =
    result?.transaction?.hash ||
    result?.transaction_outcome?.id ||
    result?.hash ||
    (Array.isArray(result) ? result[0]?.transaction?.hash : null) ||
    null;

  return { txHash, result };
}

export const NEAR_SOCIAL_CONTRACT = SOCIAL_CONTRACT;
