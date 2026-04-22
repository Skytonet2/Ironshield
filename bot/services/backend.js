// bot/services/backend.js — thin fetch wrapper around the IronShield API
const fetch = require("node-fetch");

const BACKEND = process.env.BACKEND_URL || "http://localhost:3001";

async function req(path, { method = "GET", body, headers = {}, wallet } = {}) {
  const h = { "Content-Type": "application/json", ...headers };
  if (wallet) h["x-wallet"] = wallet;
  try {
    const r = await fetch(`${BACKEND}${path}`, {
      method,
      headers: h,
      body: body ? JSON.stringify(body) : undefined,
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
  reply: (tgMsgId, text) => req("/api/tg/reply", { method: "POST", body: { tgMsgId, text } }),
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
};

module.exports = { req, tg, BACKEND };
