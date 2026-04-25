// backend/services/agents/webhookAdapter.js
//
// Generic adapter for self-hosted agents (Hermes from Nous Research,
// custom builds, anything else). The user provides:
//
//   • endpoint  — base URL we POST to
//   • auth      — HMAC signing secret (we send X-IronShield-Signature)
//
// Their endpoint is expected to:
//
//   GET  {endpoint}/health      → 200 + JSON, used for health-poll
//   POST {endpoint}/chat        → JSON { reply: string, ... }
//
// Self-hosted agents that don't conform yet are still acceptable —
// validate() degrades to a TCP-level ping, the user just won't see
// rich metrics on the dashboard.

const fetch = require("node-fetch");
const crypto = require("crypto");

function pickBase(endpoint) {
  return (endpoint || "").replace(/\/+$/, "");
}

function sign(secret, body) {
  if (!secret) return "";
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function signedHeaders(secret, body) {
  const headers = { "Content-Type": "application/json" };
  if (secret) headers["X-IronShield-Signature"] = sign(secret, body);
  return headers;
}

async function validate({ endpoint, auth }) {
  const base = pickBase(endpoint);
  if (!base) return { ok: false, error: "Endpoint URL required" };
  try {
    const url = new URL(base);
    if (!["http:", "https:"].includes(url.protocol)) {
      return { ok: false, error: "Endpoint must be http(s)" };
    }
  } catch {
    return { ok: false, error: "Endpoint isn't a valid URL" };
  }
  try {
    const res = await fetch(`${base}/health`, { timeout: 6000 });
    // 404 / 405 are OK — the user just hasn't implemented /health.
    // Accept anything that proves the server is reachable; refine
    // once the user's runtime exposes a real health surface.
    if (res.status >= 500) {
      return { ok: false, error: `Endpoint returned HTTP ${res.status}` };
    }
    let info = {};
    try {
      const ctype = res.headers.get("content-type") || "";
      if (ctype.includes("application/json")) info = await res.json();
    } catch { /* ignore */ }
    return {
      ok:        true,
      framework: "self_hosted",
      info: {
        name:    info?.name    || "Self-hosted agent",
        version: info?.version || null,
        status:  info?.status  || (res.ok ? "live" : "reachable"),
      },
    };
  } catch (err) {
    return { ok: false, error: `Couldn't reach endpoint: ${err.message}` };
  }
}

async function healthPoll({ endpoint, auth }) {
  const v = await validate({ endpoint, auth });
  return v.ok ? "active" : "disconnected";
}

async function sendMessage({ endpoint, auth, message, systemPrompt, meta = {} }) {
  const base = pickBase(endpoint);
  if (!base) throw new Error("Endpoint URL required");
  const body = JSON.stringify({
    message,
    system: systemPrompt || undefined,
    ...meta,
  });
  const res = await fetch(`${base}/chat`, {
    method:  "POST",
    headers: signedHeaders(auth, body),
    body,
    timeout: 30000,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Self-hosted agent returned HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const ctype = res.headers.get("content-type") || "";
  if (!ctype.includes("application/json")) {
    const text = await res.text();
    return { reply: text.slice(0, 2000), raw: null };
  }
  const data = await res.json();
  return {
    reply: data.reply || data.message || data.text || "",
    usage: data.usage || null,
    raw:   data,
  };
}

async function listMetrics() {
  return {
    messages_processed: null,
    alerts_sent:        null,
    uptime_pct:         null,
    note: "Self-hosted agents don't have a uniform metrics surface. Install IronShield skills for end-to-end usage tracking.",
  };
}

module.exports = {
  name: "self_hosted",
  display: "Self-hosted",
  docs_url: "https://hermes-agent.nousresearch.com/", // canonical example
  validate, healthPoll, sendMessage, listMetrics,
};
