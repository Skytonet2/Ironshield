// bot/commands/tip.js — /tip from Telegram
//
// /tip @username 1 NEAR   — tips the post/profile of an @user
// /tip 0x... 1 NEAR       — tips a wallet
//
// The actual transfer still happens on-chain and is signed by the user.
// The bot returns a deep link that opens the site with the tip modal
// pre-filled. This is the security-safe pattern: the bot never touches
// keys. Matches the "one-tap Buy/Sell/Tip via inline buttons" spec.

const { tg } = require("../services/backend");
const { detectWallet } = require("../utils/wallet");

function parseTip(text) {
  // /tip <target> <amount> [token]
  const m = text.match(/\/tip(?:@\w+)?\s+(\S+)\s+([\d.]+)(?:\s+(\w+))?/i);
  if (!m) return null;
  return {
    target: m[1],
    amount: Number(m[2]),
    token: (m[3] || "NEAR").toUpperCase(),
  };
}

async function handle(bot, msg) {
  const chatId = msg.chat.id;
  const parsed = parseTip(msg.text || "");
  if (!parsed || !parsed.amount) {
    return bot.sendMessage(chatId,
      "*Send a tip*\n`/tip @alice 1 NEAR`\n`/tip 0x1234… 0.5 NEAR`\n\nYou'll get a one-tap button to confirm on-site.",
      { parse_mode: "Markdown" });
  }

  const isUser = parsed.target.startsWith("@");
  const handle = isUser ? parsed.target.slice(1) : detectWallet(parsed.target) || parsed.target;

  const deepLink = `https://ironshield.near.page/#/Feed?tip=${encodeURIComponent(handle)}&amount=${parsed.amount}&token=${parsed.token}`;
  const buttons = [[{ text: `💸 Confirm tip ${parsed.amount} ${parsed.token}`, url: deepLink }]];

  await bot.sendMessage(
    chatId,
    `💸 *Ready to tip*\n\nTo: \`${handle}\`\nAmount: *${parsed.amount} ${parsed.token}*\n\nTap to confirm on IronShield — your wallet signs the transfer.`,
    { parse_mode: "Markdown", reply_markup: { inline_keyboard: buttons } }
  );
}

module.exports = { handle };
