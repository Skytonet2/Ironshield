// bot/jobs/downtimeMonitor.js — pings the site, broadcasts up/down flips
//
// Fetches the health URL every 2 minutes. On a *persistent* status flip
// (confirmed across consecutive checks) sends a broadcast to every TG
// user who hasn't opted out of `downtime` alerts.
//
// Why the defaults matter:
//
// - Pings `ironshield.pages.dev` (Cloudflare Pages CDN) directly instead
//   of `ironshield.near.page`. The `.near.page` gateway resolves via a
//   NEAR RPC → `web4_get` on `ironshield.near` → redirect, and the
//   legacy RPC has been rate-limiting with 429s ("STOP USING IT NOW").
//   Those RPC hiccups were tripping the 10s fetch timeout and flipping
//   the monitor to "unreachable" every ~15 min even though Cloudflare
//   itself was rock-solid. Pages.dev is a pure CDN — no NEAR chain in
//   the path — so a failure here is actually a failure.
//
// - Requires 2 consecutive misses before declaring down, and 1 success
//   to declare up. Single-flake dampening without slowing recovery.
//
// - Timeout bumped to 15s to absorb ordinary Cloudflare edge warmups.

const fetch = require("node-fetch");
const db = require("../../backend/db/client");

const HEALTH_URL = process.env.SITE_HEALTH_URL || "https://ironshield.pages.dev";
const FETCH_TIMEOUT_MS   = Number(process.env.SITE_HEALTH_TIMEOUT_MS || 15_000);
const DOWN_STREAK_NEEDED = Number(process.env.SITE_HEALTH_DOWN_STREAK || 2);
let lastUp = true;
let consecutiveFails = 0;

async function ping() {
  try {
    const r = await fetch(HEALTH_URL, { timeout: FETCH_TIMEOUT_MS });
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
  if (up) {
    consecutiveFails = 0;
    if (!lastUp) {
      lastUp = true;
      await broadcast(bot, "✅ *IronShield is back online.*");
    }
    return;
  }
  // Miss: only flip to "down" after DOWN_STREAK_NEEDED consecutive
  // fails so single transient timeouts don't spam the channel.
  consecutiveFails += 1;
  if (lastUp && consecutiveFails >= DOWN_STREAK_NEEDED) {
    lastUp = false;
    await broadcast(bot, "🚨 *IronShield site is unreachable.* We'll notify you when it's back.");
  }
}

function start(bot) {
  runOnce(bot).catch(() => {});
  return setInterval(() => runOnce(bot).catch(() => {}), 120_000);
}

module.exports = { start, runOnce };
