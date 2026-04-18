// bot/commands/watch.js — /watch /unwatch /watchlist

const { tg } = require("../services/backend");

function parseWatch(text = "") {
  // /watch $TOKEN or /watch @user
  const m = text.match(/\/\w+\s+(.+)$/);
  if (!m) return null;
  const raw = m[1].trim();
  if (raw.startsWith("@")) return { kind: "user", value: raw.slice(1).toLowerCase() };
  const token = raw.replace(/^\$/, "").toUpperCase();
  return { kind: "token", value: token };
}

async function handleWatch(bot, msg) {
  const chatId = msg.chat.id;
  const parsed = parseWatch(msg.text || "");
  if (!parsed) return bot.sendMessage(chatId, "Usage: `/watch $TOKEN` or `/watch @username`", { parse_mode: "Markdown" });
  const r = await tg.addWatch(msg.from.id, parsed.kind, parsed.value);
  await bot.sendMessage(
    chatId,
    r.ok ? `👁 Watching ${parsed.kind === "user" ? "@" : "$"}${parsed.value}` : `⚠️ ${r.error}`
  );
}

async function handleUnwatch(bot, msg) {
  const parsed = parseWatch(msg.text || "");
  if (!parsed) return bot.sendMessage(msg.chat.id, "Usage: /unwatch $TOKEN or /unwatch @user");
  await tg.removeWatch(msg.from.id, parsed.kind, parsed.value);
  await bot.sendMessage(msg.chat.id, `🚫 Unwatched ${parsed.kind === "user" ? "@" : "$"}${parsed.value}`);
}

async function handleWatchlist(bot, msg) {
  const r = await tg.watchlist(msg.from.id);
  if (!r.ok) return bot.sendMessage(msg.chat.id, "Link a wallet first.");
  const items = r.items || [];
  if (!items.length) return bot.sendMessage(msg.chat.id, "Watchlist is empty. Add one with /watch $TOKEN or /watch @user.");
  const lines = items.map(i => `• ${i.kind === "user" ? "@" : "$"}${i.value}`);
  await bot.sendMessage(msg.chat.id, `*Your watchlist*\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
}

module.exports = { handleWatch, handleUnwatch, handleWatchlist };
