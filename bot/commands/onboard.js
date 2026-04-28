// bot/commands/onboard.js — IronGuide concierge over Telegram.
//
// Two entry points:
//   - handle(bot, msg)       → /onboard (or first-time /start with no
//                              wallets and no open session) starts a
//                              fresh interview and sends the opener.
//   - tryRoute(bot, msg)     → DM router calls this BEFORE wallet detection
//                              so an in-progress interview consumes plain
//                              text answers instead of letting the link-
//                              detector fire.
//
// Conversation state lives entirely in the backend (ironguide_sessions);
// the bot just relays input/output. Recommended kits are surfaced with
// an inline "Deploy this Kit" button that links to the web wizard —
// the contract call (register_agent) needs the user's wallet, which
// only the web flow can drive.

const { ironguide } = require("../services/backend");

const FRONTEND = process.env.FRONTEND_URL || "https://ironshield.near.page";

async function handle(bot, msg) {
  const chatId = msg.chat.id;
  const tgId = msg.from.id;

  // If they've already got an in-flight interview, resume it instead
  // of orphaning the prior conversation. Otherwise start fresh.
  const open = await ironguide.open(tgId);
  if (open.ok && open.session?.id && open.session.status === "active") {
    const last = lastAssistantMessage(open.session.messages_json);
    await bot.sendMessage(
      chatId,
      `Picking up where we left off.\n\n${last || "What kind of work would you like an agent to help you with?"}`,
    );
    return;
  }
  if (open.ok && open.session?.id && open.session.status === "recommended") {
    return sendRecommendation(bot, chatId, open.session);
  }

  const r = await ironguide.start(tgId);
  if (!r.ok) {
    await bot.sendMessage(chatId, `Could not start onboarding: ${r.error || "unknown error"}`);
    return;
  }
  await bot.sendMessage(chatId, r.question);
}

/**
 * Hook invoked by the DM router. Returns true if the message was
 * consumed by the IronGuide flow.
 */
async function tryRoute(bot, msg) {
  if (!msg.text || msg.text.startsWith("/")) return false;
  const tgId = msg.from.id;
  const open = await ironguide.open(tgId);
  if (!open.ok || !open.session?.id) return false;
  if (open.session.status !== "active") return false;

  const r = await ironguide.reply(open.session.id, msg.text);
  if (!r.ok) {
    await bot.sendMessage(msg.chat.id, `Hmm, IronGuide hit an error: ${r.error || "try again"}`);
    return true; // still consume the turn so we don't fall through to the wallet detector
  }
  if (r.recommendation && r.recommendation.kit) {
    await sendRecommendation(bot, msg.chat.id, r.session);
  } else if (r.session?.status === "recommended") {
    // No-fit path — backend logged a kit_request and closed the session.
    await bot.sendMessage(
      msg.chat.id,
      r.question || "I've logged your needs for the team — keep an eye out for new Kits.",
    );
  } else {
    await bot.sendMessage(msg.chat.id, r.question || "Tell me a bit more about what you need.");
  }
  return true;
}

function lastAssistantMessage(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return messages[i].content;
  }
  return null;
}

async function sendRecommendation(bot, chatId, session) {
  const slug = session.recommended_kit_id;
  if (!slug) {
    await bot.sendMessage(
      chatId,
      "No exact-fit Kit yet — I've logged it for the curation team. Browse the live ones at /kits in the bot or open the marketplace on the web app.",
    );
    return;
  }
  const url = `${FRONTEND}/agents/deploy/${encodeURIComponent(slug)}?ironguide=${session.id}`;
  await bot.sendMessage(
    chatId,
    `Recommended Kit: *${slug}*\n\nTap the button below to wire it up. The deploy wizard runs on the web app because the contract call needs your wallet to sign.`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[{ text: "Deploy this Kit", url }]],
      },
    },
  );
}

module.exports = { handle, tryRoute };
