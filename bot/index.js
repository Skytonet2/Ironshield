// bot/index.js
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { handleCommand }  = require("./handlers/commandHandler");
const { handleMessage }  = require("./handlers/messageHandler");
const { handleDM }       = require("./handlers/dmHandler");
const { recordMessage }  = require("./commands/summary");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) { console.error("TELEGRAM_BOT_TOKEN not set"); process.exit(1); }

const bot = new TelegramBot(TOKEN, { polling: true }); // switch to webhook in production
console.log("IronClaw bot started (polling mode)");

// Register command menu so Telegram shows suggestions when users type /
bot.setMyCommands([
  { command: "research",  description: "Research any token or contract" },
  { command: "verify",    description: "Fact-check a claim" },
  { command: "scan",      description: "Scan a URL or wallet for threats" },
  { command: "summary",   description: "Summarize recent chat messages" },
  { command: "alert",     description: "Set a price alert for a token" },
  { command: "portfolio", description: "View your tracked wallets" },
  { command: "report",    description: "Report a scam URL or wallet" },
  { command: "status",    description: "Check bot status and uptime" },
  { command: "help",      description: "Show all available commands" },
]).then(() => console.log("Bot commands menu registered"))
  .catch(err => console.error("Failed to set commands:", err));

bot.on("message", async (msg) => {
  try {
    console.log(`[MSG] chat=${msg.chat.id} type=${msg.chat.type} from=${msg.from?.username || msg.from?.id} text="${(msg.text || "").slice(0, 60)}"`);
    const isGroup   = msg.chat.type !== "private";
    const isCommand = msg.text?.startsWith("/");

    // Record all non-command messages for /summary context
    if (!isCommand && msg.text) recordMessage(msg);

    if (isCommand) {
      await handleCommand(bot, msg);
    } else if (isGroup) {
      await handleMessage(bot, msg); // passive security scan
    } else {
      await handleDM(bot, msg);      // full assistant mode in DMs
    }
  } catch (err) {
    console.error("Bot message handler error:", err);
  }
});

bot.on("polling_error", (err) => console.error("Polling error:", err));

module.exports = bot;
