// bot/commands/report.js — report scam URLs or wallets
const fetch   = require("node-fetch");
const BACKEND = process.env.BACKEND_URL || "http://localhost:3001";

async function handle(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const text   = (msg.text || "").trim();
  const args   = text.replace(/^\/report\s*/i, "").trim();

  if (!args) {
    return bot.sendMessage(chatId,
      "Usage:\n/report https://scam-site.com — report a scam URL\n/report scammer.near — report a scam wallet\n/report <description> — describe suspicious activity"
    );
  }

  const waitMsg = await bot.sendMessage(chatId, "📝 Submitting report...");

  try {
    const isUrl    = args.startsWith("http://") || args.startsWith("https://");
    const isWallet = /^(0x[a-fA-F0-9]{40}|[a-zA-Z0-9_-]+\.near)$/.test(args.split(" ")[0]);

    if (isUrl) {
      await fetch(`${BACKEND}/api/security/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "url", value: args, reason: "Reported via Telegram bot", reported_by: userId }),
      });
      await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
      await bot.sendMessage(chatId,
        `✅ *URL Reported*\n\n\`${args}\`\n\nThank you for helping protect the community. Our team will review this report.`,
        { parse_mode: "Markdown" }
      );
    } else if (isWallet) {
      const wallet = args.split(" ")[0];
      const reason = args.slice(wallet.length).trim() || "Reported via Telegram bot";
      await fetch(`${BACKEND}/api/security/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "wallet", value: wallet, reason, reported_by: userId }),
      });
      await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
      await bot.sendMessage(chatId,
        `✅ *Wallet Reported*\n\n\`${wallet}\`\n\nThank you for the report. We'll investigate this address.`,
        { parse_mode: "Markdown" }
      );
    } else {
      await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
      await bot.sendMessage(chatId,
        `📝 *Report Received*\n\nYour report has been logged. For URL or wallet reports, include the full address.\n\nExample: /report https://scam-site.com`,
        { parse_mode: "Markdown" }
      );
    }
  } catch (err) {
    await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
    await bot.sendMessage(chatId, "⚠️ Failed to submit report. Please try again.");
  }
}

module.exports = { handle };
