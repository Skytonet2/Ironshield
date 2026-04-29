// bot/jobs/dailyDigest.js — 08:00 local digest per linked user
//
// Pulls stats from feed_notifications + feed_tips + feed_newscoin_trades
// for the last 24h and ships a compact summary to each TG chat that has
// `digest` enabled (default on).

const db = require("../../backend/db/client");

function scheduleAt8AM(fn) {
  // Fire once every 60s; run when local hour just turned 8 and we
  // haven't fired yet today.
  let lastDay = null;
  return setInterval(async () => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    if (now.getHours() === 8 && day !== lastDay) {
      lastDay = day;
      try { await fn(); } catch (e) { console.warn("[digest]", e.message); }
    }
  }, 60_000);
}

async function buildUserDigest(userId) {
  // New notifications
  const notif = await db.query(
    `SELECT type, COUNT(*)::int AS c
       FROM feed_notifications
      WHERE user_id=$1 AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY type`,
    [userId]
  );
  // Tips received
  const tips = await db.query(
    `SELECT COALESCE(SUM(amount_usd),0)::numeric(18,2) AS usd, COUNT(*)::int AS n
       FROM feed_tips WHERE author_id=$1 AND created_at > NOW() - INTERVAL '24 hours'`,
    [userId]
  );
  return { notif: notif.rows, tips: tips.rows[0] };
}

async function runOnce(bot) {
  const links = await db.query(
    "SELECT tg_chat_id, user_id, settings FROM feed_tg_links WHERE user_id IS NOT NULL"
  );
  for (const row of links.rows) {
    const s = row.settings || {};
    if (s.digest === false) continue;

    const d = await buildUserDigest(row.user_id).catch(() => null);
    if (!d) continue;

    const notifLines = d.notif.length
      ? d.notif.map(n => `• ${n.c} × ${n.type}`).join("\n")
      : "• No activity";
    const tipLine = Number(d.tips.n) > 0
      ? `💰 *$${d.tips.usd}* in tips (${d.tips.n})`
      : "";

    const text = `☀️ *Your 24h digest*\n\n${notifLines}${tipLine ? "\n\n" + tipLine : ""}\n\nOpen AZUKA to catch up.`;
    bot.sendMessage(row.tg_chat_id, text, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "Open AZUKA", url: "https://ironshield.near.page" }]] },
    }).catch(() => {});
  }
}

function start(bot) {
  return scheduleAt8AM(() => runOnce(bot));
}

module.exports = { start, runOnce };
