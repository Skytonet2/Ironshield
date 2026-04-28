// backend/services/skills/scout_x.js
//
// X (Twitter) scout — used by the Freelancer Hunter + Background
// Checker Kits. Wraps the connector's search action with a thin
// LLM-filter step that scores each tweet for relevance to the user's
// stated intent.

const connectors = require("../../connectors");

const FILTER_PROMPT = ({ intent, tweet }) =>
  `You are filtering tweets for a "${intent}" search. Score this tweet from 0–10 on relevance to the intent. Reply with ONLY a single number.

Tweet: "${(tweet || "").slice(0, 500)}"`;

module.exports = {
  id: "scout_x",
  manifest: {
    title:   "X (Twitter) scout",
    summary: "Searches X recent tweets matching a query, optionally LLM-filters for relevance to the caller's intent. Used by Freelancer Hunter + Background Checker.",
    params: [
      { key: "query",  type: "string", required: true },
      { key: "intent", type: "string", hint: "Plain-English intent. If set, each tweet is LLM-scored 0–10." },
      { key: "limit",  type: "number", default: 10 },
      { key: "min_score", type: "number", default: 5, hint: "Drop tweets scoring below this (only when intent is set)" },
    ],
  },
  async execute({ owner, params = {}, agent }) {
    if (!params.query) throw new Error("scout_x: { query } required");
    const resp = await connectors
      .invoke("x", "search", {
        wallet: owner,
        params: { query: params.query, maxResults: Math.min(50, Math.max(10, params.limit || 10)) },
      })
      .catch((e) => ({ error: e.message }));
    if (resp.error) {
      return { source: "x", items: [], degraded: true, error: resp.error };
    }
    const raw = Array.isArray(resp?.data) ? resp.data : [];
    if (!params.intent || !agent) {
      return { source: "x", count: raw.length, items: raw };
    }
    // LLM filter pass — sequential to stay inside agent rate limits.
    const minScore = Number(params.min_score) || 5;
    const out = [];
    for (const tweet of raw) {
      // eslint-disable-next-line no-await-in-loop
      const reply = await agent({ message: FILTER_PROMPT({ intent: params.intent, tweet: tweet.text }) })
        .catch((e) => ({ reply: "0", error: e.message }));
      const score = Number(String(reply.reply).trim().match(/-?\d+(\.\d+)?/)?.[0] ?? 0);
      if (score >= minScore) out.push({ ...tweet, _score: score });
    }
    return { source: "x", filtered: true, intent: params.intent, count: out.length, items: out };
  },
};
