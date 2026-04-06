// jobs/portfolioUpdate.job.js
require("dotenv").config();
const cron  = require("node-cron");
const fetch = require("node-fetch");
const fs    = require("fs");
const path  = require("path");

const BACKEND    = process.env.BACKEND_URL        || "http://localhost:3001";
const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN || "";
const USERS_FILE = path.join(__dirname, "data/users.json");
const CACHE_FILE = path.join(__dirname, "data/portfolioCache.json");

const readJson  = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const writeJson = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));

const sendTelegram = async (chatId, text) => {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
};

async function runPortfolioUpdate() {
  const users = readJson(USERS_FILE) || [];
  const cache = readJson(CACHE_FILE) || {};

  for (const user of users.filter(u => u.wallets?.length && u.chatId)) {
    try {
      const res  = await fetch(`${BACKEND}/api/portfolio`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fetch", userId: user.userId }),
      });
      const json = await res.json();
      if (!json.success) continue;

      const newVal = json.data.totalNetWorthUSD || 0;
      const oldVal = cache[user.userId] || newVal;
      const change = oldVal > 0 ? ((newVal - oldVal) / oldVal) * 100 : 0;

      if (Math.abs(change) >= 5) {
        const dir  = change > 0 ? "📈" : "📉";
        const sign = change > 0 ? "+" : "";
        await sendTelegram(user.chatId,
          `${dir} *Portfolio Alert*\n\nYour portfolio moved *${sign}${change.toFixed(2)}%* in the last 15 minutes.\nNew value: *$${newVal.toLocaleString()}*`
        );
      }

      cache[user.userId] = newVal;
    } catch (err) {
      console.error(`[PortfolioUpdate] Error for user ${user.userId}:`, err.message);
    }
  }

  writeJson(CACHE_FILE, cache);
}

cron.schedule("*/15 * * * *", runPortfolioUpdate);
console.log("[PortfolioUpdate] Scheduled every 15 minutes");
