// bot/commands/alert.js — price alerts (upgraded)
//
// Supports:
//   /alert $TOKEN 10x           → fires when price multiplies 10×
//   /alert SOL 5%               → fires on a 5% move (up or down)
//   /alert NEAR above $10       → fires above a threshold
//   /alert BTC below $50000
//   /alert list                 → show active alerts
//   /alert remove <id>          → cancel an alert
//
// Uses backend /api/tg/price-alerts so alerts persist with the user
// and the price monitor can deliver notifications.

const fetch = require("node-fetch");
const { tg } = require("../services/backend");

// Common tickers → CoinGecko IDs for the "current price" lookup that
// anchors `pct` and `mult` alerts.
const TOKEN_MAP = {
  btc: "bitcoin", bitcoin: "bitcoin",
  eth: "ethereum", ethereum: "ethereum",
  near: "near", sol: "solana", solana: "solana",
  matic: "matic-network", polygon: "matic-network",
  avax: "avalanche-2", dot: "polkadot",
  atom: "cosmos", link: "chainlink",
};

async function getPrice(tokenId) {
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${tokenId}&vs_currencies=usd`);
    const j = await r.json();
    return j[tokenId]?.usd || null;
  } catch { return null; }
}

function parseArgs(text) {
  const args = text.replace(/^\/alert(@\w+)?\s*/i, "").trim();
  if (!args || args === "list") return { action: "list" };
  if (/^remove\s+\d+/i.test(args)) {
    return { action: "remove", id: parseInt(args.match(/\d+/)[0]) };
  }
  // 10x / 10× / 2x multiplier
  let m = args.match(/^\$?(\w+)\s+(\d+(?:\.\d+)?)\s*[x×]$/i);
  if (m) return { action: "add", token: m[1], op: "mult", value: Number(m[2]) };
  // 5% move
  m = args.match(/^\$?(\w+)\s+([+-]?\d+(?:\.\d+)?)\s*%$/i);
  if (m) return { action: "add", token: m[1], op: "pct", value: Number(m[2]) };
  // above/below price
  m = args.match(/^\$?(\w+)\s+(above|below)\s+\$?([\d,.]+)$/i);
  if (m) return { action: "add", token: m[1], op: m[2].toLowerCase(), value: Number(m[3].replace(/,/g, "")) };
  return { action: "help" };
}

async function handle(bot, msg) {
  const chatId = msg.chat.id;
  const tgId = msg.from.id;
  const parsed = parseArgs(msg.text || "");

  if (parsed.action === "help") {
    return bot.sendMessage(chatId,
      "*Usage*\n`/alert $TOKEN 10x` — price multiplier\n`/alert SOL 5%` — percent move\n`/alert NEAR above $10`\n`/alert BTC below $50000`\n`/alert list` — show alerts\n`/alert remove <id>` — cancel",
      { parse_mode: "Markdown" }
    );
  }

  if (parsed.action === "list") {
    const r = await tg.listAlerts(tgId);
    if (!r.ok) return bot.sendMessage(chatId, "Link a wallet first — just paste your address.");
    const active = (r.alerts || []).filter(a => a.active);
    if (!active.length) return bot.sendMessage(chatId, "No active alerts. Set one with `/alert $TOKEN 10x`", { parse_mode: "Markdown" });
    const lines = ["🔔 *Active alerts*\n"];
    for (const a of active) {
      const desc = a.op === "mult" ? `${a.value}×`
                 : a.op === "pct"  ? `${a.value}% move`
                 : `${a.op} $${Number(a.value).toLocaleString()}`;
      lines.push(`${a.id}. ${a.token} — ${desc}`);
    }
    lines.push("\nRemove with `/alert remove <id>`");
    return bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });
  }

  if (parsed.action === "remove") {
    await tg.removeAlert(parsed.id);
    return bot.sendMessage(chatId, `🗑 Alert ${parsed.id} removed.`);
  }

  // add
  const tokenKey = String(parsed.token).toLowerCase();
  const tokenId = TOKEN_MAP[tokenKey] || tokenKey;
  const basePrice = (parsed.op === "mult" || parsed.op === "pct") ? await getPrice(tokenId) : null;

  const r = await tg.addAlert({
    tgId,
    token: parsed.token.toUpperCase(),
    op: parsed.op,
    value: parsed.value,
    basePrice,
  });
  if (!r.ok) return bot.sendMessage(chatId, `⚠️ ${r.error || "failed"}`);

  const desc = parsed.op === "mult" ? `multiplies ${parsed.value}× (from $${basePrice?.toLocaleString() || "?"})`
             : parsed.op === "pct"  ? `moves ${parsed.value}% (from $${basePrice?.toLocaleString() || "?"})`
             : `${parsed.op} $${parsed.value.toLocaleString()}`;
  await bot.sendMessage(chatId,
    `🔔 *Alert ${r.id} set*\n\nNotify when *${parsed.token.toUpperCase()}* ${desc}.`,
    { parse_mode: "Markdown" }
  );
}

module.exports = { handle };
