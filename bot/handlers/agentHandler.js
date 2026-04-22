// bot/handlers/agentHandler.js — IronClaw-driven action layer for DMs.
//
// Flow (only reached when parseIntent didn't match a fast path):
//   1. askAgent(text) → IronClaw proposes action OR chats
//   2. action → bot sends a confirmation prompt, stores pendingToken
//      in-memory keyed by tgId, waits for "yes"/"no"
//   3. User reply → if yes and we have a pending, confirm via
//      /api/tg/agent/confirm → dispatch to the existing action
//      handlers with the same UX as direct commands
//
// pendingToken lives on BOTH sides: backend has the authoritative
// action payload tied to it (so the bot can't just make up arguments),
// the bot has the token to present on confirm. Expires after 2min.

const { tg } = require("../services/backend");
const custodial = require("../commands/custodial");

const pendingByTg = new Map();  // tgId → { token, action, params, askedAt }
const PENDING_TTL = 2 * 60_000;

function isYes(text) {
  if (!text) return false;
  const s = text.trim().toLowerCase();
  return /^(y|yes|yeah|yep|ok|okay|go|confirm|do it|fire|send it|sure)\b/.test(s);
}
function isNo(text) {
  if (!text) return false;
  const s = text.trim().toLowerCase();
  return /^(n|no|nope|cancel|abort|stop|nvm|nevermind)\b/.test(s);
}

/** Consume the user's reply if we were waiting on a confirmation. */
async function handlePendingReply(bot, msg) {
  const tgId = msg.from.id;
  const pending = pendingByTg.get(tgId);
  if (!pending) return false;
  if (Date.now() - pending.askedAt > PENDING_TTL) {
    pendingByTg.delete(tgId);
    return false;
  }
  const text = msg.text || "";
  if (isNo(text)) {
    pendingByTg.delete(tgId);
    await bot.sendMessage(msg.chat.id, "Cancelled.");
    return true;
  }
  if (!isYes(text)) return false;

  pendingByTg.delete(tgId);
  const confirm = await tg.agentConfirm({ tgId, pendingToken: pending.token });
  if (!confirm.ok) {
    await bot.sendMessage(msg.chat.id, `❌ ${confirm.error || "Confirmation failed"}`);
    return true;
  }
  await dispatchAgentAction(bot, msg, confirm);
  return true;
}

/**
 * Translates the /agent/confirm response into a call against the
 * existing custodial command handlers. Re-uses the same formatting
 * (tx links, error cards) so agent-path + direct-command UX match.
 */
async function dispatchAgentAction(bot, msg, confirm) {
  const chatId = msg.chat.id;
  const a = confirm.args || {};
  switch (confirm.execute) {
    case "swap":
      // Shape into the parseIntent-compatible object so
      // handleSwap(bot, msg, override) does the rest.
      return custodial.handleSwap(bot, msg, {
        kind: "swap",
        amount: a.amount.replace(/^\$/, ""),
        amountIsUsd: String(a.amount).startsWith("$"),
        fromToken: a.originAsset,
        toToken:   a.destinationAsset,
      });
    case "send":
      return custodial.handleSend(bot, msg, {
        kind: "send",
        amount: String(a.amount || "").replace(/^\$/, ""),
        amountIsUsd: String(a.amount || "").startsWith("$"),
        token: "nep141:wrap.near",
        to: a.toAddress,
      });
    case "withdraw": {
      // Withdraw's handler reads msg.text directly — build a
      // synthetic text so it parses out the args.
      const synthetic = { ...msg, text: `/withdraw ${a.toAddress}${a.amount && a.amount !== "all" ? " " + a.amount : ""}` };
      return custodial.handleWithdraw(bot, synthetic);
    }
    case "balance":  return custodial.handleBalance(bot, msg);
    case "deposit":  return custodial.handleDeposit(bot, msg);
    case "activate": return custodial.handleActivate(bot, msg);
    default:
      return bot.sendMessage(chatId, `⚠️ Unknown action: ${confirm.execute}`);
  }
}

/** Ask IronClaw about a free-form message. Returns true when the
 *  agent proposed an action (confirmation was sent) OR replied with
 *  chat text; false if the caller should fall through to something
 *  else. */
async function askAgent(bot, msg) {
  const tgId = msg.from.id;
  const r = await tg.agent({ tgId, message: msg.text || "" });
  if (!r.ok && !r.kind) {
    return false;  // transport error — caller falls through
  }

  if (r.kind === "reply") {
    await bot.sendMessage(msg.chat.id, r.reply || "Hmm, I didn't catch that.");
    return true;
  }
  if (r.kind === "action") {
    pendingByTg.set(tgId, {
      token: r.pendingToken,
      action: r.action,
      params: r.params,
      askedAt: Date.now(),
    });
    await bot.sendMessage(
      msg.chat.id,
      `💡 *${r.confirm}*\n\nReply *yes* to fire, *no* to cancel.`,
      { parse_mode: "Markdown" }
    );
    return true;
  }
  return false;
}

module.exports = { askAgent, handlePendingReply };
