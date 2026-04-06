// backend/services/agentConnector.js
const fetch = require("node-fetch");
const path  = require("path");
const fs    = require("fs");

const ENDPOINT = process.env.NEAR_AI_ENDPOINT || "https://cloud-api.near.ai/v1/chat/completions";
const API_KEY  = process.env.NEAR_AI_KEY       || "";
const MODEL    = process.env.NEAR_AI_MODEL     || "Qwen/Qwen3-30B-A3B-Instruct-2507";

const PROMPT_FILE   = path.join(__dirname, "../../agent/activePrompt.json");
const MISSION_FILE  = path.join(__dirname, "../../agent/activeMission.json");

const readJson = (file) => {
  try { const d = JSON.parse(fs.readFileSync(file, "utf8")); return d; } catch { return {}; }
};

const baseSystemPrompt = () => {
  const promptFile   = readJson(PROMPT_FILE);
  const missionFile  = readJson(MISSION_FILE);
  const govPrompt    = promptFile.content  || "";
  const govMission   = missionFile.content || "Monitor for scams, phishing links, and malicious wallets.";
  return `You are IronClaw, a Web3 AI security and intelligence agent built on NEAR Protocol.
Current mission: ${govMission}
${govPrompt ? `\nGovernance instructions: ${govPrompt}` : ""}
Always respond in valid JSON only. No markdown. No explanation outside JSON.
Flag all risks clearly. Be concise and accurate.
IMPORTANT RULES:
- The NEAR blockchain explorer is nearblocks.io (NOT nearscan.io, NOT explorer.near.org for links).
- For token/project verification, reference X/Twitter (x.com) as the primary social source, NOT Google.
- When providing source links, always include https://nearblocks.io for NEAR chain lookups.
- Always include https://t.me/IronShieldCore_bot as the last source link (this is our bot).
- Do NOT fabricate data. If you don't have real metrics, say "unavailable" instead of making up numbers.`;
};

const dispatch = async (taskType, userPrompt) => {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(ENDPOINT, {
      method:  "POST",
      signal:  controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        messages: [
          { role: "system", content: baseSystemPrompt() },
          { role: "user",   content: userPrompt },
        ],
      }),
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`NEAR AI returned ${res.status}: ${await res.text()}`);
    const json   = await res.json();
    const text   = json.choices?.[0]?.message?.content || "{}";
    const clean  = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch (err) {
    clearTimeout(timeout);
    throw new Error(`Agent dispatch failed: ${err.message}`);
  }
};

exports.summarize = (payload) => dispatch("summary",
  `Analyze and summarize the following REAL chat messages (${payload.messageCount} messages from the last ${payload.range}).
DO NOT invent or fabricate any information. Only report what is actually present in the transcript below.
If something is not discussed, do not include it.

--- BEGIN TRANSCRIPT ---
${payload.transcript}
--- END TRANSCRIPT ---

Return JSON: { title, keyPoints: [], tokensMentioned: [], redFlags: [], actionableInsights: [] }
Only include tokensMentioned if actual token names/tickers appear in the messages.
Only include redFlags if you detect genuine suspicious activity (scam links, phishing, pump-and-dump language).
If the conversation is benign, return empty arrays for redFlags.`
);

exports.research = (payload) => {
  const rd = payload.realData?.data || {};
  const isNear = payload.realData?.source === "near";
  const dataBlock = Object.keys(rd).length > 0
    ? `\n--- REAL MARKET DATA (from APIs — use these exact values) ---\n${JSON.stringify(rd, null, 2)}\n--- END REAL DATA ---\n`
    : "\nNo real market data found from APIs. Report all metrics as 'unavailable'.\n";

  const sources = [];
  if (isNear) {
    sources.push(`https://nearblocks.io/token/${payload.query}`);
  }
  if (rd.twitter) sources.push(`https://x.com/${rd.twitter}`);
  else sources.push(`https://x.com/search?q=${encodeURIComponent(payload.query)}`);
  if (rd.website) sources.push(rd.website);
  if (rd.dex === "rhea-finance" || rd.dex === "ref-finance") sources.push("https://app.rhea.finance");
  sources.push("https://t.me/IronShieldCore_bot");

  return dispatch("research",
    `Analyze this crypto token/project: "${payload.query}" (type: ${payload.queryType}, chain: ${payload.chain}).
${dataBlock}
CRITICAL: Use ONLY the real data provided above for metrics. Do NOT invent prices, market caps, or volumes.
If a metric is "unavailable" in the data, keep it as "unavailable" in your response.
Your job is to ANALYZE the data and provide risk assessment, NOT to look up data.

Return JSON: {
  overview: "brief project description based on the data",
  metrics: { price, marketCap, volume24h, holders, liquidityLocked, auditStatus },
  risks: [],
  redFlags: [],
  trustScore: (0-100 based on data quality, liquidity, holders),
  sources: ${JSON.stringify(sources)}
}

Scoring guide:
- No liquidity or very low (<$1000): trustScore 0-20
- No holders data or <10 holders: reduce score by 20
- No website/twitter: reduce score by 15
- Good liquidity (>$50k) + verified audit: trustScore 60-90`
  );
};

exports.verify = (payload) => dispatch("verify",
  `Fact-check this claim: "${payload.claim}". Context: ${payload.context || "Telegram message"}.
Verify against X/Twitter (x.com) for social claims, nearblocks.io for NEAR on-chain claims.
Do NOT fabricate verification results. If you cannot verify, say UNVERIFIED.
Return JSON: { verdict: "VERIFIED|FALSE|PARTIALLY_FALSE|UNVERIFIED", breakdown: [{ claim, result, source, detail }], overallConfidence }`
);

exports.portfolio = (payload) => dispatch("portfolio",
  `Analyze these wallets: ${JSON.stringify(payload.wallets)}.
   Return JSON: { totalNetWorthUSD, change24hUSD, change24hPct, wallets: [{ address, chain, balanceUSD, tokens: [{ symbol, amount, valueUSD }], riskFlags: [] }] }`
);
