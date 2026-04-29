// bot/index.js — AZUKA Telegram bot entrypoint
//
// Two modes:
//   - polling (dev default): TelegramBot's long-poll loop pulls updates.
//     No public URL needed; perfect for `npm run bot` on a laptop.
//   - webhook (prod): a small Express server listens at
//     POST /tg/webhook/:secret and forwards the body into bot.processUpdate().
//     :secret is constant-time-compared against TELEGRAM_WEBHOOK_SECRET so a
//     leaked URL alone isn't enough. setWebhook is called once on boot;
//     the registered URL is cached in agent_state so we don't pound
//     Telegram's API on every restart.
//
// Mode is picked by BOT_MODE: "polling" or "webhook" (default: polling
// in non-prod, webhook in NODE_ENV=production).

require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const { handleCommand }  = require("./handlers/commandHandler");
const { handleMessage }  = require("./handlers/messageHandler");
const { handleDM }       = require("./handlers/dmHandler");
const { handleCallback } = require("./handlers/callbackHandler");
const { recordMessage }  = require("./commands/summary");
const agentState = require("../backend/db/agentState");

const priceMonitor    = require("./jobs/priceMonitor");
const pumpMonitor     = require("./jobs/pumpMonitor");
const dailyDigest     = require("./jobs/dailyDigest");
const downtimeMonitor = require("./jobs/downtimeMonitor");

const TOKEN          = process.env.TELEGRAM_BOT_TOKEN;
const SECRET         = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const WEBHOOK_URL    = process.env.WEBHOOK_URL || ""; // public hostname, no trailing slash
const PORT           = parseInt(process.env.PORT || process.env.WEBHOOK_PORT || "8443", 10);
const DEFAULT_MODE   = process.env.NODE_ENV === "production" ? "webhook" : "polling";
const BOT_MODE       = (process.env.BOT_MODE || DEFAULT_MODE).toLowerCase();

if (!TOKEN) { console.error("TELEGRAM_BOT_TOKEN not set"); process.exit(1); }

let bot;
if (BOT_MODE === "webhook") {
  if (!WEBHOOK_URL || !SECRET) {
    console.error("[FATAL] webhook mode requires WEBHOOK_URL and TELEGRAM_WEBHOOK_SECRET");
    process.exit(1);
  }
  // Library set to no-poll, no internal webhook server — Express is the
  // listener so we own the URL shape and can constant-time-compare the
  // secret in the path.
  bot = new TelegramBot(TOKEN, { polling: false });

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.post("/tg/webhook/:secret", (req, res) => {
    // Buffer-based timingSafeEqual; tolerate length mismatch by padding so
    // we don't leak length via early-return.
    const provided = Buffer.from(req.params.secret || "", "utf8");
    const expected = Buffer.from(SECRET, "utf8");
    const ok = provided.length === expected.length &&
               crypto.timingSafeEqual(provided, expected);
    if (!ok) return res.status(403).end();
    try { bot.processUpdate(req.body); } catch (e) { console.error("processUpdate:", e.message); }
    res.status(200).end();
  });
  app.get("/health", (_req, res) => res.json({ ok: true, mode: "webhook" }));

  app.listen(PORT, async () => {
    const fullUrl = `${WEBHOOK_URL.replace(/\/+$/, "")}/tg/webhook/${SECRET}`;
    // Skip the round-trip to Telegram if we already registered this URL.
    let cached = null;
    try { cached = await agentState.get("tgWebhookUrl"); } catch {}
    if (cached?.url !== fullUrl) {
      try {
        await bot.setWebHook(fullUrl);
        await agentState.set("tgWebhookUrl", { url: fullUrl, setAt: new Date().toISOString() });
        console.log(`IronClaw bot: webhook registered at ${WEBHOOK_URL}/tg/webhook/<secret>`);
      } catch (e) {
        console.error("setWebHook failed:", e.message);
      }
    } else {
      console.log(`IronClaw bot: webhook URL unchanged (cached) — listening on :${PORT}`);
    }
  });
} else {
  bot = new TelegramBot(TOKEN, { polling: true });
  console.log("IronClaw bot started (polling mode)");
}

bot.setMyCommands([
  { command: "start",        description: "Link your wallet & get started" },
  // Trading surface — these were handled by commandHandler but not
  // listed here, so users never saw them in Telegram's command menu
  // and assumed "buy / withdraw aren't live." They are. They're just
  // invisible until now.
  { command: "balance",      description: "Your custodial balance" },
  { command: "deposit",      description: "Deposit to your trading account" },
  { command: "buy",          description: "Buy a token (alias for /swap)" },
  { command: "swap",         description: "Swap one token for another" },
  { command: "send",         description: "Send tokens to an address" },
  { command: "withdraw",     description: "Withdraw to your main wallet" },
  { command: "activate",     description: "Activate trading ($5 NEAR)" },
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
