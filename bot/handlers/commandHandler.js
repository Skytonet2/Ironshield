// bot/handlers/commandHandler.js
const summary   = require("../commands/summary");
const research  = require("../commands/research");
const verify    = require("../commands/verify");
const portfolio = require("../commands/portfolio");

// 🔒 Escape ALL MarkdownV2 special characters
function escapeMarkdownV2(text) {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

const COMMANDS = {
  "/summary":   summary.handle,
  "/research":  research.handle,
  "/verify":    verify.handle,
  "/portfolio": portfolio.handle,
  "/start":     startHandler,
  "/help":      helpHandler,
};

async function startHandler(bot, msg) {
  const message = `🛡️ IronShield — AI Security Agent

I protect communities and help you research the Web3 space.

Commands:
/research [token] — Research any token
/summary [group] — Summarize a Telegram group
/verify [claim] — Fact-check any claim
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

/research $TOKEN — Token research report
/research 0x... — Contract analysis
/summary @group — Group summary
/summary last 24h — This chat summary
/verify [claim] — Fact-check
/portfolio — Your wallets
/portfolio add 0x... — Add wallet`;

  await bot.sendMessage(
    msg.chat.id,
    escapeMarkdownV2(message),
    { parse_mode: "MarkdownV2" }
  );
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