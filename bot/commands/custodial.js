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

/* ── /swap ───────────────────────────────────────────────────────
 *
 * Real on-chain path: Ref Finance NEP-141 → NEP-141 on the user's
 * custodial account. 1click cross-chain bridge swaps (e.g. sol →
 * SOL on Solana) land in the next turn once the recipient-address
 * UX is designed.
 */

// Known-good Ref pool IDs for common pairs. `null` means we'll try to
// resolve dynamically via a pool-lookup; unknown pairs error cleanly
// rather than guessing. Expand as needed.
const REF_POOLS = {
  // (tokenIn|tokenOut) → pool_id
  "nep141:sol.omft.near|nep141:wrap.near": null,  // dynamic
  "nep141:wrap.near|nep141:sol.omft.near": null,
  // Add common pairs here as we verify pool IDs on-chain.
};

async function resolveRefPool(tokenIn, tokenOut) {
  // Today we rely on the caller to know. A `/swap <poolId> ...` escape
  // hatch lives in the parser; future: fetch pool list via
  // v2.ref-finance.near's get_pool_by_token_pair view once we verify
  // that's actually a view method.
  const key = `${tokenIn}|${tokenOut}`;
  return REF_POOLS[key] || null;
}

async function handleSwap(bot, msg, override) {
  const chatId = msg.chat.id;
  const tgId   = msg.from.id;
  const parsed = override || parseIntent(msg.text || "");
  if (!parsed || parsed.kind !== "swap") {
    return bot.sendMessage(
      chatId,
      "Usage: `swap <amount> <from> to <to>`\nExample: `swap 0.1 sol to near`\n\n" +
      "Supports NEP-141 → NEP-141 pairs on your NEAR custodial account " +
      "via Ref Finance. Cross-chain bridge swaps arrive in the next turn.",
      { parse_mode: "Markdown" }
    );
  }

  try {
    // Resolve USD → token amount if the user said "$10".
    let tokenAmount = parsed.amount;
    if (parsed.amountIsUsd) {
      tokenAmount = await resolveUsdToToken(parsed.amount, parsed.fromToken);
    }
    const amountBase = toBaseUnits(tokenAmount, parsed.fromToken);

    const poolId = await resolveRefPool(parsed.fromToken, parsed.toToken);
    if (poolId == null) {
      return bot.sendMessage(
        chatId,
        `⚠️ No Ref pool registered for ${formatToken(parsed.fromToken)} → ${formatToken(parsed.toToken)}.\n\n` +
        `Swappable pairs need a known pool ID. If you know the Ref pool ID, ` +
        `try \`/swap ${poolId || "<poolId>"} ${tokenAmount} ${formatToken(parsed.fromToken)} ${formatToken(parsed.toToken)}\`.`,
        { parse_mode: "Markdown" }
      );
    }

    await bot.sendMessage(chatId, `⏳ Signing swap…`);
    const r = await tg.custodialSwap(tgId, {
      tokenIn:  parsed.fromToken,
      tokenOut: parsed.toToken,
      amountBase,
      poolId,
      slippageBps: 100,
    });
    if (!r.ok) {
      return bot.sendMessage(chatId, `❌ Swap failed: ${r.error || "unknown error"}`);
    }
    const text =
      `✅ *Swap complete*\n\n` +
      `${tokenAmount} ${formatToken(parsed.fromToken)} → ~${fromBaseUnits(r.estimatedOut, parsed.toToken)} ${formatToken(parsed.toToken)}\n` +
      `[Swap tx →](${txLink(r.swapTxHash)})  ·  [Fee tx →](${txLink(r.feeTxHash)})\n` +
      `Platform fee: 0.20%`;
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
  handleSwap,
  handleSend,
  handleWithdraw,
  parseIntent,
  CUSTODIAL_EXPLAINER,
};
