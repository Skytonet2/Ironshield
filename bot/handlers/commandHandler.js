// bot/handlers/commandHandler.js

const summary   = require("../commands/summary");
const research  = require("../commands/research");
const verify    = require("../commands/verify");
const portfolio = require("../commands/portfolio");
const scan      = require("../commands/scan");
const alert     = require("../commands/alert");
const report    = require("../commands/report");
const trending  = require("../commands/trending");
const link      = require("../commands/link");
const wallets   = require("../commands/wallets");
const settings  = require("../commands/settings");
const watch     = require("../commands/watch");
const tip       = require("../commands/tip");
const digest    = require("../commands/digest");
const custodial = require("../commands/custodial");
const vote      = require("../commands/vote");

function escapeMarkdownV2(text) {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

const COMMANDS = {
  "/start":     link.handleStart,
  "/link":      link.handleStart,
  "/help":      helpHandler,
  "/status":    statusHandler,

  "/summary":   summary.handle,
  "/summarize": summary.handle,
  "/digest":    digest.handle,

  "/research":  research.handle,
  "/verify":    verify.handle,
  "/scan":      scan.handle,
  "/trending":  trending.handle,
  "/trends":    trending.handle,
  "/report":    report.handle,

  "/portfolio": portfolio.handle,
  "/addwallet": wallets.handleAddWallet,
  "/wallets":   wallets.handleWallets,
  "/removewallet": wallets.handleRemoveWallet,

  "/settings":  settings.handleSettings,

  "/watch":     watch.handleWatch,
  "/unwatch":   watch.handleUnwatch,
  "/watchlist": watch.handleWatchlist,

  "/alert":     alert.handle,
  "/tip":       tip.handle,
  "/vote":      vote.handle,

  // Phase 7 — custodial trading account
  "/deposit":   custodial.handleDeposit,
  "/balance":   custodial.handleBalance,
  "/activate":  custodial.handleActivate,
  "/swap":      custodial.handleSwap,
  // /buy is an ergonomic alias for /swap — users instinctively type
  // /buy when they want to acquire a token, /swap when they want to
  // rebalance. Both paths go to the same intent parser which reads
  // "buy 0.1 sol" and "swap usdc for sol" identically.
  "/buy":       custodial.handleSwap,
  "/send":      custodial.handleSend,
  "/withdraw":  custodial.handleWithdraw,
};

async function helpHandler(bot, msg) {
  const message = `*IronShield Bot — Commands*

🔗 *Onboarding*
• Paste any wallet address to link it
• /wallets — switch between linked wallets
• /addwallet <address>
• /settings — toggle alert types

💰 *Trading account (custodial)*
• /activate — one-time setup ($5 NEAR)
• /balance — what's in your trading account
• /deposit — deposit to trade fast
• /buy 0.1 sol — buy a token
• /swap 10 usdc for near — swap tokens
• /send 1 near to alice.near — send tokens
• /withdraw — pull everything to your main wallet

💼 *Top features*
• /portfolio — instant overview
• /watch $TOKEN or @user — targeted alerts
• /alert $TOKEN 10x — price alert (also 5%, above $X, below $X)
• /tip @user 1 NEAR — send a tip
• /digest — 24h summary (auto-sent 8 AM)
• /vote — list active proposals; /vote <id> for detail

🔍 *Research & Intel*
• /research $TOKEN — token report
• /summary — this chat
• /verify <claim>
• /trending — live market

🛡 *Security*
• /scan <url|wallet>
• /report <url|wallet>

ℹ️ /status — bot health`;

  await bot.sendMessage(msg.chat.id, escapeMarkdownV2(message), { parse_mode: "MarkdownV2" });
}

async function statusHandler(bot, msg) {
  const uptime = process.uptime();
  const h = Math.floor(uptime / 3600);
  const m = Math.floor((uptime % 3600) / 60);
  const text = `🛡 *IronShield Status*\n\n✅ Bot: Online\n⏱ Uptime: ${h}h ${m}m\n🤖 Engine: NEAR AI\n📡 Mode: Polling\n\nSite: ironshield.near.page`;
  await bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
}

async function handleCommand(bot, msg) {
  const text = msg.text || "";
  const command = text.split(" ")[0].toLowerCase().split("@")[0];
  const handler = COMMANDS[command];
  if (handler) {
    await handler(bot, msg);
  } else {
    await bot.sendMessage(msg.chat.id, "Unknown command. Try /help");
  }
}

module.exports = { handleCommand };
