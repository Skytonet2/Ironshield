// bot/jobs/downtimeMonitor.js — pings the site, broadcasts up/down flips
//
// Fetches `/health` every 2 minutes. On a status flip (up → down or
// down → up) sends a broadcast to every TG user who hasn't opted out
// of `downtime` alerts.

const fetch = require("node-fetch");
const db = require("../../backend/db/client");

const HEALTH_URL = process.env.SITE_HEALTH_URL || "https://ironshield.near.page";
let lastUp = true;

async function ping() {
  try {
    const r = await fetch(HEALTH_URL, { timeout: 10_000 });
    return r.ok;
  } catch { return false; }
}

async function broadcast(bot, text) {
  const { rows } = await db.query(
    "SELECT tg_chat_id FROM feed_tg_links WHERE (settings->>'downtime')::boolean IS NOT FALSE"
  );
  for (const row of rows) {
    bot.sendMessage(row.tg_chat_id, text, { parse_mode: "Markdown" }).catch(() => {});
  }
}

async function runOnce(bot) {
  const up = await ping();
  if (up === lastUp) return;
  lastUp = up;
  await broadcast(bot, up
    ? "✅ *IronShield is back online.*"
    : "🚨 *IronShield site is unreachable.* We'll notify you when it's back.");
}

function start(bot) {
  runOnce(bot).catch(() => {});
  return setInterval(() => runOnce(bot).catch(() => {}), 120_000);
}

module.exports = { start, runOnce };
