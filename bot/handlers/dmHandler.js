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
const onboard   = require("../commands/onboard");
const custodial = require("../commands/custodial");
const agent     = require("./agentHandler");
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
      // Pass msg.from.id as the verified TG sender so the backend
      // can confirm the caller actually owns the conversation's
      // wallet before persisting the reply.
      const r = await tg.reply(msg.reply_to_message.message_id, msg.from?.id, msg.text || "");
      if (r.ok) {
        await bot.sendMessage(msg.chat.id, "✅ Reply sent to AZUKA.");
        return;
      }
    } catch { /* fall through */ }
  }

  // 2) Pending agent confirmation (yes/no reply to "swap $10 …?").
  //    Runs first so "yes" doesn't get routed elsewhere.
  if (await agent.handlePendingReply(bot, msg)) return;

  // 3a) IronGuide concierge: if there's an in-flight onboarding session
  //     for this user, route the answer there BEFORE the wallet detector
  //     so a typed answer like "Nigeria" doesn't get parsed as anything else.
  if (await onboard.tryRoute(bot, msg)) return;

  // 3b) Wallet-first onboarding: a plain address links the wallet.
  if (await link.tryLinkFromMessage(bot, msg)) return;

  // 4) Fast-path trading intent parser — regex catches the obvious
  //    "swap $10 sol to near" and "send $2 to alice.near" without an
  //    LLM round-trip. Runs BEFORE the loose keyword matcher because
  //    phrasings like "swap my ETH" would otherwise fall into
  //    portfolio's "my wallet" pattern.
  const intent = custodial.parseIntent(msg.text || "");
  if (intent?.kind === "swap") { await custodial.handleSwap(bot, msg, intent); return; }
  if (intent?.kind === "send") { await custodial.handleSend(bot, msg, intent); return; }

  const text  = (msg.text || "").toLowerCase();
  const match = INTENTS.find(i => i.patterns.some(p => text.includes(p)));

  if (match) {
    await match.handler(bot, msg);
    return;
  }

  // 5) IronClaw agent action layer. Handles paraphrases the regex
  //    parser missed ("move half my sol to near", "drop 2 near to
  //    alice"). Proposals are presented as confirmations rather
  //    than executed directly — prompt-injection defence.
  const typingInterval = setInterval(() => {
    bot.sendChatAction(msg.chat.id, "typing").catch(() => {});
  }, 3000);
  bot.sendChatAction(msg.chat.id, "typing").catch(() => {});
  try {
    if (await agent.askAgent(bot, msg)) {
      clearInterval(typingInterval);
      return;
    }
  } catch (e) {
    console.warn("[DM] agent failed, falling through to chat:", e.message);
  }

  // 6) Agent failed or transport down — fall through to the legacy
  //    chat endpoint so the user still gets a response.
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
