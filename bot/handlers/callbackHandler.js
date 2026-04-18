// bot/handlers/callbackHandler.js — inline-button callbacks

const { handleWalletCallback }   = require("../commands/wallets");
const { handleSettingsCallback } = require("../commands/settings");
const { tg } = require("../services/backend");

async function handleCallback(bot, cq) {
  const data = cq.data || "";

  try {
    if (data.startsWith("wallet:")) {
      await handleWalletCallback(bot, cq);
      return;
    }
    if (data.startsWith("set:")) {
      await handleSettingsCallback(bot, cq);
      return;
    }
    if (data.startsWith("notify:dismiss")) {
      await bot.answerCallbackQuery(cq.id, { text: "Dismissed" });
      await bot.deleteMessage(cq.message.chat.id, cq.message.message_id).catch(() => {});
      return;
    }
    if (data === "help:commands") {
      await bot.answerCallbackQuery(cq.id);
      await bot.sendMessage(cq.message.chat.id, "Type /help for the full command list.");
      return;
    }
    await bot.answerCallbackQuery(cq.id);
  } catch (e) {
    console.warn("[callback] error:", e.message);
    try { await bot.answerCallbackQuery(cq.id, { text: "Error" }); } catch {}
  }
}

module.exports = { handleCallback };
