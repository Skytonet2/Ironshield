// Uploads the curve wasm to the factory's store_curve_wasm method.
// Run: node scripts/upload-curve-wasm.js
const fs = require("fs");
const path = require("path");
const os = require("os");
const { connect, keyStores, KeyPair } = require("near-api-js");

const SIGNER = "ironshield.near";
const FACTORY = "newscoin-factory.ironshield.near";
const WASM_PATH = path.join(__dirname, "..", "contract", "newscoin", "curve", "target", "near", "newscoin_curve.wasm");

(async () => {
  const wasm = fs.readFileSync(WASM_PATH);
  const b64 = wasm.toString("base64");
  console.log(`Curve wasm: ${wasm.length} bytes → base64 ${b64.length} chars`);

  const credDir = path.join(os.homedir(), ".near-credentials", "mainnet");
  const credFile = path.join(credDir, `${SIGNER}.json`);
  const cred = JSON.parse(fs.readFileSync(credFile, "utf8"));

  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey("mainnet", SIGNER, KeyPair.fromString(cred.private_key));

  const near = await connect({
    networkId: "mainnet",
    nodeUrl: "https://rpc.mainnet.near.org",
    keyStore,
  });
  const acct = await near.account(SIGNER);

  console.log("Calling store_curve_wasm...");
  const res = await acct.functionCall({
    contractId: FACTORY,
    methodName: "store_curve_wasm",
    args: { wasm: b64 },
    gas: "300000000000000",
    attachedDeposit: "0",
  });
  console.log("TX:", res.transaction.hash);
  console.log("Status:", JSON.stringify(res.status));
})().catch(e => { console.error(e); process.exit(1); });
