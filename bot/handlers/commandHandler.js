// bot/handlers/commandHandler.js
const summary   = require("../commands/summary");
const research  = require("../commands/research");
const verify    = require("../commands/verify");
const portfolio = require("../commands/portfolio");
const scan      = require("../commands/scan");
const alert     = require("../commands/alert");
const report    = require("../commands/report");

// Escape ALL MarkdownV2 special characters
function escapeMarkdownV2(text) {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

const COMMANDS = {
  "/summary":   summary.handle,
  "/research":  research.handle,
  "/verify":    verify.handle,
  "/portfolio": portfolio.handle,
  "/scan":      scan.handle,
  "/alert":     alert.handle,
  "/report":    report.handle,
  "/start":     startHandler,
  "/help":      helpHandler,
  "/status":    statusHandler,
};

async function startHandler(bot, msg) {
  const message = `🛡️ IronShield — AI Security Agent

I protect communities and help you research the Web3 space.

Commands:
/research [token] — Research any token
/summary [group] — Summarize a Telegram group
/verify [claim] — Fact-check any claim
/scan [url/wallet] — Scan for threats
/alert [token] above/below [price] — Price alerts
/report [url/wallet] — Report a scam
/portfolio — View your tracked wallets

In DMs, you can just type naturally — no commands needed.`;

  await bot.sendMessage(
    msg.chat.id,
    escapeMarkdownV2(message),
    { parse_mode: "MarkdownV2" }
  );
}

async function helpHandler(bot, msg) {
  const message = `*IronClaw Commands*

🔍 Research & Intel
/research $TOKEN — Token research report
/research 0x... — Contract analysis
/summary @group — Group summary
/summary last 24h — This chat summary
/verify [claim] — Fact-check

🛡️ Security
/scan [url] — Check a URL for threats
/scan [wallet] — Check a wallet address
/report [url/wallet] — Report a scam

💼 Portfolio & Alerts
/portfolio — Your wallets
/portfolio add 0x... — Add wallet
/alert NEAR above $10 — Set price alert
/alert list — View your alerts

ℹ️ /status — Bot status`;

  await bot.sendMessage(
    msg.chat.id,
    escapeMarkdownV2(message),
    { parse_mode: "MarkdownV2" }
  );
}

async function statusHandler(bot, msg) {
  const uptime = process.uptime();
  const hours  = Math.floor(uptime / 3600);
  const mins   = Math.floor((uptime % 3600) / 60);

  const message = `🛡️ *IronShield Status*

✅ Bot: Online
⏱ Uptime: ${hours}h ${mins}m
🤖 Engine: NEAR AI
🔒 Security: Active
📡 Mode: Polling

Website: ironshield.near.page
Contract: ironshield.near`;

  await bot.sendMessage(msg.chat.id, message, { parse_mode: "Markdown" });
}

async function handleCommand(bot, msg) {
  const text    = msg.text || "";
  const command = text.split(" ")[0].toLowerCase().split("@")[0];
  const handler = COMMANDS[command];

  if (handler) {
    await handler(bot, msg);
  } else {
    await bot.sendMessage(msg.chat.id, "Unknown command. Try /help");
  }
}

module.exports = { handleCommand };
