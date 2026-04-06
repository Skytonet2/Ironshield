// agent/autonomousLoop.js
// Autonomous agent run loop — reads governance missions and proactively
// executes tasks without waiting for user input. This is what makes
// IronClaw a real autonomous agent, not just a chatbot.

require("dotenv").config();
const fs    = require("fs");
const path  = require("path");
const fetch = require("node-fetch");

const BACKEND     = process.env.BACKEND_URL        || "http://localhost:3001";
const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN || "";
const CHANNEL_ID  = process.env.IRONCLAW_CHANNEL_ID || ""; // TG channel/group to post autonomous updates
const LOOP_INTERVAL_MS = parseInt(process.env.AUTONOMOUS_LOOP_INTERVAL || "600000", 10); // default 10 min

const MISSION_FILE = path.join(__dirname, "activeMission.json");
const STATE_FILE   = path.join(__dirname, "loopState.json");

// ── Helpers ──────────────────────────────────────────────────────

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; } };
const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

const sendTelegram = async (chatId, text) => {
  if (!BOT_TOKEN || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
    });
  } catch (err) {
    console.error("[Autonomous] Telegram send error:", err.message);
  }
};

// ── State Management ─────────────────────────────────────────────

function loadState() {
  const defaults = {
    lastRunAt: null,
    lastMissionHash: null,
    trendingLastPostedAt: null,
    securityScanLastAt: null,
    missionReportLastAt: null,
    scannedTargets: [],     // keep last 100 to avoid re-scanning
    cycleCount: 0,
  };
  const saved = readJson(STATE_FILE);
  return { ...defaults, ...saved };
}

function saveState(state) {
  // Keep scannedTargets bounded
  if (state.scannedTargets.length > 100) {
    state.scannedTargets = state.scannedTargets.slice(-100);
  }
  writeJson(STATE_FILE, state);
}

// ── Autonomous Tasks ─────────────────────────────────────────────

// Task 1: Trending token scan — fetch trending, auto-research suspicious ones
async function taskTrendingScan(state) {
  const now = Date.now();
  const hoursSinceLastTrending = state.trendingLastPostedAt
    ? (now - new Date(state.trendingLastPostedAt).getTime()) / 3600000
    : Infinity;

  // Post trending report every 6 hours
  if (hoursSinceLastTrending < 6) return;

  console.log("[Autonomous] Running trending scan...");
  try {
    const res  = await fetch(`${BACKEND}/api/trending`);
    const json = await res.json();
    if (!json.success) return;

    const d = json.data;
    const lines = ["🤖 *IronClaw Autonomous Report — Trending*", "━━━━━━━━━━━━━━━━━━"];

    if (d.coingeckoTrending?.length) {
      lines.push("\n🔥 *Trending Tokens*");
      d.coingeckoTrending.slice(0, 5).forEach((c, i) => {
        lines.push(`${i + 1}. *${c.name}* (${c.symbol}) — ${c.price}`);
      });
    }

    if (d.nearEcosystem?.length) {
      lines.push("\n🌐 *NEAR Ecosystem*");
      d.nearEcosystem.slice(0, 3).forEach((t, i) => {
        lines.push(`${i + 1}. *${t.name}* — ${t.price} | Vol: ${t.volume24h}`);
      });
    }

    lines.push("\n_Autonomous scan by IronClaw — governed by $IRONCLAW holders_");

    await sendTelegram(CHANNEL_ID, lines.join("\n"));
    state.trendingLastPostedAt = new Date().toISOString();
    console.log("[Autonomous] Trending report posted.");
  } catch (err) {
    console.error("[Autonomous] Trending scan error:", err.message);
  }
}

// Task 2: Proactive security patrol — scan newly trending tokens for red flags
async function taskSecurityPatrol(state) {
  const now = Date.now();
  const hoursSinceLastScan = state.securityScanLastAt
    ? (now - new Date(state.securityScanLastAt).getTime()) / 3600000
    : Infinity;

  // Run security patrol every 4 hours
  if (hoursSinceLastScan < 4) return;

  console.log("[Autonomous] Running security patrol...");
  try {
    const res  = await fetch(`${BACKEND}/api/trending`);
    const json = await res.json();
    if (!json.success) return;

    const tokens = [
      ...(json.data.coingeckoTrending || []),
      ...(json.data.dexScreenerBoosted || []),
    ];

    const alerts = [];

    for (const token of tokens.slice(0, 5)) {
      const target = token.symbol || token.name;
      if (!target || state.scannedTargets.includes(target.toLowerCase())) continue;

      try {
        const scanRes  = await fetch(`${BACKEND}/api/security/scan`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ target, type: "token" }),
        });
        const scanJson = await scanRes.json();

        state.scannedTargets.push(target.toLowerCase());

        if (scanJson.data?.riskLevel === "HIGH" || scanJson.data?.riskLevel === "CRITICAL") {
          alerts.push({ token: target, risk: scanJson.data.riskLevel, detail: scanJson.data.threats?.[0]?.detail || "Unknown threat" });
        }
      } catch { /* continue scanning others */ }
    }

    if (alerts.length > 0) {
      const lines = [
        "🚨 *IronClaw Security Alert — Autonomous Patrol*",
        "━━━━━━━━━━━━━━━━━━",
        "",
        ...alerts.map(a => `⚠️ *${a.token}* — Risk: *${a.risk}*\n   ${a.detail}`),
        "",
        "_Proactive scan by IronClaw — no human requested this._",
      ];
      await sendTelegram(CHANNEL_ID, lines.join("\n"));
      console.log(`[Autonomous] Posted ${alerts.length} security alert(s).`);
    }

    state.securityScanLastAt = new Date().toISOString();
  } catch (err) {
    console.error("[Autonomous] Security patrol error:", err.message);
  }
}

// Task 3: Mission status report — announce when governance changes the mission
async function taskMissionReport(state) {
  const mission = readJson(MISSION_FILE);
  const missionHash = JSON.stringify(mission);

  if (missionHash === state.lastMissionHash) return;

  console.log("[Autonomous] Mission changed, posting update...");
  const lines = [
    "📋 *IronClaw Mission Update*",
    "━━━━━━━━━━━━━━━━━━",
    "",
    `🎯 *New Mission:* ${mission.content || "No mission set"}`,
    mission.proposalId ? `📜 Proposal: #${mission.proposalId}` : "",
    mission.updatedAt ? `⏱ Updated: ${new Date(mission.updatedAt).toLocaleString()}` : "",
    "",
    "_This mission was set by $IRONCLAW governance vote._",
    "_IronClaw will now operate under these instructions._",
  ].filter(Boolean);

  await sendTelegram(CHANNEL_ID, lines.join("\n"));
  state.lastMissionHash = missionHash;
  state.missionReportLastAt = new Date().toISOString();
  console.log("[Autonomous] Mission update posted.");
}

// Task 4: Daily intelligence digest — comprehensive AI-generated report
async function taskDailyDigest(state) {
  const now  = new Date();
  const hour = now.getUTCHours();

  // Post digest once daily at ~09:00 UTC
  if (hour !== 9) return;

  const lastDigest = state.dailyDigestLastAt
    ? new Date(state.dailyDigestLastAt)
    : new Date(0);
  const hoursSince = (now - lastDigest) / 3600000;
  if (hoursSince < 20) return; // prevent double-posting

  console.log("[Autonomous] Generating daily intelligence digest...");
  try {
    const mission = readJson(MISSION_FILE);
    const res = await fetch(`${BACKEND}/api/chat`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `You are running in AUTONOMOUS MODE. Generate a brief daily intelligence digest for the IronClaw community.
Current mission: ${mission.content || "General Web3 security monitoring"}
Include: 1) Key market observations 2) Security landscape 3) NEAR ecosystem highlights 4) Actionable insights.
Keep it under 300 words. Write in a professional but accessible tone.`,
        userId: "autonomous-agent",
      }),
    });
    const json = await res.json();

    if (json.success && json.data?.reply) {
      const lines = [
        "📊 *IronClaw Daily Intelligence Digest*",
        "━━━━━━━━━━━━━━━━━━",
        "",
        json.data.reply,
        "",
        "_Autonomously generated by IronClaw — governed by $IRONCLAW holders_",
      ];
      await sendTelegram(CHANNEL_ID, lines.join("\n"));
      state.dailyDigestLastAt = now.toISOString();
      console.log("[Autonomous] Daily digest posted.");
    }
  } catch (err) {
    console.error("[Autonomous] Daily digest error:", err.message);
  }
}

// ── Main Loop ────────────────────────────────────────────────────

async function runCycle() {
  const state = loadState();
  state.cycleCount++;
  state.lastRunAt = new Date().toISOString();

  console.log(`[Autonomous] Cycle #${state.cycleCount} started at ${state.lastRunAt}`);

  // Run all autonomous tasks
  await taskMissionReport(state);
  await taskTrendingScan(state);
  await taskSecurityPatrol(state);
  await taskDailyDigest(state);

  saveState(state);
  console.log(`[Autonomous] Cycle #${state.cycleCount} complete.`);
}

// ── Start ────────────────────────────────────────────────────────

function start() {
  if (!CHANNEL_ID) {
    console.warn("[Autonomous] IRONCLAW_CHANNEL_ID not set — autonomous loop will run but won't post to Telegram.");
    console.warn("[Autonomous] Set IRONCLAW_CHANNEL_ID to your TG group/channel ID to enable autonomous posting.");
  }

  console.log(`[Autonomous] IronClaw autonomous loop started — interval: ${LOOP_INTERVAL_MS / 60000} min`);
  console.log("[Autonomous] This agent acts on its own based on governance-set missions.");

  // Run immediately, then on interval
  runCycle();
  setInterval(runCycle, LOOP_INTERVAL_MS);
}

start();

module.exports = { runCycle, loadState };
