// bot/commands/portfolio.js — instant portfolio overview via linked wallets

const fetch = require("node-fetch");
const formatter = require("../utils/formatter");
const { tg, BACKEND } = require("../services/backend");
const { detectWallet, shortWallet } = require("../utils/wallet");

async function fetchPortfolio(wallets, tgId) {
  const r = await fetch(`${BACKEND}/api/portfolio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "fetch", userId: `tg:${tgId}`, wallets }),
  });
  return r.json();
}

async function handle(bot, msg) {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  const parts = text.trim().split(/\s+/);

  // Legacy: /portfolio add 0x... → route to /addwallet semantics
  if (parts[1] === "add" && parts[2]) return handleAdd(bot, msg, parts[2]);
  if (parts[1] === "remove" && parts[2]) {
    const w = detectWallet(parts[2]);
    if (!w) return bot.sendMessage(chatId, "Pass a valid wallet address.");
    await tg.removeWallet(msg.from.id, w);
    return bot.sendMessage(chatId, `🗑 Removed \`${shortWallet(w)}\``, { parse_mode: "Markdown" });
  }

  const s = await tg.settings(msg.from.id);
  const wallets = s.ok ? (s.wallets || []) : [];
  if (!wallets.length) {
    return bot.sendMessage(chatId, "No wallets linked. Paste your wallet address here to connect — then try /portfolio again.");
  }

  const wait = await bot.sendMessage(chatId, "💼 Pulling your portfolio…");
  try {
    const json = await fetchPortfolio(wallets, msg.from.id);
    await bot.deleteMessage(chatId, wait.message_id).catch(() => {});
    if (!json.success) {
      return bot.sendMessage(chatId, `⚠️ ${json.error || "Could not fetch portfolio."}`);
    }

    const header = `*💼 Portfolio*  (${wallets.length} wallet${wallets.length > 1 ? "s" : ""})\nActive: \`${shortWallet(s.activeWallet)}\`\n\n`;
    const body = formatter.formatPortfolio(json.data);

    // Inline quick-actions: tip, switch wallet.
    const kb = [[
      { text: "🔁 Switch wallet", callback_data: "wallet:list" },
      { text: "💸 Send tip", url: "https://ironshield.near.page/#/Feed" },
    ]];

    await bot.sendMessage(chatId, header + body, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: kb },
    });
  } catch {
    await bot.deleteMessage(chatId, wait.message_id).catch(() => {});
    await bot.sendMessage(chatId, "⚠️ Portfolio fetch failed. Please try again.");
  }
}

async function handleAdd(bot, msg, wallet) {
  const w = wallet || detectWallet(msg.text || "");
  if (!w) return bot.sendMessage(msg.chat.id, "Usage: /addwallet <address>");
  const r = await tg.addWallet(msg.from.id, w);
  if (r.ok) {
    await bot.sendMessage(msg.chat.id, `✅ Added \`${shortWallet(w)}\`. Total: ${r.wallets.length}. Use /wallets to switch.`, { parse_mode: "Markdown" });
  } else {
    await bot.sendMessage(msg.chat.id, `⚠️ ${r.error}`);
  }
}

module.exports = { handle, handleAdd };
