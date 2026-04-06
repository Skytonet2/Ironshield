// bot/handlers/dmHandler.js — natural language DM mode
const summary   = require("../commands/summary");
const research  = require("../commands/research");
const verify    = require("../commands/verify");
const portfolio = require("../commands/portfolio");

const INTENTS = [
  { patterns: ["summarize", "summary of", "what happened in", "tldr"],             handler: summary.handle },
  { patterns: ["research", "analyse", "analyze", "check token", "tell me about"],  handler: research.handle },
  { patterns: ["verify", "is this true", "fact check", "is it true"],              handler: verify.handle },
  { patterns: ["portfolio", "my wallet", "my balance", "how much", "net worth"],   handler: portfolio.handle },
  { patterns: ["add wallet", "track wallet"],                                       handler: portfolio.handleAdd },
];

async function handleDM(bot, msg) {
  const text  = (msg.text || "").toLowerCase();
  const match = INTENTS.find(i => i.patterns.some(p => text.includes(p)));
  if (match) {
    await match.handler(bot, msg);
  } else {
    await bot.sendMessage(msg.chat.id,
      `👋 I'm IronClaw. Here's what I can do:\n\n🔍 *Research a token* — "research PEPE" or "tell me about 0x..."\n📋 *Summarize a group* — "summarize @cryptoalpha"\n✅ *Fact-check* — "is this true: [claim]"\n💼 *Portfolio* — "my portfolio" or "add wallet 0x..."\n\nJust type naturally — no commands needed.`,
      { parse_mode: "Markdown" }
    );
  }
}

module.exports = { handleDM };
