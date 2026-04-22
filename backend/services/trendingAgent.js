// trendingAgent.js — autonomous trending-topics producer.
//
// Runs a lightweight worker that, every 5 minutes:
//   1. Counts hashtag + $TICKER mentions in the last 24h of posts.
//   2. Compares against the previous 24h to label each topic "up"
//      or "down" (the arrow the FeedRightRail renders).
//   3. Writes the top-N to an in-memory cache AND a DB table the
//      /api/feed/trending endpoint reads. Memory keeps reads fast,
//      the table gives cold boots a coherent starting state.
//
// This is deliberately agent-ADJACENT rather than LLM-driven — no
// token cost, no rate-limit risk. The NEAR AI agent can later enrich
// each topic with a one-line summary via a separate job without
// blocking the trend computation itself.
//
// Pluggable external signals (CoinGecko trending, DexScreener boosts)
// are already exposed by socialMonitor.js; we merge their names into
// the set so a cold DB still produces useful results.

const db = require("../db/client");
let socialMonitor = null;
try { socialMonitor = require("./socialMonitor"); } catch { /* optional */ }

const REFRESH_MS = 5 * 60 * 1000;
const LIMIT = 10;

// In-memory cache. `topics` is the latest computed set. `lastRun`
// lets /api/feed/trending report age so stale responses are visible.
const state = {
  topics: [],
  lastRun: 0,
};

// Matches #foo, $FOO, or @foo (for account-as-topic). Case-insensitive
// for hashtags, preserved for $tickers (which are conventionally upper).
const TAG_RE = /(?:^|[^A-Za-z0-9_])(?:#([A-Za-z][A-Za-z0-9_]{1,24})|\$([A-Z][A-Z0-9]{1,9}))/g;

function extractTags(text) {
  const out = [];
  if (!text) return out;
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(text))) {
    if (m[1]) out.push({ tag: m[1], kind: "hash" });
    if (m[2]) out.push({ tag: m[2], kind: "ticker" });
  }
  return out;
}

async function ensureTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS agent_trending_topics (
      tag          TEXT PRIMARY KEY,
      kind         TEXT NOT NULL,
      count_now    INT  NOT NULL DEFAULT 0,
      count_prev   INT  NOT NULL DEFAULT 0,
      direction    TEXT NOT NULL DEFAULT 'up',
      summary      TEXT,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function countWindow(hours) {
  // Postgres regex — the simpler approach is to pull recent posts and
  // count in JS. Cheaper than regex'ing in-database at feed scale.
  const r = await db.query(
    `SELECT content FROM feed_posts
     WHERE deleted_at IS NULL
       AND created_at > NOW() - ($1 || ' hours')::interval`,
    [String(hours)]
  );
  const counts = new Map();
  for (const row of r.rows) {
    for (const { tag, kind } of extractTags(row.content)) {
      const k = `${kind}:${tag.toLowerCase()}`;
      const cur = counts.get(k);
      if (cur) { cur.count++; continue; }
      counts.set(k, { tag, kind, count: 1 });
    }
  }
  return counts;
}

async function externalSeeds() {
  if (!socialMonitor) return [];
  try {
    const t = await socialMonitor.getTrending();
    if (!Array.isArray(t)) return [];
    // socialMonitor returns coin-ish objects with { symbol, name, ... }
    return t.slice(0, 8).map((c) => ({
      tag: String(c.symbol || c.ticker || c.name || "").replace(/[^A-Za-z0-9_]/g, ""),
      kind: "ticker",
      extCount: Number(c.score || 0),
    })).filter((x) => x.tag.length >= 2);
  } catch { return []; }
}

async function computeOnce() {
  try {
    await ensureTable();
    const [nowCounts, prevCounts] = await Promise.all([
      countWindow(24),   // last 24h
      countWindow(48),   // last 48h (contains last 24h; we derive prev by subtracting)
    ]);

    // Seed with external trending so a fresh DB still has rows.
    const ext = await externalSeeds();
    for (const e of ext) {
      const k = `${e.kind}:${e.tag.toLowerCase()}`;
      if (!nowCounts.has(k)) nowCounts.set(k, { tag: e.tag, kind: e.kind, count: 1 });
    }

    // prev = 48h - 24h → activity in the previous window only.
    const merged = [];
    for (const [k, now] of nowCounts) {
      const prev48 = prevCounts.get(k)?.count || 0;
      const prev24 = Math.max(0, prev48 - now.count);
      merged.push({
        tag: now.tag,
        kind: now.kind,
        count_now: now.count,
        count_prev: prev24,
        direction: now.count >= prev24 ? "up" : "down",
      });
    }
    merged.sort((a, b) => b.count_now - a.count_now);
    const top = merged.slice(0, LIMIT);

    // Upsert top set; anything not in top becomes stale but stays
    // in the table for a day so comparisons remain coherent.
    await db.transaction(async (client) => {
      for (const r of top) {
        await client.query(
          `INSERT INTO agent_trending_topics (tag, kind, count_now, count_prev, direction, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (tag) DO UPDATE SET
             kind = EXCLUDED.kind,
             count_now = EXCLUDED.count_now,
             count_prev = EXCLUDED.count_prev,
             direction = EXCLUDED.direction,
             updated_at = NOW()`,
          [r.tag, r.kind, r.count_now, r.count_prev, r.direction]
        );
      }
    });

    state.topics = top;
    state.lastRun = Date.now();
  } catch (e) {
    // Non-fatal. Keeps serving whatever topics were in memory last.
    // eslint-disable-next-line no-console
    console.warn("[trendingAgent] compute failed:", e.message || e);
  }
}

function start() {
  // Run immediately on boot, then every REFRESH_MS.
  computeOnce();
  setInterval(computeOnce, REFRESH_MS).unref?.();
}

async function getTopics(limit = 5) {
  if (state.topics.length === 0) {
    // Cold read: try the DB table before falling back to empty.
    try {
      const r = await db.query(
        `SELECT tag, kind, count_now, count_prev, direction, summary
         FROM agent_trending_topics ORDER BY count_now DESC LIMIT $1`,
        [limit * 2]
      );
      return r.rows.slice(0, limit).map((row) => ({
        tag: row.tag,
        kind: row.kind,
        count: row.count_now,
        direction: row.direction,
        summary: row.summary,
      }));
    } catch { return []; }
  }
  return state.topics.slice(0, limit).map((r) => ({
    tag: r.tag,
    kind: r.kind,
    count: r.count_now,
    direction: r.direction,
  }));
}

module.exports = { start, getTopics, computeOnce };
