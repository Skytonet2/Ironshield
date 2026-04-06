// jobs/alertTrigger.job.js
require("dotenv").config();
const cron  = require("node-cron");
const fetch = require("node-fetch");
const fs    = require("fs");
const path  = require("path");

const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN || "";
const ALERTS_FILE = path.join(__dirname, "data/alerts.json");

const readAlerts  = () => { try { return JSON.parse(fs.readFileSync(ALERTS_FILE, "utf8")); } catch { return []; } };
const writeAlerts = (d) => fs.writeFileSync(ALERTS_FILE, JSON.stringify(d, null, 2));

const sendTelegram = async (chatId, text) => {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
};

const getCoinPrice = async (tokenId) => {
  const res  = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${tokenId}&vs_currencies=usd`);
  const json = await res.json();
  return json[tokenId]?.usd || null;
};

async function runAlertTrigger() {
  const alerts  = readAlerts();
  let   changed = false;

  for (const alert of alerts.filter(a => !a.triggered)) {
    try {
      if (alert.type === "price_above" || alert.type === "price_below") {
        const price = await getCoinPrice(alert.tokenId);
        if (price === null) continue;
        const hit = alert.type === "price_above" ? price >= alert.threshold : price <= alert.threshold;
        if (hit) {
          const dir = alert.type === "price_above" ? "above" : "below";
          await sendTelegram(alert.chatId,
            `🔔 *Price Alert Triggered*\n\n${alert.token} is now *$${price}* — ${dir} your threshold of *$${alert.threshold}*`
          );
          alert.triggered = true;
          changed = true;
        }
      }
    } catch (err) {
      console.error(`[AlertTrigger] Error for alert ${alert.id}:`, err.message);
    }
  }

  if (changed) writeAlerts(alerts);
}

cron.schedule("*/5 * * * *", runAlertTrigger);
console.log("[AlertTrigger] Scheduled every 5 minutes");
