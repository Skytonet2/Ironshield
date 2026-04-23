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
this bot. Think of it like Venmo for crypto — fast and
conversational, funds stay in this account only. Your main wallets
are never touched.

• *Custody:* We hold the encrypted signing key for your bot
  account. Your main wallets are not affected.
• *Fund it:* From any NEAR wallet, or bridge in from SOL / ETH /
  BTC / 15+ chains — run /deposit.
• *Trade with plain text:* Just type what you want. "swap $10 sol
  to near" or "send 2 near to alice.near". No slashes needed.
  Powered by NEAR Intents (near.com) — one engine, every chain.
• *Withdraw anytime:* /withdraw <address> drains everything.

One-time *$5 activation* unlocks the fast commands. The fee pays
for IronClaw agent infra (LLM + routing) that understands your
plain-text requests. Run /activate after funding.

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
  // Strip the leading slash command (/swap, /buy, /send) and any
  // @BotName suffix so both "/swap 10 near to usdc" and free-form
  // "swap 10 near to usdc" parse identically. Before this, every
  // slash-command invocation fell through to the help text because
  // the regexes below wouldn't match text starting with "/".
  const s = text
    .trim()
    .replace(/^\s*\/(swap|buy|send)(@\w+)?\s*/i, (_, verb) => `${verb.toLowerCase()} `)
    .toLowerCase();

  // swap:  "swap <amt> <from> to <to>"  (also matches /buy as a swap)
  const swap = s.match(/^\s*(?:swap|buy)\s+(\$?[\d.]+)\s+([a-z0-9.$]+)\s+(?:to|for|->)\s+([a-z0-9.$]+)/i);
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

  // "buy <amt> <token>" — shorthand without a "from" clause. Defaults
  // the source side to native NEAR, because 99% of the time that's
  // what a user pre-funded the custodial account with. If they want
  // to spend USDC or something else, the full "swap <amt> <from> to
  // <to>" form still works.
  const buy = s.match(/^\s*buy\s+(\$?[\d.]+)\s+([a-z0-9.$]+)\s*$/i);
  if (buy) {
    const [, amt, tok] = buy;
    return {
      kind: "swap",
      amount: amt.replace(/^\$/, ""),
      amountIsUsd: amt.startsWith("$"),
      fromToken: "nep141:wrap.near",
      toToken:   normaliseToken(tok),
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

/** Nearblocks tx URL — used in every TG success response. */
function txLink(hash) {
  return hash ? `https://nearblocks.io/txns/${hash}` : "";
}

/** For `$10` amounts: fetch current USD price of the given asset and
 *  convert. For token amounts: pass through. Base-unit conversion
 *  happens at the caller with the right decimals per token. */
async function resolveUsdToToken(usdAmount, assetId) {
  const CG_IDS = {
    "nep141:wrap.near":       "near",
    "nep141:sol.omft.near":   "solana",
    "nep141:eth.omft.near":   "ethereum",
    "nep141:btc.omft.near":   "bitcoin",
    "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near": "usd-coin",
    "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near": "tether",
  };
  const cgId = CG_IDS[assetId];
  if (!cgId) throw new Error(`No USD price lookup configured for ${formatToken(assetId)}`);
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd`;
  const fetch = require("node-fetch");
  const r = await fetch(url);
  if (!r.ok) throw new Error(`CoinGecko ${r.status}`);
  const j = await r.json();
  const price = j?.[cgId]?.usd;
  if (!price) throw new Error(`No price for ${formatToken(assetId)}`);
  return Number(usdAmount) / Number(price);
}

/** NEP-141 decimals per contract. Known values baked; unknowns fall
 *  back to 24 (NEAR default) with a warning — any mis-scaling will
 *  surface as a "not enough balance" from the RPC. */
const TOKEN_DECIMALS = {
  "nep141:wrap.near":     24,
  "wrap.near":            24,
  "nep141:sol.omft.near": 9,
  "nep141:eth.omft.near": 18,
  "nep141:btc.omft.near": 8,
  "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near": 6,   // USDC
  "nep141:eth-0xdac17f958d2ee523a2206206994597c13d831ec7.omft.near": 6,   // USDT
};

function toBaseUnits(tokenAmount, assetId) {
  const dec = TOKEN_DECIMALS[assetId] ?? 24;
  const factor = 10n ** BigInt(dec);
  const [whole, frac = ""] = String(tokenAmount).split(".");
  const fracPadded = (frac + "0".repeat(dec)).slice(0, dec);
  return (BigInt(whole || "0") * factor + BigInt(fracPadded || "0")).toString();
}

/* ── /activate ──────────────────────────────────────────────────
 *
 * Two-step: first call returns the preview (how much NEAR = $5 at
 * today's price); confirmation reply fires the on-chain transfer.
 */
async function handleActivate(bot, msg) {
  const chatId = msg.chat.id;
  const tgId   = msg.from.id;
  const text   = (msg.text || "").toLowerCase();
  const confirm = /confirm|yes|ok|go/.test(text);

  const r = await tg.custodialActivate(tgId, { confirm });
  if (!r.ok) {
    return bot.sendMessage(chatId, `❌ ${r.error || "Activation failed"}`);
  }
  if (r.alreadyActivated) {
    return bot.sendMessage(chatId, `✅ You're already activated — trade away.`);
  }
  if (r.needsConfirm) {
    return bot.sendMessage(
      chatId,
      `💳 *Activate bot trading*\n\n` +
      `One-time fee: *$${r.usd}* ≈ *${r.nearAmount} NEAR* (@ $${r.nearUsdPrice}/NEAR)\n` +
      `Paid to: \`${r.feeRecipient}\`\n\n` +
      `Covers IronClaw agent infrastructure (LLM routing, usage cost).\n\n` +
      `Reply *\`/activate confirm\`* to send.`,
      { parse_mode: "Markdown" }
    );
  }
  return bot.sendMessage(
    chatId,
    `✅ *Activated!*\n\n` +
    `Paid ${r.paidNear} NEAR ($${r.usd}).\n` +
    `[View tx →](${txLink(r.txHash)})\n\n` +
    `Fast trading is unlocked. Just type naturally:\n` +
    `• \`swap $10 sol to near\`\n` +
    `• \`send 0.5 near to alice.near\``,
    { parse_mode: "Markdown", disable_web_page_preview: true }
  );
}

/* ── swap (plain-text or /swap) ─────────────────────────────────
 *
 * Every swap flows through NEAR Intents (1click chaindefuser). One
 * engine, every chain. If both originAsset and destinationAsset are
 * on NEAR, the solver handles it as an internal swap; if they're on
 * different chains, same call, same shape — the solver figures out
 * routing. Our 0.2% fee rides along via 1click's appFees.
 */
async function handleSwap(bot, msg, override) {
  const chatId = msg.chat.id;
  const tgId   = msg.from.id;
  const parsed = override || parseIntent(msg.text || "");
  if (!parsed || parsed.kind !== "swap") {
    return bot.sendMessage(
      chatId,
      "Tell me what to swap. Examples:\n" +
      "• `swap $10 sol to near`\n" +
      "• `swap 0.5 near to usdc`\n\n" +
      "Every pair goes through near.com (NEAR Intents). Works cross-chain too — " +
      "pass a destination wallet and I'll deliver there.",
      { parse_mode: "Markdown" }
    );
  }

  try {
    let tokenAmount = parsed.amount;
    if (parsed.amountIsUsd) {
      tokenAmount = await resolveUsdToToken(parsed.amount, parsed.fromToken);
    }
    const amountBase = toBaseUnits(tokenAmount, parsed.fromToken);

    await bot.sendMessage(chatId, `⏳ Routing through near.com…`);
    const r = await tg.custodialSwap(tgId, {
      originAsset:      parsed.fromToken,
      destinationAsset: parsed.toToken,
      amountBase,
      slippageBps: 100,
    });
    if (!r.ok) {
      if (r.status === 402 || /activation/i.test(r.error || "")) {
        return bot.sendMessage(
          chatId,
          `🔒 Activate first. Run /activate — one-time $5 unlocks fast trading.`
        );
      }
      return bot.sendMessage(chatId, `❌ Swap failed: ${r.error || "unknown error"}`);
    }
    const outStr = fromBaseUnits(r.estimatedOut, parsed.toToken);
    const text =
      `✅ *Swap sent via near.com*\n\n` +
      `${tokenAmount} ${formatToken(parsed.fromToken)} → ~${outStr} ${formatToken(parsed.toToken)}\n` +
      `[View ft_transfer →](${txLink(r.swapTxHash)})\n` +
      `Platform fee: 0.20% (routed via 1click appFees)\n\n` +
      `The solver typically settles in 15–60s. Run /balance to check.`;
    return bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
  } catch (e) {
    return bot.sendMessage(chatId, `❌ ${e.message}`);
  }
}

/* ── /send ───────────────────────────────────────────────────────
 *
 * Native NEAR transfer today. NEP-141 token sends (ft_transfer) land
 * alongside the cross-chain bridge swap path so we can handle
 * storage_deposit pre-flight in one design pass.
 */
async function handleSend(bot, msg, override) {
  const chatId = msg.chat.id;
  const tgId   = msg.from.id;
  const parsed = override || parseIntent(msg.text || "");
  if (!parsed || parsed.kind !== "send") {
    return bot.sendMessage(
      chatId,
      "Usage: `send <amount> to <address>`\nExample: `send 0.5 near to alice.near`\n\n" +
      "Native NEAR only for now — NEP-141 token sends land next turn.",
      { parse_mode: "Markdown" }
    );
  }
  if (parsed.token !== "nep141:wrap.near" && parsed.token !== "near") {
    return bot.sendMessage(
      chatId,
      `⚠️ Only native NEAR is supported for /send today. ` +
      `To move ${formatToken(parsed.token)}, use /swap into NEAR then /send.`
    );
  }
  try {
    let nearAmount = parsed.amount;
    if (parsed.amountIsUsd) {
      nearAmount = await resolveUsdToToken(parsed.amount, "nep141:wrap.near");
    }
    await bot.sendMessage(chatId, `⏳ Sending…`);
    const r = await tg.custodialTransfer(tgId, {
      to: parsed.to,
      amountNear: String(nearAmount),
    });
    if (!r.ok) {
      if (r.status === 402 || /activation/i.test(r.error || "")) {
        return bot.sendMessage(
          chatId,
          `🔒 Activate first. Run /activate — one-time $5 unlocks fast sending.`
        );
      }
      return bot.sendMessage(chatId, `❌ ${r.error || "Send failed"}`);
    }
    const text =
      `✅ *Sent ${r.amountNear} NEAR*\n\n` +
      `to \`${parsed.to}\`\n` +
      `[View tx →](${txLink(r.txHash)})`;
    return bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
  } catch (e) {
    return bot.sendMessage(chatId, `❌ ${e.message}`);
  }
}

/* ── /withdraw ───────────────────────────────────────────────────
 *
 * Drain native NEAR from the custodial account back to a user-chosen
 * address. Optional explicit amount; otherwise max-minus-reserve.
 */
async function handleWithdraw(bot, msg) {
  const chatId = msg.chat.id;
  const tgId   = msg.from.id;
  const parts = (msg.text || "").trim().split(/\s+/);
  if (parts.length < 2) {
    return bot.sendMessage(
      chatId,
      "Usage: `/withdraw <near-address> [amount]`\n" +
      "No amount = drain all (minus 0.05 NEAR reserved for storage).\n" +
      "Amount in NEAR (e.g. `0.5`).",
      { parse_mode: "Markdown" }
    );
  }
  const [, address, amt] = parts;
  try {
    await bot.sendMessage(chatId, `⏳ Withdrawing…`);
    const r = await tg.custodialTransfer(tgId, {
      to: address,
      amountNear: amt || null,
    });
    if (!r.ok) {
      if (r.status === 402 || /activation/i.test(r.error || "")) {
        return bot.sendMessage(
          chatId,
          `🔒 Activate first. Run /activate — one-time $5 unlocks withdrawals.`
        );
      }
      return bot.sendMessage(chatId, `❌ ${r.error || "Withdraw failed"}`);
    }
    const text =
      `✅ *Withdrawn ${r.amountNear} NEAR*\n\n` +
      `to \`${address}\`\n` +
      `[View tx →](${txLink(r.txHash)})`;
    return bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
  } catch (e) {
    return bot.sendMessage(chatId, `❌ ${e.message}`);
  }
}

/** Reverse of toBaseUnits for display. Takes a base-unit string and
 *  assetId, returns a 6-decimal human string. */
function fromBaseUnits(baseStr, assetId) {
  try {
    const dec = TOKEN_DECIMALS[assetId] ?? 24;
    const n = BigInt(baseStr);
    const factor = 10n ** BigInt(dec);
    const whole = n / factor;
    const frac  = (n % factor).toString().padStart(dec, "0").slice(0, 6);
    return `${whole}${frac ? "." + frac.replace(/0+$/, "") : ""}`;
  } catch { return baseStr; }
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
  handleActivate,
  handleSwap,
  handleSend,
  handleWithdraw,
  parseIntent,
  CUSTODIAL_EXPLAINER,
};
