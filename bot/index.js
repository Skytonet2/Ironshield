// bot/index.js
require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const { handleCommand }  = require("./handlers/commandHandler");
const { handleMessage }  = require("./handlers/messageHandler");
const { handleDM }       = require("./handlers/dmHandler");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) { console.error("TELEGRAM_BOT_TOKEN not set"); process.exit(1); }

const bot = new TelegramBot(TOKEN, { polling: true }); // switch to webhook in production
console.log("IronClaw bot started (polling mode)");

bot.on("message", async (msg) => {
  try {
    const isGroup   = msg.chat.type !== "private";
    const isCommand = msg.text?.startsWith("/");

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
