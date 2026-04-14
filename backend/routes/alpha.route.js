const router = require("express").Router();
const fetch  = require("node-fetch");

const ENDPOINT = process.env.NEAR_AI_ENDPOINT || "https://cloud-api.near.ai/v1/chat/completions";
const API_KEY  = process.env.NEAR_AI_KEY       || "";
const MODEL    = process.env.NEAR_AI_MODEL     || "Qwen/Qwen3-30B-A3B-Instruct-2507";

// In-memory cache — refreshed every 5 minutes
let cache = { items: [], ts: 0 };
const CACHE_TTL = 5 * 60 * 1000;

const CATEGORIES = ["news", "kol", "trending", "airdrops", "chaos"];

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

  if (!API_KEY) return cache.items;

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
