// bot/handlers/callbackHandler.js — inline-button callbacks

const { handleWalletCallback }   = require("../commands/wallets");
const { handleSettingsCallback } = require("../commands/settings");
const { tg, economy } = require("../services/backend");

// Phase 10 — Agent Economy: route escalation:approve:<id> and
// escalation:reject:<id> button taps to the resolution endpoint.
// The chat the message was sent to ↔ wallet linkage is enforced
// backend-side (escalations.route checks the orchestrator secret).
async function handleEscalationCallback(bot, cq) {
  const parts = (cq.data || "").split(":");
  // ['escalation', 'approve'|'reject', '<id>']
  if (parts.length < 3) {
    await bot.answerCallbackQuery(cq.id, { text: "Bad button" });
    return;
  }
  const action = parts[1];
  const id = parts[2];
  if (!/^\d+$/.test(id)) {
    await bot.answerCallbackQuery(cq.id, { text: "Bad escalation id" });
    return;
  }
  const decision = action === "approve" ? "approved" : action === "reject" ? "rejected" : null;
  if (!decision) {
    await bot.answerCallbackQuery(cq.id, { text: "Unknown action" });
    return;
  }
  const r = await economy.resolveEscalation(id, decision, `tg:${cq.from?.id}`);
  if (r.ok) {
    await bot.answerCallbackQuery(cq.id, {
      text: decision === "approved" ? "Approved ✓" : "Rejected ✗",
    });
    // Edit the original message to reflect the resolution so the
    // buttons disappear and the row reads as decided.
    const stamp = decision === "approved" ? "✅ Approved" : "❌ Rejected";
    await bot.editMessageText(
      `${cq.message?.text || "Escalation"}\n\n${stamp} by you.`,
      {
        chat_id: cq.message.chat.id,
        message_id: cq.message.message_id,
        parse_mode: "Markdown",
      },
    ).catch(() => {});
  } else {
    await bot.answerCallbackQuery(cq.id, {
      text: r.status === 409 ? "Already resolved" : "Failed",
    });
  }
}

async function handleCallback(bot, cq) {
  const data = cq.data || "";

  try {
    if (data.startsWith("wallet:")) {
      await handleWalletCallback(bot, cq);
      return;
    }
    if (data.startsWith("set:")) {
      await handleSettingsCallback(bot, cq);
      return;
    }
    if (data.startsWith("escalation:")) {
      await handleEscalationCallback(bot, cq);
      return;
    }
    if (data.startsWith("notify:dismiss")) {
      await bot.answerCallbackQuery(cq.id, { text: "Dismissed" });
      await bot.deleteMessage(cq.message.chat.id, cq.message.message_id).catch(() => {});
      return;
    }
    if (data === "help:commands") {
      await bot.answerCallbackQuery(cq.id);
      await bot.sendMessage(cq.message.chat.id, "Type /help for the full command list.");
      return;
    }
    await bot.answerCallbackQuery(cq.id);
  } catch (e) {
    console.warn("[callback] error:", e.message);
    try { await bot.answerCallbackQuery(cq.id, { text: "Error" }); } catch {}
  }
}

module.exports = { handleCallback };
