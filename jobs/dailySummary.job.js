// jobs/dailySummary.job.js
require("dotenv").config();
const cron  = require("node-cron");
const fetch = require("node-fetch");
const fs    = require("fs");
const path  = require("path");

const BACKEND    = process.env.BACKEND_URL        || "http://localhost:3001";
const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN || "";
const GROUPS_FILE = path.join(__dirname, "data/trackedGroups.json");

const readGroups = () => { try { return JSON.parse(fs.readFileSync(GROUPS_FILE, "utf8")); } catch { return []; } };

const sendTelegram = async (chatId, text) => {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
};

async function runDailySummary() {
  console.log("[DailySummary] Running...");
  const groups = readGroups();
  for (const group of groups) {
    try {
      const res  = await fetch(`${BACKEND}/api/summary`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ source: "group", identifier: group.id, range: "24h", userId: "system", requestedVia: "job" }),
      });
      const json = await res.json();
      if (json.success && group.chatId) {
        const d = json.data;
        const text = [
          `📋 *Daily Summary — ${d.title || group.name}*`,
          ``,
          ...(d.keyPoints || []).slice(0, 5).map(p => `• ${p}`),
          d.tokensMentioned?.length ? `\n🪙 Tokens: ${d.tokensMentioned.join(", ")}` : "",
          d.redFlags?.length ? `\n🚩 Flags: ${d.redFlags[0]}` : "",
        ].filter(Boolean).join("\n");
        await sendTelegram(group.chatId, text);
      }
    } catch (err) {
      console.error(`[DailySummary] Error for group ${group.id}:`, err.message);
    }
  }
  console.log("[DailySummary] Done.");
}

// Run daily at 08:00 UTC
cron.schedule("0 8 * * *", runDailySummary, { timezone: "UTC" });
console.log("[DailySummary] Scheduled for 08:00 UTC daily");

// Uncomment to test immediately:
// runDailySummary();
