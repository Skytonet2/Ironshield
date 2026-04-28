// backend/connectors/tg/index.js
//
// Telegram connector. Wraps backend/services/tgNotify.js so callers
// route through the dispatcher (and the rate-limit hub).
//
// Auth model: shared platform bot token (TELEGRAM_BOT_TOKEN). Per-user
// chat resolution happens via feed_tg_links (rawSend takes a chat_id;
// notifyWallet takes a wallet and resolves internally). Because the
// outbound key is platform-wide, rate_limits.scope is 'platform' so all
// callers share one bucket — Telegram's bot-API quota is global per
// bot, not per user.

const tg = require("../../services/tgNotify");

async function invoke(action, ctx = {}) {
  const params = ctx.params || {};
  switch (action) {
    case "rawSend": {
      const { chatId, text, opts } = params;
      if (!chatId || !text) throw new Error("rawSend: { chatId, text } required");
      return tg.rawSend(chatId, text, opts || {});
    }
    case "notifyWallet": {
      const { wallet, settingKey, text, opts } = params;
      if (!wallet || !text) throw new Error("notifyWallet: { wallet, text } required");
      return tg.notifyWallet(wallet, settingKey, text, opts || {});
    }
    case "notifyFeedUser": {
      const { userId, settingKey, text, opts } = params;
      if (!userId || !text) throw new Error("notifyFeedUser: { userId, text } required");
      return tg.notifyFeedUser(userId, settingKey, text, opts || {});
    }
    case "broadcast": {
      const { settingKey, text, opts } = params;
      if (!text) throw new Error("broadcast: { text } required");
      return tg.broadcast(settingKey, text, opts || {});
    }
    default:
      throw new Error(`tg connector: unknown action ${action}`);
  }
}

module.exports = {
  name: "tg",
  capabilities: ["write", "monitor"],
  // Telegram bot API allows ~30 msg/sec to different chats, ~1/sec
  // to the same chat. Conservative platform-wide cap: 600/min keeps
  // us well under the soft limit while still letting a fan-out broadcast
  // run through.
  rate_limits: { per_minute: 600, scope: "platform" },
  auth_method: "api_key",
  invoke,
};
