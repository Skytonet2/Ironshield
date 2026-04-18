// bot/commands/wallets.js — /wallets, /addwallet, /removewallet, switcher

const { tg } = require("../services/backend");
const { detectWallet, shortWallet } = require("../utils/wallet");

async function handleWallets(bot, msg) {
  const chatId = msg.chat.id;
  const s = await tg.settings(msg.from.id);
  if (!s.ok) return bot.sendMessage(chatId, "Link a wallet first — just send it to me, or /start.");
  const wallets = s.wallets || [];
  if (!wallets.length) return bot.sendMessage(chatId, "No wallets linked yet. Paste one to connect.");

  const keyboard = wallets.map((w) => [{
    text: (w === s.activeWallet ? "⭐ " : "   ") + shortWallet(w),
    callback_data: `wallet:set:${w}`,
  }]);
  keyboard.push([{ text: "➕ Add wallet", callback_data: "wallet:addprompt" }]);

  await bot.sendMessage(
    chatId,
    `*Your wallets* (${wallets.length})\n\nActive: \`${s.activeWallet || "none"}\`\n\nTap to switch active:`,
    { parse_mode: "Markdown", reply_markup: { inline_keyboard: keyboard } }
  );
}

async function handleAddWallet(bot, msg) {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  const parts = text.trim().split(/\s+/);
  const wallet = parts[1] ? detectWallet(parts[1]) : null;

  if (!wallet) {
    return bot.sendMessage(chatId, "Usage: `/addwallet <address>` — or just paste the address.\n\nExamples:\n• `/addwallet alice.near`\n• `/addwallet 0x1234…`", { parse_mode: "Markdown" });
  }
  const r = await tg.addWallet(msg.from.id, wallet);
  if (!r.ok) return bot.sendMessage(chatId, `⚠️ ${r.error || "Failed to add wallet"}`);
  await bot.sendMessage(
    chatId,
    `✅ Added \`${shortWallet(wallet)}\`. Active: \`${shortWallet(r.activeWallet)}\` (${r.wallets.length} total). Use /wallets to switch.`,
    { parse_mode: "Markdown" }
  );
}

async function handleRemoveWallet(bot, msg) {
  const chatId = msg.chat.id;
  const parts = (msg.text || "").trim().split(/\s+/);
  const wallet = parts[1] ? detectWallet(parts[1]) : null;
  if (!wallet) return bot.sendMessage(chatId, "Usage: /removewallet <address>");
  const r = await tg.removeWallet(msg.from.id, wallet);
  await bot.sendMessage(chatId, r.ok ? `🗑 Removed \`${shortWallet(wallet)}\`` : `⚠️ ${r.error}`, { parse_mode: "Markdown" });
}

// Callback handler: fired from /wallets inline buttons.
async function handleWalletCallback(bot, cq) {
  const data = cq.data || "";
  const chatId = cq.message.chat.id;
  const tgId = cq.from.id;

  if (data.startsWith("wallet:set:")) {
    const wallet = data.slice("wallet:set:".length);
    await tg.updateSettings({ tgId, activeWallet: wallet });
    await bot.answerCallbackQuery(cq.id, { text: `Active: ${shortWallet(wallet)}` });
    const s = await tg.settings(tgId);
    const kb = (s.wallets || []).map((w) => [{
      text: (w === s.activeWallet ? "⭐ " : "   ") + shortWallet(w),
      callback_data: `wallet:set:${w}`,
    }]);
    kb.push([{ text: "➕ Add wallet", callback_data: "wallet:addprompt" }]);
    await bot.editMessageReplyMarkup({ inline_keyboard: kb }, { chat_id: chatId, message_id: cq.message.message_id }).catch(() => {});
    return;
  }
  if (data === "wallet:addprompt") {
    await bot.answerCallbackQuery(cq.id);
    await bot.sendMessage(chatId, "Paste the wallet address to add:");
    return;
  }
}

module.exports = { handleWallets, handleAddWallet, handleRemoveWallet, handleWalletCallback };
