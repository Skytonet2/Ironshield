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

const getGovContext = () => {
  const govPrompt  = readJson(PROMPT_FILE).content  || "";
  const govMission = readJson(MISSION_FILE).content || "Monitor for scams, phishing links, and malicious wallets.";
  return { govPrompt, govMission };
};

/* ── MODE 1: CRYPTO RESEARCH SYSTEM PROMPT ────────────────────── */
const researchSystemPrompt = () => {
  const { govPrompt, govMission } = getGovContext();
  return `You are IronClaw, an advanced crypto intelligence agent built on NEAR Protocol.
Current mission: ${govMission}
${govPrompt ? `Governance instructions: ${govPrompt}` : ""}

You perform HIGH-INTEGRITY crypto research. You MUST follow strict data validation rules.
You DO NOT guess, hallucinate, or substitute missing data.

STEP 1: Identify entity type — Layer 1 blockchain, Token on another chain, or Protocol/dApp.
STEP 2: Validate data context — Ignore irrelevant metrics (e.g. DEX liquidity for L1 chains). Cross-check market cap, liquidity, and chain.
STEP 3: Detect inconsistencies — If mismatch detected, label as "Data inconsistency detected". Do NOT convert inconsistencies into fake risks.
STEP 4: Risk analysis (ONLY real risks) — Regulatory, Security, Centralization, Ecosystem maturity.
STEP 5: Trust score — Based on data reliability + consistency + legitimacy.

ANTI-HALLUCINATION: Before responding, ask yourself "Am I using actual provided data or substituting context?" If substituting → STOP and say "unavailable".

RULES:
- NEAR blockchain explorer is nearblocks.io (NOT nearscan.io).
- Use X/Twitter (x.com) as primary social source, NOT Google.
- Always include https://t.me/IronShieldCore_bot as the last source link.
- Do NOT fabricate data. If a metric is missing, say "unavailable".
- Always respond in valid JSON only. No markdown. No explanation outside JSON.`;
};

/* ── MODE 2: TELEGRAM GROUP ANALYSIS SYSTEM PROMPT ────────────── */
const groupAnalysisPrompt = () => {
  const { govPrompt, govMission } = getGovContext();
  return `You are IronClaw, an advanced crypto intelligence agent built on NEAR Protocol.
Current mission: ${govMission}
${govPrompt ? `Governance instructions: ${govPrompt}` : ""}

You perform Telegram group intelligence and alpha extraction.

ACCESS VALIDATION (CRITICAL):
- You MUST have ACTUAL messages provided in the transcript. If no messages → respond with empty results.
- NEVER summarize unrelated chats. NEVER use prior conversation as substitute.

SIGNAL vs NOISE FILTERING — Classify messages into:
- Alpha (valuable insights): early token mentions before hype, contract addresses, dev updates, insider-like discussions, unusual coordinated mention patterns.
- Noise: spam, memes, hype without substance.
- Promotions: shilling, paid promotion.

ALPHA EXTRACTION — Extract:
- Token/project names and contract addresses mentioned.
- Narratives (AI, memes, infra, DeFi, etc.).
- Repeated mentions (trend detection).
- Sentiment (bullish, skeptical, neutral).
- "Emerging plays" (low mention but high conviction) vs "Overhyped plays" (high mention, low substance).

BEHAVIORAL ANALYSIS — Assess:
- Are users knowledgeable or just hype-driven?
- Is there coordinated shilling?
- Are admins credible?

RED FLAG DETECTION:
- Scam links, phishing, pump-and-dump language.
- Coordinated hype patterns, fake urgency.

ANTI-HALLUCINATION RULE:
Before responding, ask: "Am I using actual group data or substituting context?"
If substituting → STOP and correct. NEVER invent group discussions. NEVER assume alpha without evidence.

Always respond in valid JSON only. No markdown. No explanation outside JSON.`;
};

/* ── MODE 3: FACT-CHECKING SYSTEM PROMPT ──────────────────────── */
const factCheckPrompt = () => {
  const { govPrompt, govMission } = getGovContext();
  return `You are IronClaw, a crypto fact-checking AI built on NEAR Protocol.
Current mission: ${govMission}
${govPrompt ? `Governance instructions: ${govPrompt}` : ""}

Your job is to evaluate whether a claim is TRUE, FALSE, or MISLEADING.

STEP 1: Understand the claim clearly. Break it down into verifiable parts.

STEP 2: Retrieve known facts from your knowledge.
Known facts include:
- NEAR Protocol founders: Illia Polosukhin, Alexander Skidanov.
- NEAR blockchain explorer: nearblocks.io
- NEAR token is the native token of NEAR Protocol.
- Use X/Twitter (x.com) as primary social verification source.

STEP 3: Compare claim vs known facts. Identify matches, contradictions, and gaps.

STEP 4: Assign a verdict:
- TRUE — claim is factually correct
- FALSE — claim is factually wrong
- MISLEADING — claim contains truth but is presented in a deceptive way
- INSUFFICIENT_EVIDENCE — not enough data to confirm or deny

STEP 5: Explain WHY in 1-3 sentences. Be specific about what matches or conflicts.

CRITICAL RULES:
- Do NOT say "verification failed" — always give a verdict with reasoning.
- Do NOT refuse unless the claim is completely ambiguous nonsense.
- If unsure, say "INSUFFICIENT_EVIDENCE" and explain what's missing.
- Break compound claims into individual parts and evaluate each.
- Always respond in valid JSON only. No markdown. No explanation outside JSON.`;
};

/* ── GENERAL PROMPT (verify, portfolio, etc.) ─────────────────── */
const baseSystemPrompt = () => {
  const { govPrompt, govMission } = getGovContext();
  return `You are IronClaw, a Web3 AI security and intelligence agent built on NEAR Protocol.
Current mission: ${govMission}
${govPrompt ? `Governance instructions: ${govPrompt}` : ""}
Always respond in valid JSON only. No markdown. No explanation outside JSON.
Flag all risks clearly. Be concise and accurate.
RULES:
- NEAR blockchain explorer is nearblocks.io (NOT nearscan.io).
- Use X/Twitter (x.com) as primary social source, NOT Google.
- Always include https://t.me/IronShieldCore_bot as the last source link.
- Do NOT fabricate data. If you don't have real metrics, say "unavailable".`;
};

const dispatch = async (taskType, userPrompt, systemPrompt) => {
  const sysPrompt  = systemPrompt || baseSystemPrompt();
  const maxTokens  = taskType === "summary" ? 1200 : 800;
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(ENDPOINT, {
      method:  "POST",
      signal:  controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: sysPrompt },
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
  `Analyze the following REAL chat messages (${payload.messageCount} messages from the last ${payload.range}).

--- BEGIN TRANSCRIPT ---
${payload.transcript}
--- END TRANSCRIPT ---

Perform full group intelligence analysis:

1. DATA SOURCE: Time range = ${payload.range}, Messages = ${payload.messageCount}. Identify key participants.

2. SIGNAL vs NOISE: Classify messages into Alpha (early token mentions, contract addresses, dev updates, insider discussion), Noise (spam, memes, hype), and Promotions (shilling).

3. ALPHA EXTRACTION: Extract token/project names, narratives (AI, memes, infra, etc.), repeated mentions for trend detection, sentiment. Identify "Emerging plays" (low mention, high conviction) vs "Overhyped plays" (high mention, low substance).

4. BEHAVIORAL ANALYSIS: Are users knowledgeable or hype-driven? Is there coordinated shilling?

5. RED FLAGS: Scam links, phishing, pump-and-dump language, coordinated hype patterns.

Return JSON: {
  title: "Group analysis title",
  groupOverview: { activityLevel: "low|medium|high", signalQuality: "low|medium|high", keyParticipants: [] },
  keyPoints: [],
  keyNarratives: [],
  alphaFindings: [{ token: "", why: "", conviction: "low|medium|high" }],
  tokensMentioned: [],
  redFlags: [],
  actionableInsights: [],
  confidenceLevel: "low|medium|high — reason"
}

CRITICAL: Only report what is ACTUALLY in the transcript. Do NOT invent discussions, tokens, or alpha.
If the conversation is benign, return empty arrays for redFlags and alphaFindings.
If fewer than 5 messages, set confidenceLevel to "low — insufficient data".`,
  groupAnalysisPrompt()
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
STEP 1 — ENTITY TYPE: Identify if this is a Layer 1 blockchain, token on another chain, or protocol/dApp.
STEP 2 — VALIDATE DATA: Ignore irrelevant metrics (e.g. DEX liquidity for L1 chains). Cross-check market cap vs liquidity vs chain.
STEP 3 — DETECT INCONSISTENCIES: If data conflicts exist, label as "Data inconsistency detected" — do NOT convert into fake risks.
STEP 4 — RISK ANALYSIS (real risks only): Regulatory, Security, Centralization, Ecosystem maturity.
STEP 5 — TRUST SCORE: Based on data reliability + consistency + legitimacy.

CRITICAL: Use ONLY the real data provided above. Do NOT invent prices, market caps, or volumes.
If a metric is "unavailable" in the data, keep it as "unavailable".

Return JSON: {
  overview: "brief project description based on the data",
  metrics: { price, marketCap, volume24h, holders, liquidityLocked, auditStatus },
  risks: [],
  redFlags: [],
  trustScore: (0-100),
  sources: ${JSON.stringify(sources)}
}

Scoring guide:
- No liquidity or very low (<$1000): trustScore 0-20
- No holders data or <10 holders: reduce score by 20
- No website/twitter: reduce score by 15
- Good liquidity (>$50k) + verified audit: trustScore 60-90
- L1 chain with strong ecosystem: trustScore 70-95`,
    researchSystemPrompt()
  );
};

exports.verify = (payload) => dispatch("verify",
  `Fact-check the following claim:

"${payload.claim}"

Context: ${payload.context || "Telegram message"}

STEP 1 — UNDERSTAND: Break this claim into individual verifiable statements.
STEP 2 — RETRIEVE FACTS: What do you know to be true about each statement?
STEP 3 — COMPARE: Does the claim match, contradict, or lack evidence?
STEP 4 — VERDICT: Assign TRUE, FALSE, MISLEADING, or INSUFFICIENT_EVIDENCE to each part.
STEP 5 — EXPLAIN: Give 1-3 sentences for each explaining why.

For social/project claims, reference X/Twitter (x.com).
For NEAR on-chain claims, reference nearblocks.io.

Return JSON: {
  verdict: "TRUE|FALSE|MISLEADING|INSUFFICIENT_EVIDENCE",
  breakdown: [{ claim: "individual claim", result: "TRUE|FALSE|MISLEADING|INSUFFICIENT_EVIDENCE", source: "where verified", detail: "1-3 sentence explanation" }],
  overallConfidence: 0.0-1.0,
  explanation: "1-3 sentence overall summary of the fact-check"
}

NEVER say "verification failed". Always provide a verdict with reasoning.
If you lack data for a sub-claim, mark it INSUFFICIENT_EVIDENCE and explain what's missing.`,
  factCheckPrompt()
);

exports.portfolio = (payload) => dispatch("portfolio",
  `Analyze these wallets: ${JSON.stringify(payload.wallets)}.
   Return JSON: { totalNetWorthUSD, change24hUSD, change24hPct, wallets: [{ address, chain, balanceUSD, tokens: [{ symbol, amount, valueUSD }], riskFlags: [] }] }`
);
