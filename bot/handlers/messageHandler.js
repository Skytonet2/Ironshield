// bot/handlers/messageHandler.js — passive security scan for groups
const fetch    = require("node-fetch");
const BACKEND  = process.env.BACKEND_URL || "http://localhost:3001";
const URL_REGEX    = /https?:\/\/[^\s]+/gi;
const WALLET_REGEX = /0x[a-fA-F0-9]{40}|[a-zA-Z0-9_-]+\.near/g;

async function handleMessage(bot, msg) {
  const text   = msg.text || "";
  const chatId = msg.chat.id;
  const urls    = text.match(URL_REGEX)   || [];
  const wallets = text.match(WALLET_REGEX) || [];

  for (const url of urls) {
    try {
      const res  = await fetch(`${BACKEND}/api/security/check-link`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const data = await res.json();
      if (data.data?.flagged) {
        await bot.sendMessage(chatId, `⚠️ *Suspicious link detected*\n\nA link in this chat has been flagged:\n\`${url}\`\n\nReason: ${data.data.reason}\n\nDo not click links from unknown sources.`, { parse_mode: "Markdown" });
      }
    } catch (err) { /* silent fail — don't spam on check errors */ }
  }

  for (const wallet of wallets) {
    try {
      const res  = await fetch(`${BACKEND}/api/security/check-wallet`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: wallet }) });
      const data = await res.json();
      if (data.data?.flagged) {
        await bot.sendMessage(chatId, `🚨 *Flagged wallet address*\n\n\`${wallet}\`\n\nThis address has been linked to scam activity. Do not send funds.`, { parse_mode: "Markdown" });
      }
    } catch (err) { /* silent fail */ }
  }
}

module.exports = { handleMessage };
