// bot/commands/digest.js — on-demand /digest

const { runOnce } = require("../jobs/dailyDigest");
const { buildUserDigest } = (() => {
  const d = require("../jobs/dailyDigest");
  // `buildUserDigest` isn't exported; fall back via runOnce if missing.
  return { buildUserDigest: d.buildUserDigest };
})();
const db = require("../../backend/db/client");

async function handle(bot, msg) {
  const chatId = msg.chat.id;
  const link = await db.query("SELECT user_id FROM feed_tg_links WHERE tg_id=$1", [msg.from.id]);
  const userId = link.rows[0]?.user_id;
  if (!userId) return bot.sendMessage(chatId, "Link a wallet first — just paste it here.");

  // Compact per-user digest using the same SQL the cron job would run.
  const notif = await db.query(
    `SELECT type, COUNT(*)::int AS c
       FROM feed_notifications
      WHERE user_id=$1 AND created_at > NOW() - INTERVAL '24 hours'
      GROUP BY type`,
    [userId]
  );
  const tips = await db.query(
    `SELECT COALESCE(SUM(amount_usd),0)::numeric(18,2) AS usd, COUNT(*)::int AS n
       FROM feed_tips WHERE author_id=$1 AND created_at > NOW() - INTERVAL '24 hours'`,
    [userId]
  );
  const notifLines = notif.rows.length
    ? notif.rows.map(n => `• ${n.c} × ${n.type}`).join("\n")
    : "• No activity";
  const tipLine = Number(tips.rows[0].n) > 0 ? `\n\n💰 *$${tips.rows[0].usd}* in tips (${tips.rows[0].n})` : "";
  await bot.sendMessage(
    chatId,
    `☀️ *Your 24h digest*\n\n${notifLines}${tipLine}`,
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: [[{ text: "Open IronShield", url: "https://ironshield.near.page" }]] },
    }
  );
}

module.exports = { handle };
