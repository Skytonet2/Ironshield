// bot/handlers/dmHandler.js — natural language DM mode with IronClaw AI
const fetch     = require("node-fetch");
const summary   = require("../commands/summary");
const research  = require("../commands/research");
const verify    = require("../commands/verify");
const portfolio = require("../commands/portfolio");
const scan      = require("../commands/scan");
const alert     = require("../commands/alert");
const report    = require("../commands/report");
const trending  = require("../commands/trending");
const link      = require("../commands/link");
const { tg }    = require("../services/backend");

const BACKEND = process.env.BACKEND_URL || "http://localhost:3001";

const INTENTS = [
  { patterns: ["summarize", "summary of", "what happened in", "tldr"],             handler: summary.handle },
  { patterns: ["research", "analyse", "analyze", "check token", "tell me about"],  handler: research.handle },
  { patterns: ["verify", "is this true", "fact check", "is it true"],              handler: verify.handle },
  { patterns: ["portfolio", "my wallet", "my balance", "how much", "net worth"],   handler: portfolio.handle },
  { patterns: ["add wallet", "track wallet"],                                       handler: portfolio.handleAdd },
  { patterns: ["scan", "is this safe", "check this link", "check url"],            handler: scan.handle },
  { patterns: ["alert me", "notify me", "price alert", "set alert"],               handler: alert.handle },
  { patterns: ["report scam", "report this", "flag this", "scam alert"],           handler: report.handle },
  { patterns: ["trending", "what's trending", "whats hot", "top movers", "market trends"], handler: trending.handle },
];

async function handleDM(bot, msg) {
  // 1) If this message is a Telegram reply to a bot-posted DM notification,
  //    relay it back to the site as a real DM.
  if (msg.reply_to_message?.message_id) {
    try {
      const r = await tg.reply(msg.reply_to_message.message_id, msg.text || "");
      if (r.ok) {
        await bot.sendMessage(msg.chat.id, "✅ Reply sent to IronShield.");
        return;
      }
    } catch { /* fall through */ }
  }

  // 2) Wallet-first onboarding: a plain address links the wallet.
  if (await link.tryLinkFromMessage(bot, msg)) return;

  const text  = (msg.text || "").toLowerCase();
  const match = INTENTS.find(i => i.patterns.some(p => text.includes(p)));

  if (match) {
    await match.handler(bot, msg);
    return;
  }

  // No specific intent matched — use IronClaw general AI
  const typingInterval = setInterval(() => {
    bot.sendChatAction(msg.chat.id, "typing").catch(() => {});
  }, 3000);
  bot.sendChatAction(msg.chat.id, "typing").catch(() => {});

  try {
    const res = await fetch(`${BACKEND}/api/chat`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ message: msg.text, userId: msg.from.id.toString() }),
    });
    const json = await res.json();
    clearInterval(typingInterval);

    if (json.success && json.data?.reply) {
      await bot.sendMessage(msg.chat.id, json.data.reply);
    } else {
      await bot.sendMessage(msg.chat.id, "I couldn't process that right now. Try a specific command like /research or /verify, or rephrase your question.");
    }
  } catch (err) {
    clearInterval(typingInterval);
    console.error("[DM] Chat error:", err.message);
    await bot.sendMessage(msg.chat.id, "Something went wrong. Try again or use /help to see available commands.");
  }
}

module.exports = { handleDM };
