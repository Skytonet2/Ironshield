// bot/commands/portfolio.js
const fetch     = require("node-fetch");
const formatter = require("../utils/formatter");
const BACKEND   = process.env.BACKEND_URL || "http://localhost:3001";

async function handle(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const text   = msg.text || "";
  const parts  = text.trim().split(/\s+/);

  // /portfolio add 0x...
  if (parts[1] === "add" && parts[2]) {
    return handleAdd(bot, msg, parts[2]);
  }

  // /portfolio remove 0x...
  if (parts[1] === "remove" && parts[2]) {
    try {
      const res  = await fetch(`${BACKEND}/api/portfolio`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "remove_wallet", userId, wallet: parts[2] }),
      });
      const json = await res.json();
      await bot.sendMessage(chatId, json.success ? `✅ Wallet removed: \`${parts[2]}\`` : `⚠️ ${json.error}`, { parse_mode: "Markdown" });
    } catch {
      await bot.sendMessage(chatId, "⚠️ Failed to remove wallet.");
    }
    return;
  }

  // /portfolio — fetch
  const waitMsg = await bot.sendMessage(chatId, "💼 Fetching your portfolio...");
  try {
    const res  = await fetch(`${BACKEND}/api/portfolio`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ action: "fetch", userId }),
    });
    const json = await res.json();
    await bot.deleteMessage(chatId, waitMsg.message_id);
    if (json.success) {
      await bot.sendMessage(chatId, formatter.formatPortfolio(json.data), { parse_mode: "Markdown" });
    } else {
      await bot.sendMessage(chatId, `⚠️ ${json.error || "Could not fetch portfolio."}`);
    }
  } catch (err) {
    await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
    await bot.sendMessage(chatId, "⚠️ Portfolio fetch failed. Please try again.");
  }
}

async function handleAdd(bot, msg, wallet) {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const w      = wallet || (msg.text || "").match(/0x[a-fA-F0-9]{40}|[a-zA-Z0-9_-]+\.near/)?.[0];

  if (!w) return bot.sendMessage(chatId, "Usage: /portfolio add 0xYourWalletAddress");

  try {
    const res  = await fetch(`${BACKEND}/api/portfolio`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ action: "add_wallet", userId, wallet: w }),
    });
    const json = await res.json();
    if (json.success) {
      await bot.sendMessage(chatId, `✅ Wallet added: \`${w}\`\n\nType /portfolio to view your full portfolio.`, { parse_mode: "Markdown" });
    } else {
      await bot.sendMessage(chatId, `⚠️ ${json.error}`);
    }
  } catch {
    await bot.sendMessage(chatId, "⚠️ Failed to add wallet. Please try again.");
  }
}

module.exports = { handle, handleAdd };
