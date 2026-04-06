// bot/commands/verify.js
const fetch     = require("node-fetch");
const formatter = require("../utils/formatter");
const BACKEND   = process.env.BACKEND_URL || "http://localhost:3001";

async function handle(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const text   = msg.text || "";

  const claim = text
    .replace(/^\/verify\s*/i, "")
    .replace(/^(verify|is this true|fact check|is it true)[:\s]*/i, "")
    .trim();

  if (!claim) {
    return bot.sendMessage(chatId, "Usage: /verify [claim to fact-check]");
  }

  const waitMsg = await bot.sendMessage(chatId, "✅ Checking claim...");

  try {
    const res  = await fetch(`${BACKEND}/api/verify`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ claim, context: "Telegram", userId }),
    });
    const json = await res.json();
    await bot.deleteMessage(chatId, waitMsg.message_id);
    if (json.success) {
      await bot.sendMessage(chatId, formatter.formatVerify(json.data), { parse_mode: "Markdown" });
    } else {
      await bot.sendMessage(chatId, `⚠️ ${json.error || "Verification failed."}`);
    }
  } catch (err) {
    await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
    await bot.sendMessage(chatId, "⚠️ Verification failed. Please try again.");
  }
}

module.exports = { handle };
