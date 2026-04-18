// bot/jobs/priceMonitor.js — poll prices and trigger TG alerts
//
// Runs in-process with the bot. Every 90s:
//   1. Load all active `feed_tg_price_alerts`
//   2. Fetch current prices from CoinGecko (batched)
//   3. For each alert, check the condition and — if hit — send a
//      Telegram message, include inline "Buy/Sell" buttons pointing to
//      the site, then deactivate the alert so it doesn't fire again.

const fetch = require("node-fetch");
const db = require("../../backend/db/client");

const CG_MAP = {
  BTC: "bitcoin", ETH: "ethereum", NEAR: "near", SOL: "solana",
  MATIC: "matic-network", AVAX: "avalanche-2", DOT: "polkadot",
  ATOM: "cosmos", LINK: "chainlink",
};

async function getPrices(tokens) {
  const ids = [...new Set(tokens.map((t) => CG_MAP[t] || t.toLowerCase()))];
  if (!ids.length) return {};
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`);
    const j = await r.json();
    const byTok = {};
    for (const t of tokens) {
      const id = CG_MAP[t] || t.toLowerCase();
      if (j[id]?.usd != null) byTok[t] = j[id].usd;
    }
    return byTok;
  } catch { return {}; }
}

function evalAlert(a, price) {
  const v = Number(a.value);
  const base = Number(a.base_price || 0);
  switch (a.op) {
    case "above": return price >= v;
    case "below": return price <= v;
    case "mult":  return base > 0 && price / base >= v;
    case "pct":   return base > 0 && Math.abs((price - base) / base) * 100 >= Math.abs(v);
    default: return false;
  }
}

async function runOnce(bot) {
  try {
    const { rows } = await db.query(
      "SELECT id, tg_id, token, op, value, base_price FROM feed_tg_price_alerts WHERE active=TRUE"
    );
    if (!rows.length) return;
    const prices = await getPrices(rows.map((r) => r.token));

    for (const a of rows) {
      const price = prices[a.token];
      if (price == null) continue;
      if (!evalAlert(a, price)) continue;

      // Resolve chat_id from the TG link row
      const link = await db.query("SELECT tg_chat_id FROM feed_tg_links WHERE tg_id=$1", [a.tg_id]);
      const chatId = link.rows[0]?.tg_chat_id;
      if (!chatId) continue;

      const descr = a.op === "mult" ? `hit ${a.value}× target`
                  : a.op === "pct"  ? `moved ${a.value}%`
                  : `crossed ${a.op} $${Number(a.value).toLocaleString()}`;

      const buttons = [[
        { text: `💸 Buy ${a.token}`,  url: `https://ironshield.near.page/#/Trade?buy=${a.token}` },
        { text: `💵 Sell ${a.token}`, url: `https://ironshield.near.page/#/Trade?sell=${a.token}` },
      ]];

      bot.sendMessage(
        chatId,
        `🚨 *${a.token} ${descr}*\nNow: *$${price.toLocaleString()}*`,
        { parse_mode: "Markdown", reply_markup: { inline_keyboard: buttons } }
      ).catch(() => {});

      await db.query(
        "UPDATE feed_tg_price_alerts SET active=FALSE, triggered_at=NOW() WHERE id=$1",
        [a.id]
      );
    }
  } catch (e) {
    console.warn("[priceMonitor]", e.message);
  }
}

function start(bot) {
  if (!bot) return;
  runOnce(bot).catch(() => {});
  return setInterval(() => runOnce(bot).catch(() => {}), 90_000);
}

module.exports = { start, runOnce };
