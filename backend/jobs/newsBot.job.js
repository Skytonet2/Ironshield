// backend/jobs/newsBot.job.js
//
// Autonomous news-aggregation account (spec §8C).
//
// Every 15 minutes: pull headlines from the configured RSS feeds,
// dedupe against posts we already published, insert the new ones as
// the IronNews feed_user (account_type='AGENT', verified=true). The
// post surfaces in every user's For-You stream like any other post;
// users mute the account via feed_muted_accounts to opt out.
//
// Seeding is idempotent — starts by ensuring the IronNews feed_user
// row exists. Its `wallet_address` is a synthetic sentinel
// (`sys:ironnews`) since it has no on-chain identity; feed_users
// requires UNIQUE wallet_address so we reserve this one namespace.
//
// Starts from backend/server.js on boot; no scheduler config needed.

const cron = require("node-cron");
const Parser = require("rss-parser");
const db = require("../db/client");

const BOT_WALLET_SENTINEL = "sys:ironnews";
const BOT_USERNAME = "ironnews";
const BOT_DISPLAY  = "AZUKA News";
const BOT_BIO      = "Autonomous news feed. Crypto headlines, live.";

// Feeds — all free, no API keys. The spec names these five as the
// initial set; new sources can be added here without a schema change.
const FEEDS = [
  { url: "https://www.coindesk.com/arc/outboundfeeds/rss/",       source: "CoinDesk" },
  { url: "https://www.theblock.co/rss.xml",                        source: "The Block" },
  { url: "https://decrypt.co/feed",                                source: "Decrypt" },
  { url: "https://cryptoslate.com/feed/",                          source: "CryptoSlate" },
  { url: "https://cointelegraph.com/rss",                          source: "Cointelegraph" },
];

const FETCH_TIMEOUT_MS = 15_000;
const MAX_ITEMS_PER_RUN = 30;  // cap so a feed backlog doesn't flood
const MAX_SUMMARY_CHARS = 280;

const parser = new Parser({
  timeout: FETCH_TIMEOUT_MS,
  headers: { "User-Agent": "AZUKA/news-bot +https://ironshield.pages.dev" },
});

/** Ensure the IronNews feed_user exists. Returns its id. */
async function ensureBotUser() {
  const sel = await db.query(
    "SELECT id FROM feed_users WHERE wallet_address = $1 LIMIT 1",
    [BOT_WALLET_SENTINEL]
  );
  if (sel.rows[0]) return sel.rows[0].id;
  const ins = await db.query(
    `INSERT INTO feed_users (wallet_address, username, display_name, bio,
                             account_type, verified, created_at)
     VALUES ($1, $2, $3, $4, 'AGENT', TRUE, NOW())
     ON CONFLICT (wallet_address) DO UPDATE SET username = EXCLUDED.username
     RETURNING id`,
    [BOT_WALLET_SENTINEL, BOT_USERNAME, BOT_DISPLAY, BOT_BIO]
  );
  return ins.rows[0].id;
}

/** Return the set of sourceUrl values we've already ingested. */
async function loadKnownUrls(botUserId) {
  // We stash the article URL in feed_posts.content as the last line
  // (the existing posts table has no sourceUrl column and the spec
  // said "extend, don't rewrite"). The URL matches the pattern
  // `\nhttps?://` at end-of-content, so LIKE lookup is cheap with
  // the existing idx_feed_posts_author index.
  const r = await db.query(
    `SELECT content FROM feed_posts
      WHERE author_id = $1
        AND deleted_at IS NULL
        AND created_at >= NOW() - INTERVAL '7 days'`,
    [botUserId]
  );
  const known = new Set();
  for (const row of r.rows) {
    const m = row.content && row.content.match(/(https?:\/\/\S+)\s*$/);
    if (m) known.add(m[1]);
  }
  return known;
}

async function fetchFeed({ url, source }) {
  try {
    const feed = await parser.parseURL(url);
    return (feed.items || []).map((item) => ({
      title: (item.title || "").trim(),
      link:  (item.link  || "").trim(),
      contentSnippet: item.contentSnippet || item.content || "",
      isoDate: item.isoDate || item.pubDate || null,
      source,
    }));
  } catch (e) {
    console.warn(`[newsbot] ${source} RSS failed: ${e.message}`);
    return [];
  }
}

function summarise(item) {
  const headline = item.title || "(untitled)";
  const snippet = item.contentSnippet
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SUMMARY_CHARS - headline.length - 10);
  const body = snippet ? `${headline}\n\n${snippet}` : headline;
  return `${body}\n${item.link}`;
}

/** One poll cycle. Exposed for testing + manual kickoff. */
async function runOnce() {
  const botId = await ensureBotUser();
  const known = await loadKnownUrls(botId);

  const batches = await Promise.all(FEEDS.map(fetchFeed));
  const fresh = [];
  for (const batch of batches) {
    for (const item of batch) {
      if (!item.link || known.has(item.link)) continue;
      fresh.push(item);
      known.add(item.link);
      if (fresh.length >= MAX_ITEMS_PER_RUN) break;
    }
    if (fresh.length >= MAX_ITEMS_PER_RUN) break;
  }

  if (fresh.length === 0) return { inserted: 0 };

  let inserted = 0;
  for (const item of fresh) {
    try {
      await db.query(
        `INSERT INTO feed_posts (author_id, content, media_type, created_at)
         VALUES ($1, $2, 'NONE', $3)`,
        [botId, summarise(item), item.isoDate ? new Date(item.isoDate) : new Date()]
      );
      inserted++;
    } catch (e) {
      console.warn(`[newsbot] insert failed for ${item.link}: ${e.message}`);
    }
  }
  console.log(`[newsbot] ingested ${inserted}/${fresh.length} items`);
  return { inserted };
}

let task;
function start() {
  if (task) return;
  // Every 15 minutes. Production-grade scheduler (node-cron handles
  // clock drift / restarts) and intentionally not tied to fixed
  // wall-clock offsets so two backend instances don't both fire at
  // :00 / :15 / :30 / :45.
  task = cron.schedule("*/15 * * * *", () => {
    runOnce().catch((e) => console.warn(`[newsbot] run failed: ${e.message}`));
  }, { scheduled: true });

  // Kick once on boot so a fresh backend doesn't wait 15 minutes
  // before the first RSS fetch. Delay 30s so DB migrations settle.
  setTimeout(() => {
    runOnce().catch((e) => console.warn(`[newsbot] initial run failed: ${e.message}`));
  }, 30_000);
  console.log("[newsbot] scheduled every 15 minutes");
}

function stop() {
  if (task) { task.stop(); task = null; }
}

module.exports = { start, stop, runOnce };
