// backend/services/socialMonitor.js
// Real-time social intelligence feed — aggregates trending data from free APIs.
const fetch = require("node-fetch");

const COINGECKO_API   = "https://api.coingecko.com/api/v3";
const DEXSCREENER_API = "https://api.dexscreener.com";
const TIMEOUT = 10000;

// In-memory cache
let cache = {
  trending: null,
  trendingAt: 0,
  twitterFeed: null,
  twitterFeedAt: 0,
};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const fetchJson = async (url, headers = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "AZUKA/1.0", "Accept": "application/json", ...headers },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    clearTimeout(timer);
    return null;
  }
};

/**
 * Fetch trending coins from CoinGecko (free, no key needed)
 */
async function getCoinGeckoTrending() {
  const data = await fetchJson(`${COINGECKO_API}/search/trending`);
  if (!data?.coins) return [];
  return data.coins.slice(0, 10).map(c => ({
    name: c.item.name,
    symbol: c.item.symbol,
    rank: c.item.market_cap_rank,
    price: c.item.data?.price ? `$${parseFloat(c.item.data.price).toFixed(6)}` : "unavailable",
    change24h: c.item.data?.price_change_percentage_24h?.usd
      ? `${c.item.data.price_change_percentage_24h.usd.toFixed(2)}%`
      : "unavailable",
    marketCap: c.item.data?.market_cap || "unavailable",
    sparkline: c.item.data?.sparkline || null,
    source: "coingecko_trending",
  }));
}

/**
 * Fetch boosted/trending tokens from DexScreener (free, no key needed)
 */
async function getDexScreenerTrending() {
  const data = await fetchJson(`${DEXSCREENER_API}/token-boosts/top/v1`);
  if (!Array.isArray(data)) return [];
  return data.slice(0, 10).map(t => ({
    name: t.tokenAddress,
    symbol: t.description || t.tokenAddress?.slice(0, 8),
    chain: t.chainId || "unknown",
    url: t.url || null,
    totalAmount: t.totalAmount || 0,
    source: "dexscreener_boosted",
  }));
}

/**
 * Fetch NEAR ecosystem trending from DexScreener
 * Uses wrap.near as anchor token to find all active NEAR pairs
 */
async function getNearTrending() {
  const data = await fetchJson(`${DEXSCREENER_API}/latest/dex/tokens/wrap.near`);
  if (!data?.pairs) return [];

  // Deduplicate by base token, keep highest volume pair for each
  const seen = new Map();
  for (const p of data.pairs) {
    const key = p.baseToken?.address || p.baseToken?.symbol;
    const existing = seen.get(key);
    if (!existing || (p.volume?.h24 || 0) > (existing.volume?.h24 || 0)) {
      seen.set(key, p);
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0))
    .slice(0, 5)
    .map(p => ({
      name: p.baseToken?.name || "Unknown",
      symbol: p.baseToken?.symbol || "?",
      contract: p.baseToken?.address || "",
      price: p.priceUsd ? `$${p.priceUsd}` : "unavailable",
      volume24h: p.volume?.h24 ? `$${Math.round(p.volume.h24).toLocaleString()}` : "unavailable",
      change24h: p.priceChange?.h24 != null ? `${p.priceChange.h24}%` : "unavailable",
      liquidity: p.liquidity?.usd ? `$${Math.round(p.liquidity.usd).toLocaleString()}` : "unavailable",
      dex: p.dexId || "unknown",
      source: "dexscreener_near",
    }));
}

/**
 * Search recent tweets about a topic via Twitter API v2
 * Requires TWITTER_BEARER_TOKEN in .env
 */
async function searchTwitter(query, maxResults = 10) {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) return { available: false, reason: "No Twitter API key configured" };

  const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}%20-is:retweet&max_results=${maxResults}&tweet.fields=created_at,public_metrics,author_id`;
  const data = await fetchJson(url, { Authorization: `Bearer ${token}` });
  if (!data?.data) return { available: true, tweets: [], query };

  return {
    available: true,
    query,
    count: data.meta?.result_count || 0,
    tweets: data.data.map(t => ({
      text: t.text?.slice(0, 200),
      created: t.created_at,
      likes: t.public_metrics?.like_count || 0,
      retweets: t.public_metrics?.retweet_count || 0,
      replies: t.public_metrics?.reply_count || 0,
    })),
  };
}

/**
 * Get aggregated trending data (cached for 5 min)
 */
async function getTrending() {
  const now = Date.now();
  if (cache.trending && (now - cache.trendingAt) < CACHE_TTL) {
    return cache.trending;
  }

  const [coingecko, dexBoosted, nearTrending] = await Promise.all([
    getCoinGeckoTrending(),
    getDexScreenerTrending(),
    getNearTrending(),
  ]);

  const result = {
    timestamp: new Date().toISOString(),
    coingeckoTrending: coingecko,
    dexScreenerBoosted: dexBoosted,
    nearEcosystem: nearTrending,
    twitterAvailable: !!process.env.TWITTER_BEARER_TOKEN,
  };

  cache.trending = result;
  cache.trendingAt = now;
  return result;
}

/**
 * Get social context string for AI enrichment
 */
async function getSocialContext() {
  const trending = await getTrending();
  const lines = ["--- LIVE SOCIAL INTELLIGENCE (fetched just now) ---"];

  if (trending.coingeckoTrending?.length) {
    lines.push("\nCoinGecko Trending:");
    trending.coingeckoTrending.slice(0, 5).forEach((c, i) =>
      lines.push(`${i + 1}. ${c.name} (${c.symbol}) — ${c.price}, 24h: ${c.change24h}`)
    );
  }

  if (trending.nearEcosystem?.length) {
    lines.push("\nNEAR Ecosystem Top Movers:");
    trending.nearEcosystem.forEach((t, i) =>
      lines.push(`${i + 1}. ${t.name} (${t.symbol}) — ${t.price}, Vol: ${t.volume24h}, 24h: ${t.change24h}`)
    );
  }

  lines.push("--- END SOCIAL INTELLIGENCE ---");
  return lines.join("\n");
}

module.exports = {
  getTrending,
  getCoinGeckoTrending,
  getDexScreenerTrending,
  getNearTrending,
  searchTwitter,
  getSocialContext,
};
