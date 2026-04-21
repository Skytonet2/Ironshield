// Quick smoke test for ironclawClient. Run: node backend/services/_ironclawSmoke.js
require("dotenv").config({ path: require("path").join(__dirname, "../../.env") });
const ic = require("./ironclawClient");

(async () => {
  console.log("status:", await ic.status());
  const { threadId, reply } = await ic.chat({
    content: "Reply with only the single word: pong",
    timeoutMs: 30000,
  });
  console.log("thread:", threadId);
  console.log("reply :", JSON.stringify(reply));
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
