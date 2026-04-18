// bot/commands/settings.js — /settings toggles for notification types

const { tg } = require("../services/backend");

const TOGGLES = [
  { key: "likes",        label: "👍 Likes" },
  { key: "reposts",      label: "🔁 Reposts" },
  { key: "comments",     label: "💬 Comments" },
  { key: "follows",      label: "👥 Follows" },
  { key: "tips",         label: "💰 Tips" },
  { key: "dms",          label: "📨 DMs (with reply)" },
  { key: "coin_created", label: "🪙 Your new tokens" },
  { key: "pump",         label: "📈 Pump / volume surges" },
  { key: "alpha",        label: "🚨 Alpha news" },
  { key: "downtime",     label: "🛠 Site downtime" },
];

function buildKeyboard(settings = {}) {
  return TOGGLES.map((t) => ([{
    text: `${settings[t.key] === false ? "❌" : "✅"}  ${t.label}`,
    callback_data: `set:toggle:${t.key}`,
  }]));
}

async function handleSettings(bot, msg) {
  const chatId = msg.chat.id;
  const s = await tg.settings(msg.from.id);
  if (!s.ok) return bot.sendMessage(chatId, "Link a wallet first — just paste your address here.");
  await bot.sendMessage(
    chatId,
    "*Notification settings*\nTap to toggle each alert on/off. Defaults are all on.",
    { parse_mode: "Markdown", reply_markup: { inline_keyboard: buildKeyboard(s.settings || {}) } }
  );
}

async function handleSettingsCallback(bot, cq) {
  const data = cq.data || "";
  if (!data.startsWith("set:toggle:")) return false;
  const key = data.slice("set:toggle:".length);
  const tgId = cq.from.id;
  const chatId = cq.message.chat.id;
  const s = await tg.settings(tgId);
  const current = s.settings || {};
  const next = { ...current, [key]: current[key] === false };
  await tg.updateSettings({ tgId, settings: { [key]: next[key] } });
  await bot.answerCallbackQuery(cq.id, { text: `${key}: ${next[key] ? "ON" : "OFF"}` });
  await bot.editMessageReplyMarkup(
    { inline_keyboard: buildKeyboard(next) },
    { chat_id: chatId, message_id: cq.message.message_id }
  ).catch(() => {});
  return true;
}

module.exports = { handleSettings, handleSettingsCallback, TOGGLES };
