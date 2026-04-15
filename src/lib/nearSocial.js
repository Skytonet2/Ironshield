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
  const walletId = wallet?.id || wallet?.metadata?.name || "";
  console.log("[NEAR Social] signing with wallet:", walletId, "for", accountId);

  // wallet-selector v10 expects two different action shapes depending on adapter:
  //   • Meteor, MyNearWallet → `{ type: "FunctionCall", params: {...} }`
  //   • HOT, HERE, Intear     → NAJ-style `{ functionCall: { methodName, args(Uint8Array), gas, deposit } }`
  // The najActionToInternal helper inside those adapters throws "Unsupported NAJ
  // action" when the new-style object is handed in. We try NAJ-style first (works
  // for the majority of v10.1.4 adapters), then fall back to the typed form.
  const argsBytes = new TextEncoder().encode(JSON.stringify({ data }));
  const najAction = {
    functionCall: {
      methodName: "set",
      args: argsBytes,
      gas: BigInt("100000000000000"),
      deposit: BigInt(STORAGE_DEPOSIT_YOCTO),
    },
  };
  const typedAction = {
    type: "FunctionCall",
    params: {
      methodName: "set",
      args: { data },
      gas: "100000000000000",
      deposit: STORAGE_DEPOSIT_YOCTO,
    },
  };

  const send = async (action) => wallet.signAndSendTransaction({
    signerId: accountId,
    receiverId: SOCIAL_CONTRACT,
    actions: [action],
  });

  let result;
  try {
    result = await send(najAction);
  } catch (e1) {
    const m1 = String(e1?.message || e1);
    console.warn("[NEAR Social] NAJ-style attempt failed:", m1);
    try {
      result = await send(typedAction);
    } catch (e2) {
      console.error("[NEAR Social] Typed-style attempt also failed:", e2);
      throw e2;
    }
  }

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
