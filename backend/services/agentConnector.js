// backend/services/agentConnector.js
const fetch = require("node-fetch");
const path  = require("path");
const fs    = require("fs");

const ENDPOINT = process.env.NEAR_AI_ENDPOINT || "https://api.near.ai/v1/chat/completions";
const API_KEY  = process.env.NEAR_AI_KEY       || "";
const MODEL    = process.env.NEAR_AI_MODEL     || "llama-3.1-70b-instruct";

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
  return `You are IronClaw, a Web3 AI security and intelligence agent.
Current mission: ${govMission}
${govPrompt ? `\nGovernance instructions: ${govPrompt}` : ""}
Always respond in valid JSON only. No markdown. No explanation outside JSON.
Flag all risks clearly. Be concise and accurate.`;
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
    if (!res.ok) throw new Error(`NEAR AI returned ${res.status}`);
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
  `Summarize recent messages from ${payload.identifier} (${payload.range}).
   Return JSON: { title, keyPoints: [], tokensMentioned: [], redFlags: [], actionableInsights: [] }`
);

exports.research = (payload) => dispatch("research",
  `Research this crypto token/project: "${payload.query}" (type: ${payload.queryType}, chain: ${payload.chain}).
   Return JSON: { overview, metrics: { price, marketCap, volume24h, holders, liquidityLocked, auditStatus }, risks: [], redFlags: [], trustScore, sources: [] }`
);

exports.verify = (payload) => dispatch("verify",
  `Fact-check this claim: "${payload.claim}". Context: ${payload.context || "Telegram message"}.
   Return JSON: { verdict: "VERIFIED|FALSE|PARTIALLY_FALSE|UNVERIFIED", breakdown: [{ claim, result, source, detail }], overallConfidence }`
);

exports.portfolio = (payload) => dispatch("portfolio",
  `Analyze these wallets: ${JSON.stringify(payload.wallets)}.
   Return JSON: { totalNetWorthUSD, change24hUSD, change24hPct, wallets: [{ address, chain, balanceUSD, tokens: [{ symbol, amount, valueUSD }], riskFlags: [] }] }`
);
