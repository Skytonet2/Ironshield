// bot/commands/alert.js — price alerts
const fetch   = require("node-fetch");
const BACKEND = process.env.BACKEND_URL || "http://localhost:3001";

// Common token aliases → CoinGecko IDs
const TOKEN_MAP = {
  btc: "bitcoin", bitcoin: "bitcoin",
  eth: "ethereum", ethereum: "ethereum",
  near: "near", sol: "solana", solana: "solana",
  matic: "matic-network", polygon: "matic-network",
  avax: "avalanche-2", dot: "polkadot",
  atom: "cosmos", link: "chainlink",
};

async function handle(bot, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const text   = (msg.text || "").trim();
  const args   = text.replace(/^\/alert(@\w+)?\s*/i, "").trim();

  // /alert list
  if (args === "list" || !args) {
    return listAlerts(bot, chatId, userId);
  }

  // /alert TOKEN above/below PRICE
  const match = args.match(/^(\w+)\s+(above|below)\s+\$?([\d,.]+)$/i);
  if (!match) {
    return bot.sendMessage(chatId,
      "Usage:\n/alert NEAR above $10\n/alert BTC below $50000\n/alert list — view your alerts"
    );
  }

  const [, tokenRaw, direction, priceRaw] = match;
  const tokenKey = tokenRaw.toLowerCase().replace(/^\$/, "");
  const tokenId  = TOKEN_MAP[tokenKey] || tokenKey;
  const threshold = parseFloat(priceRaw.replace(/,/g, ""));
  const alertType = direction.toLowerCase() === "above" ? "price_above" : "price_below";

  // Verify token exists on CoinGecko
  try {
    const priceRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${tokenId}&vs_currencies=usd`);
    const priceData = await priceRes.json();
    const currentPrice = priceData[tokenId]?.usd;

    if (!currentPrice) {
      return bot.sendMessage(chatId, `⚠️ Could not find token "${tokenRaw}". Try the CoinGecko ID (e.g., "near", "bitcoin").`);
    }

    // Save alert to file (will be migrated to DB)
    const fs   = require("fs");
    const path = require("path");
    const ALERTS_FILE = path.join(__dirname, "../../jobs/data/alerts.json");
    let alerts = [];
    try { alerts = JSON.parse(fs.readFileSync(ALERTS_FILE, "utf8")); } catch {}

    alerts.push({
      id: Date.now().toString(),
      userId,
      chatId: chatId.toString(),
      tokenId,
      token: tokenRaw.toUpperCase(),
      type: alertType,
      threshold,
      triggered: false,
      createdAt: new Date().toISOString(),
    });

    fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2));

    const dir = alertType === "price_above" ? "rises above" : "drops below";
    await bot.sendMessage(chatId,
      `🔔 *Alert Set*\n\nYou'll be notified when *${tokenRaw.toUpperCase()}* ${dir} *$${threshold.toLocaleString()}*\n\nCurrent price: *$${currentPrice.toLocaleString()}*\n\nUse /alert list to see your alerts.`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    await bot.sendMessage(chatId, "⚠️ Failed to set alert. Please try again.");
  }
}

async function listAlerts(bot, chatId, userId) {
  const fs   = require("fs");
  const path = require("path");
  const ALERTS_FILE = path.join(__dirname, "../../jobs/data/alerts.json");
  let alerts = [];
  try { alerts = JSON.parse(fs.readFileSync(ALERTS_FILE, "utf8")); } catch {}

  const userAlerts = alerts.filter(a => a.userId === userId && !a.triggered);
  if (!userAlerts.length) {
    return bot.sendMessage(chatId, "You have no active alerts.\n\nSet one: /alert NEAR above $10");
  }

  const lines = ["🔔 *Your Active Alerts*\n"];
  userAlerts.forEach((a, i) => {
    const dir = a.type === "price_above" ? "above" : "below";
    lines.push(`${i + 1}. ${a.token} ${dir} $${a.threshold.toLocaleString()}`);
  });

  await bot.sendMessage(chatId, lines.join("\n"), { parse_mode: "Markdown" });
}

module.exports = { handle };
