// bot/commands/trending.js
const fetch   = require("node-fetch");
const BACKEND = process.env.BACKEND_URL || "http://localhost:3001";

// Escape Markdown v1 special chars
const esc = (text) => String(text || "").replace(/([_*`\[])/g, "\\$1");

async function handle(bot, msg) {
  const chatId = msg.chat.id;
  const waitMsg = await bot.sendMessage(chatId, "📡 Fetching live market trends...");

  try {
    const res  = await fetch(`${BACKEND}/api/trending`);
    const json = await res.json();
    await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});

    if (!json.success) {
      return bot.sendMessage(chatId, "⚠️ Could not fetch trending data. Try again later.");
    }

    const d = json.data;
    const lines = [
      `📡 *IronClaw Live Trends*`,
      `━━━━━━━━━━━━━━━━━━`,
    ];

    // CoinGecko trending
    if (d.coingeckoTrending?.length) {
      lines.push(`\n🔥 *Trending on CoinGecko*`);
      d.coingeckoTrending.slice(0, 7).forEach((c, i) => {
        const change = c.change24h !== "unavailable" ? ` (${esc(c.change24h)})` : "";
        lines.push(`${i + 1}. *${esc(c.name)}* (${esc(c.symbol)}) — ${esc(c.price)}${change}`);
      });
    }

    // NEAR ecosystem
    if (d.nearEcosystem?.length) {
      lines.push(`\n🌐 *NEAR Ecosystem Top Movers*`);
      d.nearEcosystem.forEach((t, i) => {
        lines.push(`${i + 1}. *${esc(t.name)}* (${esc(t.symbol)}) — ${esc(t.price)}`);
        lines.push(`   Vol: ${esc(t.volume24h)} | 24h: ${esc(t.change24h)} | Liq: ${esc(t.liquidity)}`);
      });
    }

    // DexScreener boosted
    if (d.dexScreenerBoosted?.length) {
      lines.push(`\n🚀 *DexScreener Boosted*`);
      d.dexScreenerBoosted.slice(0, 5).forEach((t, i) => {
        lines.push(`${i + 1}. ${esc(t.symbol)} (${esc(t.chain)})`);
      });
    }

    // Twitter status
    lines.push(d.twitterAvailable
      ? `\n🐦 *Twitter monitoring: Active*`
      : `\n🐦 Twitter monitoring: Inactive (no API key)`
    );

    lines.push(`\n_Updated: ${new Date(d.timestamp).toLocaleTimeString("en-US", { hour12: false })}_`);

    const formatted = lines.join("\n");
    try {
      await bot.sendMessage(chatId, formatted, { parse_mode: "Markdown" });
    } catch {
      await bot.sendMessage(chatId, formatted.replace(/[*_`]/g, ""));
    }
  } catch (err) {
    await bot.deleteMessage(chatId, waitMsg.message_id).catch(() => {});
    await bot.sendMessage(chatId, "⚠️ Trending fetch failed. Try again.");
  }
}

module.exports = { handle };
