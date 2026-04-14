// backend/services/txVerify.js
// Verifies a NEAR transfer on-chain: signer, receiver, and amount >= expected.
const { providers } = require("near-api-js");
const RPC_URL = process.env.NEAR_RPC_URL || "https://rpc.fastnear.com";
const TREASURY = process.env.PLATFORM_TREASURY || "ironshield.near";

const provider = new providers.JsonRpcProvider({ url: RPC_URL });

async function verifyTransfer({ txHash, signerId, minAmountNear }) {
  if (!txHash) return { ok: false, reason: "missing txHash" };
  try {
    const out = await provider.txStatus(txHash, signerId, "FINAL");
    const tx = out.transaction;
    if (tx.signer_id !== signerId) return { ok: false, reason: "signer mismatch" };
    if (tx.receiver_id !== TREASURY) return { ok: false, reason: `receiver ${tx.receiver_id} != ${TREASURY}` };
    const transfer = tx.actions?.find(a => a.Transfer || a.transfer);
    const dep = transfer?.Transfer?.deposit || transfer?.transfer?.deposit || "0";
    const YOCTO = 1_000_000_000_000_000_000_000_000n;
    const near = Number(BigInt(dep) / YOCTO) + Number(BigInt(dep) % YOCTO) / 1e24;
    if (near + 0.0001 < minAmountNear) return { ok: false, reason: `amount ${near} < ${minAmountNear}` };
    return { ok: true, amountNear: near, receiver: tx.receiver_id };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

module.exports = { verifyTransfer, TREASURY };
