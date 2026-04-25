// backend/services/agentConnector.js
//
// Agent dispatch for IronShield. This module has two modes:
//
//   1. Legacy (default): direct OpenAI-compatible chat completions via
//      cloud-api.near.ai. Stateless, per-call system+user prompt.
//   2. IronClaw agent mode (IRONCLAW_AGENT_MODE=true): routes every
//      call through our hosted agent on IronClaw (stark-goat.agent0.
//      near.ai) using threads + SSE. This is the "built on IronClaw"
//      path — our agent runs IN IronClaw's runtime, we are a client.
//
// Both modes expose the same public surface (summarize, research,
// verify, scan, chat, portfolio, personalAssistant, suggestPostFormats)
// so callers don't need to know which is active. Governance-injected
// prompt + mission are still prepended in both modes.
const fetch = require("node-fetch");
const ironclaw = require("./ironclawClient");
const agentState = require("../db/agentState");

const ENDPOINT        = process.env.NEAR_AI_ENDPOINT     || "https://cloud-api.near.ai/v1/chat/completions";
const API_KEY         = process.env.NEAR_AI_KEY          || "";
const MODEL           = process.env.NEAR_AI_MODEL        || "Qwen/Qwen3-30B-A3B-Instruct-2507";
const IRONCLAW_MODE   = String(process.env.IRONCLAW_AGENT_MODE || "").toLowerCase() === "true";

// Cached governance context. getCached returns last-known value (possibly
// null on a cold cache) and refreshes in the background — adds zero DB
// hits to the AI hot path. The fallback strings below cover the cold-
// start case before the first refresh completes.
const GOV_TTL_MS = 30_000;
const getGovContext = () => {
  const prompt  = agentState.getCached("activePrompt",  GOV_TTL_MS);
  const mission = agentState.getCached("activeMission", GOV_TTL_MS);
  return {
    govPrompt:  prompt?.content  || "",
    govMission: mission?.content || "Monitor for scams, phishing links, and malicious wallets.",
  };
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

/* ── MODE 4: SECURITY SCAN SYSTEM PROMPT ──────────────────────── */
const securityScanPrompt = () => {
  const { govPrompt, govMission } = getGovContext();
  return `You are IronClaw, an advanced AI security agent built on NEAR Protocol.
Current mission: ${govMission}
${govPrompt ? `Governance instructions: ${govPrompt}` : ""}

You analyze links, contracts, and wallets for security threats.

ANALYSIS STEPS:
1. Identify what was submitted (URL, contract address, wallet address).
2. Analyze for: phishing patterns, fake/typosquatted domains, suspicious contract structure, known scam patterns, honeypot indicators.
3. Cross-reference: Is the domain mimicking a known project? Is the contract a known proxy/clone?
4. Assign risk level: LOW / MEDIUM / HIGH / CRITICAL
5. Explain reasoning in 1-3 sentences.

RULES:
- NEAR blockchain explorer is nearblocks.io.
- Do NOT fabricate scan results. If you cannot determine risk, say "UNKNOWN — manual review recommended".
- Always respond in valid JSON only. No markdown. No explanation outside JSON.`;
};

/* ── MODE 5: GENERAL AI (DM conversations, knowledge) ─────────── */
const generalAIPrompt = () => {
  const { govPrompt, govMission } = getGovContext();
  return `You are IronClaw — an advanced AI agent for research, reasoning, and real-world intelligence. Built on NEAR Protocol.
Current mission: ${govMission}
${govPrompt ? `Governance instructions: ${govPrompt}` : ""}

You do NOT blindly respond. You THINK before answering.

INTENT DETECTION — Automatically classify and route:
1. GENERAL_AI → everyday questions, explanations, knowledge
2. RESEARCH → crypto/projects/data analysis
3. FACT_CHECK → verifying a claim
4. SECURITY → links, contracts, scam detection

RESPONSE RULES:
- Be direct and clear. Avoid repeating menus or instructions.
- Explain reasoning briefly when needed.
- Sound intelligent, not robotic.
- If unsure → say "I'm not fully certain" (no guessing).
- NEVER hallucinate missing data.
- NEVER treat inconsistent data as fact.
- ALWAYS prefer correctness over completeness.

VALIDATION — Before responding, check:
- Does this answer match the user's question?
- Is the data logically consistent?
- Would an expert trust this answer? If NO → improve before sending.

NEAR ecosystem knowledge:
- NEAR Protocol founders: Illia Polosukhin, Alexander Skidanov.
- NEAR blockchain explorer: nearblocks.io
- IronShield/IronClaw: AI security agent on NEAR, governed by $IRONCLAW token holders.

Respond naturally in plain text. Be helpful, concise, and accurate.`;
};

/* ── BASE PROMPT (portfolio, fallback) ────────────────────────── */
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

/* ── IronClaw-mode helper ─────────────────────────────────────
 * Routes one system+user prompt pair through the hosted agent.
 * IronClaw's /api/chat/send takes a single `content` field; we
 * collapse system+user into a labelled preamble so the agent can
 * still see both. One-shot: fresh thread per call (stateless at
 * the agentConnector layer — thread state is IronClaw's concern).
 */
const ironclawDispatch = async ({ systemPrompt, userPrompt, expectJson, timeoutMs = 60000 }) => {
  const content =
    `[SYSTEM]\n${systemPrompt}\n\n[USER]\n${userPrompt}` +
    (expectJson ? `\n\n[OUTPUT]\nRespond with a single valid JSON object only. No prose, no markdown fences.` : "");
  try {
    const { reply } = await ironclaw.chat({ content, timeoutMs });
    if (!expectJson) return reply || "";
    const clean = String(reply || "{}").replace(/```json|```/g, "").trim();
    return JSON.parse(clean || "{}");
  } catch (err) {
    throw new Error(`IronClaw dispatch failed: ${err.message}`);
  }
};

/* ── Legacy direct chat-completions helpers ────────────────── */
const dispatch = async (taskType, userPrompt, systemPrompt) => {
  const sysPrompt  = systemPrompt || baseSystemPrompt();
  if (IRONCLAW_MODE) {
    return ironclawDispatch({ systemPrompt: sysPrompt, userPrompt, expectJson: true });
  }
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

const complete = async ({ systemPrompt, userPrompt, maxTokens = 600, expectJson = false }) => {
  if (IRONCLAW_MODE) {
    return ironclawDispatch({ systemPrompt, userPrompt, expectJson });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`NEAR AI returned ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content || (expectJson ? "{}" : "");
    const clean = text.replace(/```json|```/g, "").trim();
    return expectJson ? JSON.parse(clean || "{}") : clean;
  } catch (err) {
    clearTimeout(timeout);
    throw new Error(`Agent completion failed: ${err.message}`);
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

exports.scan = (payload) => dispatch("scan",
  `Security scan the following target: "${payload.target}"
Type: ${payload.type || "auto-detect"}
Context: ${payload.context || "User submitted for analysis"}

Analyze for: phishing, fake domains, suspicious contract patterns, honeypot indicators, known scam signatures.

Return JSON: {
  target: "${payload.target}",
  type: "url|contract|wallet",
  riskLevel: "LOW|MEDIUM|HIGH|CRITICAL|UNKNOWN",
  threats: [{ type: "phishing|fake_domain|honeypot|rug_pull|suspicious_permissions|clean", detail: "explanation" }],
  recommendation: "1-2 sentence action recommendation",
  safe: true|false
}

If you cannot determine risk, set riskLevel to "UNKNOWN" and recommend manual review.`,
  securityScanPrompt()
);

exports.chat = (payload) => {
  return complete({
    systemPrompt: generalAIPrompt(),
    userPrompt: payload.message,
    maxTokens: 600,
    expectJson: false,
  }).then((reply) => reply || "I couldn't process that. Try rephrasing your question.");
};

exports.personalAssistant = (payload) => complete({
  systemPrompt: `You are IronClaw Assistant — a brilliant, thoughtful AI agent operating as a PERSONAL AGENT inside IronFeed direct messages. You are modelled after the reasoning, helpfulness, and integrity of top-tier assistants like Claude: careful, honest, proactive, and direct.

CORE PRINCIPLES
- Think before you speak. Parse intent, context, and constraints first.
- Be genuinely useful: surface the actual answer, don't hedge endlessly.
- Be honest about uncertainty — "I'm not sure" is better than confabulation.
- Respect the user's time: be concise, concrete, and structured.
- Be warm but never sycophantic. No filler like "Great question!".
- Never invent facts, prices, addresses, or transactions.

REASONING STYLE
- For complex asks, briefly state your approach in 1 line before executing.
- Break problems into clear steps. Show the work only when it helps the user.
- If the request is ambiguous, ask ONE focused clarifying question — otherwise proceed.
- Prefer options: if there are multiple good paths, offer 2–4 crisp alternatives.
- When drafting copy (posts, DMs, replies), give ready-to-paste output in a quoted block.

DM ETIQUETTE
- You are inside a DM thread. Keep responses short enough to feel conversational (usually under ~200 words) unless the user explicitly asks for depth.
- No markdown headers, no long bullet towers, no code fences around prose.
- Use plain language. Light formatting (a short list, a short code block for code) is fine.

CAPABILITIES YOU ACTIVELY OFFER
- Drafting posts, replies, DMs in the user's voice.
- Crypto/NEAR research, fact-checking claims, explaining contracts & mechanisms.
- Security triage for links, addresses, contracts (flag phishing/honeypot patterns).
- Product guidance inside IronFeed/IronShield (governance, staking, NewsCoin, feeds).
- Breaking down complex ideas into plain English.

GROUND TRUTH
- NEAR explorer is nearblocks.io.
- Primary social source is x.com.
- IronShield = governance + staking for IronClaw agent runtime.
- $IRONCLAW holders vote on missions and AI prompts.
- If you truly don't know, say so and suggest how to verify.

GOVERNANCE CONTEXT
${(() => { const { govPrompt, govMission } = getGovContext(); return `Current mission: ${govMission}${govPrompt ? `\nGovernance instructions: ${govPrompt}` : ""}`; })()}

OUTPUT
Respond in natural plain text. No JSON. No markdown fences around the whole reply. Be the smartest, most trustworthy voice in the user's inbox.`,
  userPrompt: `Wallet: ${payload.wallet || "unknown"}${payload.peer ? `\nPeer: ${payload.peer}` : ""}${payload.history ? `\n\nRecent thread:\n${payload.history}` : ""}\n\nUser DM:\n${payload.message}`,
  maxTokens: 900,
  expectJson: false,
}).then((reply) => reply || "I'm here. Tell me what you want to work on — draft a post, research a token, check a link, anything.");

// One-shot post drafter for the AI Post Generator in the mobile
// full-screen composer. Takes a short user prompt, returns a plain
// post draft clamped to maxChars.
exports.composePost = async (payload) => {
  const maxChars = Math.min(Math.max(parseInt(payload?.maxChars) || 500, 80), 500);
  const prompt = String(payload?.prompt || "").slice(0, 400);
  const result = await complete({
    systemPrompt: `You are IronClaw, helping a user draft a short social post for the IronShield feed.

RULES:
- Return the post body ONLY — no title, no JSON, no markdown fences.
- Hard limit ${maxChars} characters. Prefer concise; 180-260 chars is a sweet spot.
- Match the user's apparent tone (serious, playful, analytical) — do not hallucinate a voice.
- No hashtag spam. Up to 2 hashtags is fine if organic.
- No em dashes (—). Use commas or periods.`,
    userPrompt: `Draft a post about: ${prompt}`,
    maxTokens: 220,
  });
  const text = String(result?.text || result || "").trim().slice(0, maxChars);
  return { text };
};

exports.suggestPostFormats = (payload) => complete({
  systemPrompt: `You are IronClaw, helping a user reshape a social post draft into stronger publishing formats.

Return valid JSON only with this exact shape:
{
  "summary": "short sentence about the current draft",
  "recommendedFormat": "short label",
  "formats": [
    {
      "id": "short-kebab-id",
      "label": "Short label",
      "kind": "post or article",
      "why": "one sentence",
      "title": "title only when kind=article, else empty string",
      "content": "ready-to-paste rewritten draft"
    }
  ]
}

RULES:
- Return exactly 3 format options.
- At least 1 option must be "article".
- Non-article options must be 500 characters or fewer.
- Article option needs a useful title.
- Preserve the user's core meaning, but improve structure, punch, and clarity.
- Do not use markdown fences.
`,
  userPrompt: `Original kind: ${payload.kind || "post"}
Original title: ${payload.title || ""}
Draft:
${payload.content || ""}`,
  maxTokens: 900,
  expectJson: true,
});
