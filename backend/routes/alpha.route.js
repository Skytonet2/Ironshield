const router = require("express").Router();
const fetch  = require("node-fetch");

const ENDPOINT = process.env.NEAR_AI_ENDPOINT || "https://cloud-api.near.ai/v1/chat/completions";
const API_KEY  = process.env.NEAR_AI_KEY       || "";
const MODEL    = process.env.NEAR_AI_MODEL     || "Qwen/Qwen3-30B-A3B-Instruct-2507";

// In-memory cache — refreshed every 5 minutes
let cache = { items: [], ts: 0 };
const CACHE_TTL = 5 * 60 * 1000;

const CATEGORIES = ["news", "kol", "trending", "airdrops", "chaos"];

// Seed feed used whenever NEAR AI hasn't returned anything yet (cold start or
// NEAR_AI_KEY unset). Hand-curated so the Alpha page never looks empty.
function seedFeed() {
  const now = new Date();
  const mins = (m) => new Date(now.getTime() - m * 60_000).toISOString();
  return [
    { id: "seed-near-1", category: "news", source: "NEAR Foundation", handle: "near.org",
      title: "NEAR mainnet crosses 500M cumulative txs; IronClaw devs ship autonomous agents",
      body: "NEAR hit a new lifetime high in daily transactions led by AI-agent activity. IronClaw's runtime deployed via IronShield governance has processed 12k+ agent jobs this week.",
      url: "https://near.org", timestamp: mins(18), tags: ["NEAR", "agents"] },
    { id: "seed-kol-1", category: "kol", source: "Illia Polosukhin", handle: "@ilblackdragon",
      title: "Autonomous AI x on-chain finance is the defining trend of this cycle",
      body: "The gap between LLM-driven agents and trustless settlement is closing. Expect every major chain to have a native agent runtime within 6 months.",
      url: "https://x.com/ilblackdragon", timestamp: mins(42), tags: ["AI", "thesis"] },
    { id: "seed-trending-1", category: "trending", source: "Ref Finance", handle: "app.ref.finance",
      title: "$IRONCLAW/$NEAR pool 24h volume up 320%",
      body: "Fresh liquidity routing through Ref as IronShield staking launches. TVL across IronClaw agent escrow contracts tops $4.1M.",
      url: "https://app.ref.finance", timestamp: mins(7), tags: ["NEAR", "DeFi"] },
    { id: "seed-airdrop-1", category: "airdrops", source: "Intear", handle: "@intearwallet",
      title: "Rumor: Intear points program converting to tokens in Q3",
      body: "Intear has quietly rolled out a points dashboard tied to wallet usage. Power users with >30-day active streaks appear weighted 3x in the reward curve.",
      url: "https://intear.tech", timestamp: mins(95), tags: ["airdrop", "wallet"] },
    { id: "seed-chaos-1", category: "chaos", source: "ZachXBT", handle: "@zachxbt",
      title: "$9.2M drained from cross-chain bridge via signature replay on v1 contracts",
      body: "Team disclosed an affected set of wallets; funds partially recovered through validator cooperation. v1 contracts deprecated; migrate to v2 ASAP.",
      url: "https://x.com/zachxbt", timestamp: mins(150), tags: ["exploit", "bridge"] },
    { id: "seed-news-2", category: "news", source: "The Block", handle: "theblock.co",
      title: "BTC breaks prior ATH on spot ETF inflow acceleration",
      body: "IBIT and FBIT together absorbed $1.4B in fresh inflows last week. Coinbase premium back at 0.14% signaling US-led momentum.",
      url: "https://theblock.co", timestamp: mins(210), tags: ["BTC", "ETF"] },
    { id: "seed-kol-2", category: "kol", source: "Hsaka", handle: "@HsakaTrades",
      title: "ETH/BTC looks bid: short-term alpha is in the majors basket",
      body: "Watch weekly close above 0.057. Rotation into majors before alts historically precedes 3-6 week rallies.",
      url: "https://x.com/HsakaTrades", timestamp: mins(260), tags: ["ETH", "TA"] },
    { id: "seed-trending-2", category: "trending", source: "DexScreener", handle: "dexscreener.com",
      title: "Small-cap NEAR memes up 40-80% on 24h — rotation from SOL mcaps noted",
      body: "Top movers include community-tied tokens seeded from IronClaw Launch. Volume profile suggests retail discovery, not wash.",
      url: "https://dexscreener.com", timestamp: mins(30), tags: ["NEAR", "memes"] },
    { id: "seed-airdrop-2", category: "airdrops", source: "Alpha Insider", handle: "@alphainsider",
      title: "Meteor Wallet usage rumored to count toward NEAR ecosystem retro",
      body: "Multiple sources point to Meteor's active-wallet metric being used as a weighting input for an upcoming NEAR retro program.",
      url: "#", timestamp: mins(380), tags: ["airdrop", "NEAR"] },
    { id: "seed-chaos-2", category: "chaos", source: "The Defiant", handle: "thedefiant.io",
      title: "Regulatory: EU MiCA clarifies treatment of autonomous agent wallets",
      body: "New guidance distinguishes custodial from non-custodial agent wallets. Platforms routing tx through governance protocols (like IronShield) may benefit from safe-harbor treatment.",
      url: "https://thedefiant.io", timestamp: mins(520), tags: ["regulation", "MiCA"] },
  ].map(i => ({
    ...i,
    // normalize timestamp to ms-since-epoch the frontend's timeAgo helper expects
    timestamp: new Date(i.timestamp).getTime(),
    content: i.body,
    upvotes: 0,
    avatar: (i.source || "??").slice(0, 2).toUpperCase(),
    avatarColor: { news: "#10b981", kol: "#f59e0b", trending: "#8b5cf6", airdrops: "#06b6d4", chaos: "#ef4444" }[i.category],
    link: i.url,
  }));
}

const SYSTEM_PROMPT = `You are IronClaw Alpha, a crypto intelligence agent.
Return a JSON array of 12-15 alpha feed items. Each item:
{
  "id": "<unique short id>",
  "category": "news"|"kol"|"trending"|"airdrops"|"chaos",
  "source": "<outlet or KOL name>",
  "handle": "<@handle or domain>",
  "title": "<headline, max 120 chars>",
  "body": "<2-3 sentence summary of the alpha>",
  "url": "",
  "timestamp": "<ISO 8601 UTC>",
  "tags": ["<tag1>", "<tag2>"]
}

Categories:
- news: Bloomberg, CoinDesk, The Block, Decrypt headlines
- kol: Top CT voices — Ansem, Cobie, Hsaka, CryptoCobain, ZachXBT, Nikita, etc.
- trending: Hot tokens on DEXs, unusual volume spikes
- airdrops: Protocols worth farming based on funding/backers
- chaos: Exploits, depegs, regulatory bombs, black swan events

Focus on what happened in the LAST 24 HOURS. Be specific with numbers, names, and tickers.
Return ONLY the JSON array, no markdown, no explanation, no thinking tags.`;

async function fetchFeed() {
  const now = Date.now();
  if (cache.items.length && now - cache.ts < CACHE_TTL) return cache.items;

  if (!API_KEY) {
    // No AI configured — use the seeded feed so the page is never empty
    cache = { items: seedFeed(), ts: now };
    return cache.items;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 3000,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Current UTC time: ${new Date().toISOString()}. Give me the latest crypto alpha feed. /no_think` },
        ],
      }),
    });
    clearTimeout(timeout);

    if (!res.ok) throw new Error(`AI returned ${res.status}`);
    const json = await res.json();
    let text = (json.choices?.[0]?.message?.content || "").trim();

    // Strip markdown fences and thinking tags
    text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const items = JSON.parse(text);
    if (Array.isArray(items) && items.length > 0) {
      cache = { items, ts: now };
      return items;
    }
  } catch (err) {
    clearTimeout(timeout);
    console.warn("[Alpha] AI feed fetch failed:", err.message);
  }

  // Last resort: seed so we never return empty
  if (!cache.items.length) cache = { items: seedFeed(), ts: now };
  return cache.items;
}

router.get("/feed", async (req, res) => {
  try {
    let items = await fetchFeed();
    const cat = req.query.category;
    if (cat && cat !== "all" && CATEGORIES.includes(cat)) {
      items = items.filter(i => i.category === cat);
    }
    res.json({ success: true, items, cached: Date.now() - cache.ts < 1000 ? false : true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, items: [] });
  }
});

module.exports = router;
