// bot/services/backend.js — thin fetch wrapper around the IronShield API
const fetch = require("node-fetch");
const crypto = require("crypto");

const BACKEND = process.env.BACKEND_URL || "http://localhost:3001";
// Shared HMAC secret with backend/middleware/requireBotSig.js. The
// backend rejects /api/tg/* requests without a matching X-TG-Signature
// in production, so this env MUST be set on the bot worker (Render
// service: ironshield-worker-bot).
const BOT_SECRET = process.env.TELEGRAM_BOT_BACKEND_SECRET || "";

if (!BOT_SECRET && (process.env.NODE_ENV || "").toLowerCase() === "production") {
  console.error("[bot/backend] TELEGRAM_BOT_BACKEND_SECRET unset — every /api/tg/* call will 503");
}

function signTg(rawBody) {
  // Exact same payload shape requireBotSig expects: `${ts}.${rawBody}`.
  const ts = String(Date.now());
  const sig = crypto.createHmac("sha256", BOT_SECRET).update(`${ts}.${rawBody || ""}`).digest("hex");
  return { ts, sig };
}

async function req(path, { method = "GET", body, headers = {}, wallet } = {}) {
  const h = { "Content-Type": "application/json", ...headers };
  if (wallet) h["x-wallet"] = wallet;
  const rawBody = body ? JSON.stringify(body) : "";
  // Stamp every /api/tg/* call with HMAC. Other endpoints (legacy
  // bot-side calls to non-tg routes, if any) skip the stamp — the
  // backend doesn't require it outside /api/tg/*.
  if (BOT_SECRET && path.startsWith("/api/tg/")) {
    const { ts, sig } = signTg(rawBody);
    h["X-TG-Timestamp"] = ts;
    h["X-TG-Signature"] = sig;
  }
  try {
    const r = await fetch(`${BACKEND}${path}`, {
      method,
      headers: h,
      body: body ? rawBody : undefined,
    });
    const raw = await r.text();
    let j;
    try { j = JSON.parse(raw); } catch { j = { raw }; }
    if (!r.ok) return { ok: false, status: r.status, error: j.error || raw };
    return { ok: true, ...j };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── TG-specific helpers ───────────────────────────────────────────
const tg = {
  claim: (payload) => req("/api/tg/claim", { method: "POST", body: payload }),
  settings: (tgId) => req(`/api/tg/settings/${tgId}`),
  updateSettings: (payload) => req("/api/tg/settings", { method: "POST", body: payload }),
  addWallet: (tgId, wallet) => req("/api/tg/add-wallet", { method: "POST", body: { tgId, wallet } }),
  removeWallet: (tgId, wallet) => req("/api/tg/remove-wallet", { method: "POST", body: { tgId, wallet } }),
  reply: (tgMsgId, tgId, text) => req("/api/tg/reply", { method: "POST", body: { tgMsgId, tgId, text } }),
  watchlist: (tgId) => req(`/api/tg/watchlist/${tgId}`),
  addWatch: (tgId, kind, value) => req("/api/tg/watchlist/add", { method: "POST", body: { tgId, kind, value } }),
  removeWatch: (tgId, kind, value) => req("/api/tg/watchlist/remove", { method: "POST", body: { tgId, kind, value } }),
  listAlerts: (tgId) => req(`/api/tg/price-alerts/${tgId}`),
  addAlert: (payload) => req("/api/tg/price-alerts/add", { method: "POST", body: payload }),
  removeAlert: (id) => req("/api/tg/price-alerts/remove", { method: "POST", body: { id } }),
  // Custodial trading account endpoints (Phase 7).
  custodial: (tgId) => req(`/api/tg/custodial/${tgId}`),
  custodialBalance: (tgId) => req(`/api/tg/custodial/${tgId}/balance`),
  custodialTransfer: (tgId, body) => req(`/api/tg/custodial/${tgId}/transfer`, { method: "POST", body }),
  custodialSwap:     (tgId, body) => req(`/api/tg/custodial/${tgId}/swap`,     { method: "POST", body }),
  custodialActivate: (tgId, body) => req(`/api/tg/custodial/${tgId}/activate`, { method: "POST", body: body || {} }),
  agent:        (body) => req("/api/tg/agent",         { method: "POST", body }),
  agentConfirm: (body) => req("/api/tg/agent/confirm", { method: "POST", body }),
};

// ─── Phase 10 — Agent Economy helpers ───────────────────────────────
// Resolve an escalation when the owner taps Approve/Reject. The bot
// authenticates via the orchestrator shared secret because the user
// has already authenticated to TG and we trust the chat id ↔ wallet
// linkage on the backend side.
const economy = {
  missions:        (wallet) => req(`/api/missions?mine=1`, { wallet }),
  mission:         (id)     => req(`/api/missions/${id}`),
  resolveEscalation: (id, decision, note, wallet) =>
    req(`/api/escalations/${id}/resolve`, {
      method: "POST",
      body: { decision, note, source: "tg" },
      wallet,
      headers: process.env.ORCHESTRATOR_SHARED_SECRET
        ? { "x-orchestrator-secret": process.env.ORCHESTRATOR_SHARED_SECRET }
        : {},
    }),
};

// ─── Phase 10 Tier 2 — IronGuide concierge helpers ──────────────────
// All of these treat the TG channel as the subject so the same session
// shape (channel='tg', subject_tg_id=…) is used end-to-end.
const ironguide = {
  start:     (tgId)               => req("/api/ironguide/start",                  { method: "POST", body: { channel: "tg", tg_id: tgId } }),
  reply:     (sessionId, content) => req(`/api/ironguide/${sessionId}/reply`,     { method: "POST", body: { content } }),
  recommend: (sessionId)          => req(`/api/ironguide/${sessionId}/recommend`, { method: "POST", body: {} }),
  open:      (tgId)               => req(`/api/ironguide/open?channel=tg&tg_id=${tgId}`),
  load:      (sessionId)          => req(`/api/ironguide/${sessionId}`),
};

module.exports = { req, tg, economy, ironguide, BACKEND };
