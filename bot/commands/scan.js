// bot/commands/scan.js — scan URLs and wallet addresses for threats
const fetch   = require("node-fetch");
const BACKEND = process.env.BACKEND_URL || "http://localhost:3001";

async function handle(bot, msg) {
  const chatId = msg.chat.id;
  const text   = msg.text || "";
  const target = text.replace(/^\/scan(@\w+)?\s*/i, "").trim();

  if (!target) {
    return bot.sendMessage(chatId, "Usage: /scan <url or wallet address>\n\nExamples:\n/scan https://suspicious-site.com\n/scan scammer.near");
  }

  const waitMsg = await bot.sendMessage(chatId, "🔍 Scanning...");

  try {
    // Detect if it's a URL or wallet
    const isUrl = target.startsWith("http://") || target.startsWith("https://");
    let result;

    if (isUrl) {
      const res = await fetch(`${BACKEND}/api/security/check-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target }),
      });
      result = await res.json();
      await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});

      if (result.data?.flagged) {
        await bot.sendMessage(chatId,
          `🚨 *DANGER — Flagged URL*\n\n\`${target}\`\n\n⚠️ Reason: ${result.data.reason}\n\n❌ Do NOT click this link.`,
          { parse_mode: "Markdown" }
        );
      } else {
        await bot.sendMessage(chatId,
          `✅ *URL Scan Complete*\n\n\`${target}\`\nDomain: ${result.data?.domain || "unknown"}\n\nNo known threats detected.\n\n⚠️ Always verify URLs independently.`,
          { parse_mode: "Markdown" }
        );
      }
    } else {
      // Wallet scan
      const res = await fetch(`${BACKEND}/api/security/check-wallet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: target }),
      });
      result = await res.json();
      await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});

      if (result.data?.flagged) {
        await bot.sendMessage(chatId,
          `🚨 *DANGER — Flagged Wallet*\n\n\`${target}\`\n\n⚠️ Reason: ${result.data.reason}\n\n❌ Do NOT send funds to this address.`,
          { parse_mode: "Markdown" }
        );
      } else {
        await bot.sendMessage(chatId,
          `✅ *Wallet Scan Complete*\n\n\`${target}\`\n\nNo known flags on this address.\n\n⚠️ Always DYOR before sending funds.`,
          { parse_mode: "Markdown" }
        );
      }
    }
  } catch (err) {
    await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
    await bot.sendMessage(chatId, "⚠️ Scan failed. The security service may be offline.");
  }
}

module.exports = { handle };
