// bot/handlers/dmHandler.js — natural language DM mode
const summary   = require("../commands/summary");
const research  = require("../commands/research");
const verify    = require("../commands/verify");
const portfolio = require("../commands/portfolio");
const scan      = require("../commands/scan");
const alert     = require("../commands/alert");
const report    = require("../commands/report");

const INTENTS = [
  { patterns: ["summarize", "summary of", "what happened in", "tldr"],             handler: summary.handle },
  { patterns: ["research", "analyse", "analyze", "check token", "tell me about"],  handler: research.handle },
  { patterns: ["verify", "is this true", "fact check", "is it true"],              handler: verify.handle },
  { patterns: ["portfolio", "my wallet", "my balance", "how much", "net worth"],   handler: portfolio.handle },
  { patterns: ["add wallet", "track wallet"],                                       handler: portfolio.handleAdd },
  { patterns: ["scan", "is this safe", "check this link", "check url"],            handler: scan.handle },
  { patterns: ["alert me", "notify me", "price alert", "set alert"],               handler: alert.handle },
  { patterns: ["report scam", "report this", "flag this", "scam alert"],           handler: report.handle },
];

async function handleDM(bot, msg) {
  const text  = (msg.text || "").toLowerCase();
  const match = INTENTS.find(i => i.patterns.some(p => text.includes(p)));
  if (match) {
    await match.handler(bot, msg);
  } else {
    await bot.sendMessage(msg.chat.id,
      `👋 I'm IronClaw, your Web3 security assistant.\n\n🔍 *Research* — "research PEPE" or "tell me about 0x..."\n📋 *Summarize* — "summarize @cryptoalpha"\n✅ *Fact-check* — "is this true: [claim]"\n🛡️ *Scan* — "scan https://suspicious-site.com"\n💼 *Portfolio* — "my portfolio" or "add wallet 0x..."\n🔔 *Alerts* — "alert me when NEAR goes above $10"\n🚨 *Report* — "report scam https://fake-site.com"\n\nJust type naturally — no commands needed.`,
      { parse_mode: "Markdown" }
    );
  }
}

module.exports = { handleDM };
