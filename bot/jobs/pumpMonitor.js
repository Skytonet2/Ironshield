// bot/jobs/pumpMonitor.js — detect sudden volume/price surges on newscoins
//
// Compares the latest 10-minute trade window against the prior 60-minute
// baseline. If volume or price jumps ≥3× (volume) or ≥20% (price), we
// fan out a "pump" notification to everyone who has (a) the coin in
// their watchlist, or (b) `pump` globally enabled.

const db = require("../../backend/db/client");

const PUMP_VOL_MULT = 3;   // latest 10m volume ≥ 3× prior hour avg 10m
const PUMP_PCT = 20;       // ≥ 20% price jump in 10m

async function runOnce(bot) {
  try {
    const { rows: coins } = await db.query(`
      SELECT c.id, c.ticker, c.name,
             (SELECT COALESCE(SUM(near_amount),0) FROM feed_newscoin_trades t
                WHERE t.coin_id=c.id AND t.created_at > NOW() - INTERVAL '10 minutes') AS vol10,
             (SELECT COALESCE(SUM(near_amount),0)/6 FROM feed_newscoin_trades t
                WHERE t.coin_id=c.id AND t.created_at BETWEEN NOW() - INTERVAL '70 minutes' AND NOW() - INTERVAL '10 minutes') AS vol_baseline,
             (SELECT price FROM feed_newscoin_trades t WHERE t.coin_id=c.id ORDER BY t.created_at DESC LIMIT 1) AS price_now,
             (SELECT price FROM feed_newscoin_trades t WHERE t.coin_id=c.id AND t.created_at < NOW() - INTERVAL '10 minutes' ORDER BY t.created_at DESC LIMIT 1) AS price_prev
        FROM feed_newscoins c
       WHERE c.is_killed = FALSE
    `);

    for (const c of coins) {
      const vol10 = Number(c.vol10 || 0);
      const base = Number(c.vol_baseline || 0);
      const pNow = Number(c.price_now || 0);
      const pPrev = Number(c.price_prev || 0);
      const volHit = base > 0 && vol10 >= PUMP_VOL_MULT * base;
      const pctHit = pPrev > 0 && pNow > 0 && ((pNow - pPrev) / pPrev) * 100 >= PUMP_PCT;
      if (!volHit && !pctHit) continue;

      const pctStr = pPrev > 0 ? `${(((pNow - pPrev) / pPrev) * 100).toFixed(1)}%` : "n/a";
      const text = `📈 *${c.ticker}* is pumping!\n${volHit ? `• Volume ${(vol10 / (base || 1)).toFixed(1)}× baseline\n` : ""}${pctHit ? `• Price ${pctStr} in 10 min\n` : ""}\n[Open on IronShield](https://ironshield.near.page/#/NewsCoin?id=${c.id})`;

      // Fan out to pump-enabled users & watchers
      const { rows: recipients } = await db.query(`
        SELECT DISTINCT l.tg_chat_id
          FROM feed_tg_links l
         WHERE (l.settings->>'pump')::boolean IS NOT FALSE
            OR EXISTS (
              SELECT 1 FROM feed_tg_watchlist w
               WHERE w.tg_id = l.tg_id AND w.kind='token' AND UPPER(w.value)=UPPER($1)
            )
      `, [c.ticker]);

      const buttons = [[
        { text: "📊 View chart", url: `https://ironshield.near.page/#/NewsCoin?id=${c.id}` },
        { text: "💸 Buy",  url: `https://ironshield.near.page/#/NewsCoin?id=${c.id}&buy=1` },
      ]];

      for (const row of recipients) {
        bot.sendMessage(row.tg_chat_id, text, {
          parse_mode: "Markdown",
          disable_web_page_preview: true,
          reply_markup: { inline_keyboard: buttons },
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.warn("[pumpMonitor]", e.message);
  }
}

function start(bot) {
  // Run every 10 minutes — aligns with the window.
  runOnce(bot).catch(() => {});
  return setInterval(() => runOnce(bot).catch(() => {}), 600_000);
}

module.exports = { start, runOnce };
