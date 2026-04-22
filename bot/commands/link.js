// bot/commands/link.js — /start, /link, wallet-connection flow

const { tg } = require("../services/backend");
const { detectWallet, shortWallet } = require("../utils/wallet");

const WELCOME = `🛡️ *Welcome to IronShield*

I'm IronClaw — your on-site companion for alerts, portfolio, tips & more.

To get started, just *paste your wallet address* here (any NEAR, EVM, or Solana address).

Once linked you'll get real-time alerts for likes, comments, follows, tips, DMs, new tokens you create, pump signals, and alpha news — plus /portfolio, /watch, /alert, /tip and daily digests.

Type /help to see everything I can do.`;

const LINKED = (wallets, active) => `✅ *Wallet linked!*

Active wallet: \`${active}\`
Total wallets: ${wallets.length}

Next steps:
• /settings — pick which alerts you want
• /portfolio — instant overview
• /watch $TOKEN — targeted alerts
• /alert $TOKEN 10x — price alerts
• /tip @user 1 NEAR — tip from anywhere

Type /help to explore.`;

async function handleStart(bot, msg) {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  const parts = text.split(/\s+/);
  const payload = parts[1]; // /start <code>

  // Always register the TG identity — even without a code — so later
  // wallet messages know where to associate. tg.claim also mints the
  // custodial bot account on first run (backend/routes/tg.route.js
  // calls custodialBotWallet.getOrCreateForTgId as a side effect).
  if (payload) {
    const r = await tg.claim({
      code: payload,
      tgId: msg.from.id,
      tgChatId: chatId,
      tgUsername: msg.from.username || null,
    });
    if (r.ok && r.linkedWallet) {
      await bot.sendMessage(
        chatId,
        LINKED([r.linkedWallet], r.linkedWallet),
        { parse_mode: "Markdown" }
      );
      await sendCustodialIntro(bot, chatId, r.custodialAccount);
      return;
    }
  }

  const r = await tg.claim({
    tgId: msg.from.id,
    tgChatId: chatId,
    tgUsername: msg.from.username || null,
  });
  await bot.sendMessage(chatId, WELCOME, { parse_mode: "Markdown" });
  await sendCustodialIntro(bot, chatId, r.custodialAccount);
}

/** Single place for the custodial-account explainer so the message
 *  text stays consistent across onboarding + /help. Skips silently
 *  when the backend didn't return an account (missing
 *  CUSTODIAL_ENCRYPT_KEY in the env) — user still gets the regular
 *  welcome, no dead "undefined" addresses. */
async function sendCustodialIntro(bot, chatId, accountId) {
  if (!accountId) return;
  const { CUSTODIAL_EXPLAINER } = require("./custodial");
  const text =
    `${CUSTODIAL_EXPLAINER}\n\n` +
    `*Your trading account:* \`${accountId}\`\n\n` +
    `Next up: run /deposit to fund it, or /balance to check later.`;
  try {
    await bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
  } catch { /* markdown parse is best-effort */ }
}

/**
 * Try to interpret a plain-text message as a wallet-link attempt. Called
 * by messageHandler / dmHandler before any AI fallback.
 * Returns true if the message was consumed.
 */
async function tryLinkFromMessage(bot, msg) {
  const text = msg.text || "";
  const wallet = detectWallet(text);
  if (!wallet) return false;

  const r = await tg.claim({
    tgId: msg.from.id,
    tgChatId: msg.chat.id,
    tgUsername: msg.from.username || null,
    wallet,
  });
  if (r.ok) {
    const wallets = r.wallets || [wallet];
    await bot.sendMessage(
      msg.chat.id,
      `✅ Linked \`${shortWallet(wallet)}\`\nYou now have ${wallets.length} wallet${wallets.length === 1 ? "" : "s"} connected.\n\nType /settings to choose alerts, or /portfolio for an instant overview.`,
      { parse_mode: "Markdown" }
    );
  } else {
    await bot.sendMessage(msg.chat.id, `⚠️ Could not link wallet: ${r.error || "unknown error"}`);
  }
  return true;
}

module.exports = { handleStart, tryLinkFromMessage };
