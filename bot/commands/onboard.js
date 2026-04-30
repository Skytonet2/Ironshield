// bot/commands/onboard.js — AZUKA Guide concierge over Telegram.
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
// the bot just relays input/output. The flow is a deterministic step
// machine — each turn returns a structured `question` object with
// clickable options that we render as an inline keyboard. Users can
// also type free text for any step that has `allow_other: true`,
// which the DM router catches via tryRoute().

const { ironguide } = require("../services/backend");

const FRONTEND = process.env.FRONTEND_URL || "https://azuka.pages.dev";

// Keep the callback prefix short so the {prefix}:{sessionId}:{value}
// envelope fits inside Telegram's 64-byte callback_data limit even
// when the value is a free-text token.
const CB_PREFIX = "ig";

async function handle(bot, msg) {
  const chatId = msg.chat.id;
  const tgId = msg.from.id;

  // Resume an in-flight interview so the user doesn't lose context.
  const open = await ironguide.open(tgId);
  if (open.ok && open.session?.id && open.session.status === "active") {
    const question = currentQuestionFromSession(open.session);
    await bot.sendMessage(chatId, "Picking up where we left off.");
    await sendQuestion(bot, chatId, open.session.id, question);
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
  await sendQuestion(bot, chatId, r.session.id, r.question);
}

/**
 * Hook invoked by the DM router. Returns true if the message was
 * consumed by the AZUKA Guide flow. Free-text answers feed in here
 * for every step where `allow_other` is true (which is most of them).
 */
async function tryRoute(bot, msg) {
  if (!msg.text || msg.text.startsWith("/")) return false;
  const tgId = msg.from.id;
  const open = await ironguide.open(tgId);
  if (!open.ok || !open.session?.id) return false;
  if (open.session.status !== "active") return false;

  await applyAnswer(bot, msg.chat.id, open.session.id, msg.text);
  return true;
}

/**
 * Inline-keyboard callback dispatched from bot/handlers/callbackHandler.
 * data shape: `ig:<sessionId>:<value>` (CB_PREFIX above).
 */
async function handleCallback(bot, cq) {
  const data = cq.data || "";
  const parts = data.split(":");
  if (parts[0] !== CB_PREFIX) return false;
  const sessionId = parts[1];
  // Re-join in case a free-text "other" value somehow contained ":".
  // Step values are short ('ng', 'sell', 'low'…) so this is paranoid.
  const value = parts.slice(2).join(":");
  if (!sessionId || !value) {
    await bot.answerCallbackQuery(cq.id, { text: "Bad button" });
    return true;
  }
  // Dismiss the loading spinner on the button immediately.
  await bot.answerCallbackQuery(cq.id).catch(() => {});
  await applyAnswer(bot, cq.message.chat.id, sessionId, value);
  return true;
}

async function applyAnswer(bot, chatId, sessionId, content) {
  const r = await ironguide.reply(sessionId, content);
  if (!r.ok) {
    await bot.sendMessage(chatId, `Hmm, AZUKA Guide hit an error: ${r.error || "try again"}`);
    return;
  }
  if (r.error) {
    // Soft validation error from canonicalize() — re-ask same question.
    await bot.sendMessage(chatId, r.error);
    if (r.question) await sendQuestion(bot, chatId, sessionId, r.question);
    return;
  }
  if (r.recommendation && r.recommendation.kit) {
    await sendRecommendation(bot, chatId, r.session);
    return;
  }
  if (r.session?.status === "recommended") {
    // No-fit path — backend logged a kit_request and closed the session.
    await bot.sendMessage(
      chatId,
      r.recommendation?.summary || "I've logged your needs for the team — keep an eye out for new Kits.",
    );
    return;
  }
  if (r.question) {
    await sendQuestion(bot, chatId, sessionId, r.question);
  }
}

/**
 * Render a question with its options as an inline-keyboard. We stack
 * the buttons one per row for readability — Telegram squeezes them
 * but long labels (with emoji) wrap awkwardly when packed two-up.
 *
 * Steps with `options: null` (free-text only — wallet address, name,
 * price) skip the keyboard entirely; the user just types their answer
 * and the DM router catches it.
 */
async function sendQuestion(bot, chatId, sessionId, question) {
  if (!question) return;
  const opts = Array.isArray(question.options) ? question.options : [];
  const inline_keyboard = opts.map((o) => ([{
    // Truncate visible button text so the keyboard doesn't get pushed
    // off-screen on narrow phones.
    text: String(o.label || o.value).slice(0, 40),
    // ig:<sessionId>:<value> envelope — must stay under 64 bytes.
    callback_data: `${CB_PREFIX}:${sessionId}:${o.value}`.slice(0, 64),
  }]));
  const tail = question.allow_other && opts.length
    ? "\n\n_Or just type your answer below._"
    : (!opts.length && question.allow_other
        ? "\n\n_Type your answer below._"
        : "");
  await bot.sendMessage(chatId, `${question.text}${tail}`, {
    parse_mode: "Markdown",
    reply_markup: inline_keyboard.length ? { inline_keyboard } : undefined,
  });
}

/**
 * Find the question we should re-ask for an in-flight session. Trusts
 * `current_step` from the backend (the step machine writes it on every
 * answer). Falls back to the last assistant transcript line if for
 * some reason current_step isn't set (legacy session shape).
 */
function currentQuestionFromSession(session) {
  if (session.current_step) {
    // We can't import the step machine on the bot side without bundling
    // backend code. Round-trip through the assistant's last transcript
    // line — same text the backend already wrote there.
  }
  const messages = session.messages_json;
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      return { text: messages[i].content, options: null, allow_other: true };
    }
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

module.exports = { handle, tryRoute, handleCallback, CB_PREFIX };
