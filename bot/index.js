// bot/index.js — IronShield Telegram bot entrypoint
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { handleCommand }  = require("./handlers/commandHandler");
const { handleMessage }  = require("./handlers/messageHandler");
const { handleDM }       = require("./handlers/dmHandler");
const { handleCallback } = require("./handlers/callbackHandler");
const { recordMessage }  = require("./commands/summary");

const priceMonitor    = require("./jobs/priceMonitor");
const pumpMonitor     = require("./jobs/pumpMonitor");
const dailyDigest     = require("./jobs/dailyDigest");
const downtimeMonitor = require("./jobs/downtimeMonitor");

const TOKEN        = process.env.TELEGRAM_BOT_TOKEN;
const USE_WEBHOOK  = process.env.BOT_MODE === "webhook";
const WEBHOOK_URL  = process.env.WEBHOOK_URL || ""; // e.g. https://ironclaw.com/bot
const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || "8443", 10);

if (!TOKEN) { console.error("TELEGRAM_BOT_TOKEN not set"); process.exit(1); }

// Production uses webhook mode (no long-poll, Telegram pushes updates).
// Dev falls back to polling so running the bot locally requires no
// public URL. The monitor jobs + autonomous loop run regardless of mode
// since they're timer-driven rather than update-driven.
let bot;
if (USE_WEBHOOK && WEBHOOK_URL) {
  bot = new TelegramBot(TOKEN, { webHook: { port: WEBHOOK_PORT } });
  bot.setWebHook(`${WEBHOOK_URL}/bot${TOKEN}`);
  console.log(`IronClaw bot started (webhook mode → ${WEBHOOK_URL})`);
} else {
  bot = new TelegramBot(TOKEN, { polling: true });
  console.log("IronClaw bot started (polling mode)");
}

bot.setMyCommands([
  { command: "start",        description: "Link your wallet & get started" },
  { command: "portfolio",    description: "Instant portfolio overview" },
  { command: "wallets",      description: "Switch or list linked wallets" },
  { command: "addwallet",    description: "Add another wallet" },
  { command: "settings",     description: "Toggle notification types" },
  { command: "watch",        description: "Watch a token or user" },
  { command: "watchlist",    description: "Your watchlist" },
  { command: "alert",        description: "Price alerts: 10x, 5%, above/below" },
  { command: "tip",          description: "Send a tip from Telegram" },
  { command: "digest",       description: "24h activity digest (auto 8 AM)" },
  { command: "research",     description: "Research any token or contract" },
  { command: "summary",      description: "Summarize recent chat" },
  { command: "trending",     description: "Live market signals" },
  { command: "scan",         description: "Scan a URL or wallet" },
  { command: "verify",       description: "Fact-check a claim" },
  { command: "report",       description: "Report a scam" },
  { command: "help",         description: "Show all commands" },
  { command: "status",       description: "Bot health" },
]).then(() => console.log("Bot commands menu registered"))
  .catch((e) => console.error("Failed to set commands:", e.message));

bot.on("message", async (msg) => {
  try {
    console.log(`[MSG] chat=${msg.chat.id} type=${msg.chat.type} from=${msg.from?.username || msg.from?.id} text="${(msg.text || "").slice(0, 60)}"`);
    const isGroup   = msg.chat.type !== "private";
    const isCommand = msg.text?.startsWith("/");

    if (!isCommand && msg.text) recordMessage(msg);

    if (isCommand) {
      await handleCommand(bot, msg);
    } else if (isGroup) {
      await handleMessage(bot, msg);
    } else {
      await handleDM(bot, msg);
    }
  } catch (err) {
    console.error("Bot message handler error:", err);
  }
});

bot.on("callback_query", async (cq) => {
  try {
    await handleCallback(bot, cq);
  } catch (err) {
    console.error("Bot callback error:", err);
  }
});

bot.on("polling_error", (err) => console.error("Polling error:", err.message));

// ─── Background jobs ───────────────────────────────────────────────
try { priceMonitor.start(bot); }    catch (e) { console.warn("priceMonitor start failed:", e.message); }
try { pumpMonitor.start(bot); }     catch (e) { console.warn("pumpMonitor start failed:", e.message); }
try { dailyDigest.start(bot); }     catch (e) { console.warn("dailyDigest start failed:", e.message); }
try { downtimeMonitor.start(bot); } catch (e) { console.warn("downtimeMonitor start failed:", e.message); }

module.exports = bot;
