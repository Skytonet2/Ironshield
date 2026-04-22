// bot/commands/custodial.js — /deposit, /balance, /swap, /send, /withdraw.
//
// Bot custodial trading account commands. On-chain signing with the
// decrypted key lives in the backend service (custodialBotWallet.js);
// this file is the TG-facing command surface + natural-language
// intent parser.
//
// Phase 7 ship: /deposit and /balance are read-only and live. /swap,
// /send, /withdraw parse correctly and build + show the quote, then
// respond "signing lands in Phase 7-2 — we're sanity-checking the
// custodial execution path on a funded test account first". That way
// users can discover + understand the commands without us firing a
// production tx before the end-to-end signing pass is verified.

const { tg, BACKEND } = require("../services/backend");

const BRIDGE_URL = `${BACKEND.replace(/\/api.*$/, "")}`;  // frontend base

const CUSTODIAL_EXPLAINER = `
🔐 *How your IronShield trading account works*

When you linked, we minted a fresh NEAR implicit account just for
this bot. Think of it like a Venmo wallet — fast and convenient,
but only for funds you choose to move in. Your main wallets stay
untouched.

• *Custody:* We hold the encrypted signing key for your bot
  account. Your main wallets are not affected.
• *Fund it:* From any NEAR wallet, or bridge in from SOL / ETH /
  BTC / 15+ chains with /deposit.
• *Trade fast:* "swap $10 sol to near" or "send $2 to alice.near"
  execute instantly inside TG.
• *Withdraw anytime:* /withdraw <address> drains everything back
  out.

Only deposit what you're willing to trade with.
`.trim();

async function handleDeposit(bot, msg) {
  const chatId = msg.chat.id;
  const tgId = msg.from.id;

  const r = await tg.custodial(tgId);
  if (!r.ok) {
    return bot.sendMessage(chatId, `⚠️ ${r.error || "Run /start first"}.`);
  }
  const addr = r.accountId;
  const text =
    `💳 *Deposit address*\n\n` +
    `Your trading account: \`${addr}\`\n\n` +
    `*From NEAR:* send any amount of NEAR or a NEP-141 token directly to this address.\n\n` +
    `*From Solana / Ethereum / BTC / 15+ chains:* use our NEAR Intents bridge with this recipient:\n` +
    `[Open bridge →](${BRIDGE_URL}/aio?bridge=${addr})\n\n` +
    `Run /balance after the deposit confirms.`;
  return bot.sendMessage(chatId, text, {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  });
}

async function handleBalance(bot, msg) {
  const chatId = msg.chat.id;
  const tgId = msg.from.id;
  const r = await tg.custodialBalance(tgId);
  if (!r.ok) {
    return bot.sendMessage(chatId, `⚠️ ${r.error || "Run /start first"}.`);
  }
  const near = r.balanceNear || "0.0000";
  const funded = Number(near) > 0;
  const text =
    `💰 *Trading account balance*\n\n` +
    `\`${r.accountId}\`\n` +
    `*NEAR:* ${near}\n\n` +
    (funded
      ? `Ready to trade. Try: \`swap $10 near to sol\` or \`send $1 to alice.near\`.`
      : `Empty — run /deposit to fund it.`);
  return bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
}

/* ── Intent parser ───────────────────────────────────────────────
 *
 * Recognizes free-form messages like:
 *   swap $10 sol to near
 *   swap 5 near to usdc
 *   send $2 to alice.near
 *   send 0.5 near to alice.near
 *
 * Returns null when the message isn't a trading intent — the caller
 * falls through to the existing wallet/AI handler.
 */
function parseIntent(text) {
  if (!text || typeof text !== "string") return null;
  const s = text.trim().toLowerCase();

  // swap:  "swap <amt> <from> to <to>"
  const swap = s.match(/^\s*swap\s+(\$?[\d.]+)\s+([a-z0-9.$]+)\s+(?:to|for|->)\s+([a-z0-9.$]+)/i);
  if (swap) {
    const [, amt, from, to] = swap;
    return {
      kind: "swap",
      amount: amt.replace(/^\$/, ""),
      amountIsUsd: amt.startsWith("$"),
      fromToken: normaliseToken(from),
      toToken:   normaliseToken(to),
    };
  }

  // send:  "send <amt> [token] to <address>"
  // The token group excludes "to" (case-insensitive) so "send $2 to
  // alice.near" doesn't mis-capture "to" as the token. When the
  // user omits a ticker we default to native NEAR.
  const send = s.match(/^\s*send\s+(\$?[\d.]+)\s+(?:(?!to\b)([a-z0-9$]+)\s+)?to\s+([\w.\-]+(?:\.near)?|[A-Za-z0-9]{32,64})/i);
  if (send) {
    const [, amt, token, addr] = send;
    return {
      kind: "send",
      amount: amt.replace(/^\$/, ""),
      amountIsUsd: amt.startsWith("$"),
      token: token ? normaliseToken(token) : "nep141:wrap.near",
      to: addr,
    };
  }

  return null;
}

function normaliseToken(t) {
  const up = t.replace(/^\$/, "").toLowerCase();
  // Map common tickers → NEAR Intents asset IDs so the downstream
  // bridge lookup lands on the right thing. Expand as needed.
  const map = {
    near: "nep141:wrap.near",
    wnear: "nep141:wrap.near",
    sol:  "nep141:sol.omft.near",
    usdc: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",
    usdt: "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near",
    eth:  "nep141:eth.omft.near",
    btc:  "nep141:btc.omft.near",
  };
  return map[up] || up;
}

// Shared "not-yet-signing" response used by swap/send/withdraw until
// Phase 7-2 lands the signing path.
function pendingSignNote(actionLine) {
  return (
    `🧪 *Preview parsed*\n\n` +
    `${actionLine}\n\n` +
    `Live signing lands in Phase 7-2. We're verifying the custodial` +
    ` execution path on a funded test account first before your real` +
    ` balance moves. Stay tuned — the same command syntax will go ` +
    `from preview → live with zero changes on your side.`
  );
}

async function handleSwap(bot, msg, override) {
  const chatId = msg.chat.id;
  const parsed = override || parseIntent(msg.text || "");
  if (!parsed || parsed.kind !== "swap") {
    return bot.sendMessage(
      chatId,
      "Usage: `swap <amount> <from> to <to>`\nExample: `swap $10 sol to near`",
      { parse_mode: "Markdown" }
    );
  }
  const line =
    `Swap ${parsed.amountIsUsd ? "$" : ""}${parsed.amount} ` +
    `${formatToken(parsed.fromToken)} → ${formatToken(parsed.toToken)}`;
  return bot.sendMessage(chatId, pendingSignNote(line), { parse_mode: "Markdown" });
}

async function handleSend(bot, msg, override) {
  const chatId = msg.chat.id;
  const parsed = override || parseIntent(msg.text || "");
  if (!parsed || parsed.kind !== "send") {
    return bot.sendMessage(
      chatId,
      "Usage: `send <amount> [token] to <address>`\nExample: `send $2 to alice.near`",
      { parse_mode: "Markdown" }
    );
  }
  const line =
    `Send ${parsed.amountIsUsd ? "$" : ""}${parsed.amount} ` +
    `${formatToken(parsed.token)} → \`${parsed.to}\``;
  return bot.sendMessage(chatId, pendingSignNote(line), { parse_mode: "Markdown" });
}

async function handleWithdraw(bot, msg) {
  const chatId = msg.chat.id;
  const parts = (msg.text || "").split(/\s+/);
  if (parts.length < 2) {
    return bot.sendMessage(
      chatId,
      "Usage: `/withdraw <near-address> [amount]`\n" +
      "No amount = drain everything. Amount in NEAR (e.g. `0.5`).",
      { parse_mode: "Markdown" }
    );
  }
  const [, address, amt] = parts;
  const line = amt
    ? `Withdraw ${amt} NEAR → \`${address}\``
    : `Withdraw *all* NEAR → \`${address}\``;
  return bot.sendMessage(chatId, pendingSignNote(line), { parse_mode: "Markdown" });
}

function formatToken(ref) {
  if (!ref) return "?";
  const reverse = {
    "nep141:wrap.near": "NEAR",
    "nep141:sol.omft.near": "SOL",
    "nep141:eth.omft.near": "ETH",
    "nep141:btc.omft.near": "BTC",
    "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near": "USDC",
    "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near": "USDT",
  };
  return reverse[ref] || ref.replace(/^nep141:/, "").toUpperCase();
}

module.exports = {
  handleDeposit,
  handleBalance,
  handleSwap,
  handleSend,
  handleWithdraw,
  parseIntent,
  CUSTODIAL_EXPLAINER,
};
