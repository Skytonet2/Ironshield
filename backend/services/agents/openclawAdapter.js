// backend/services/agents/openclawAdapter.js
//
// Adapter for OpenClaw (https://openclaw.ai). Pass-through onboarding:
// users deploy on OpenClaw themselves and paste their agent id +
// API key here. We validate by hitting their public health endpoint
// with the supplied credentials, then route sandbox messages through
// the OpenAI-compatible chat completions surface OpenClaw exposes.
//
// API surface assumptions (gate-checked at validate-time so users get
// a clean error if their endpoint is shaped differently):
//   GET  {base}/v1/agents/{external_id}        -> 200 implies live
//   POST {base}/v1/agents/{external_id}/chat   -> { reply, usage }
//
// Auth: Bearer token in `Authorization` header.

const fetch = require("node-fetch");

const DEFAULT_BASE = "https://api.openclaw.ai";

function pickBase(endpoint) {
  return (endpoint || DEFAULT_BASE).replace(/\/+$/, "");
}

async function validate({ external_id, endpoint, auth }) {
  if (!external_id) return { ok: false, error: "Agent id required" };
  if (!auth)        return { ok: false, error: "API key required" };
  const base = pickBase(endpoint);
  try {
    const res = await fetch(`${base}/v1/agents/${encodeURIComponent(external_id)}`, {
      method:  "GET",
      headers: { "Authorization": `Bearer ${auth}` },
      timeout: 8000,
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "API key rejected by OpenClaw" };
    }
    if (res.status === 404) {
      return { ok: false, error: `Agent ${external_id} not found on OpenClaw` };
    }
    if (!res.ok) {
      return { ok: false, error: `OpenClaw returned HTTP ${res.status}` };
    }
    const body = await res.json().catch(() => null);
    return {
      ok:        true,
      framework: "openclaw",
      info: {
        name:    body?.name        || external_id,
        version: body?.version     || null,
        status:  body?.status      || "live",
      },
    };
  } catch (err) {
    return { ok: false, error: `Couldn't reach OpenClaw: ${err.message}` };
  }
}

async function healthPoll({ external_id, endpoint, auth }) {
  const v = await validate({ external_id, endpoint, auth });
  return v.ok ? "active" : "disconnected";
}

async function sendMessage({ external_id, endpoint, auth, message, systemPrompt }) {
  const base = pickBase(endpoint);
  const res = await fetch(`${base}/v1/agents/${encodeURIComponent(external_id)}/chat`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${auth}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      message,
      system: systemPrompt || undefined,
    }),
    timeout: 30000,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenClaw chat failed (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  const body = await res.json();
  return {
    reply:    body.reply || body.message || "",
    usage:    body.usage || null,
    raw:      body,
  };
}

async function listMetrics({ external_id, endpoint, auth }) {
  // OpenClaw doesn't publish a stable metrics surface yet — return
  // `null` for fields we can't compute so the dashboard renders an
  // honest "Not reported by framework" instead of fake numbers.
  return {
    messages_processed: null,
    alerts_sent:        null,
    uptime_pct:         null,
    note: "OpenClaw doesn't expose per-agent metrics yet; install AZUKA skills to track usage end-to-end.",
  };
}

module.exports = {
  name: "openclaw",
  display: "OpenClaw",
  docs_url: "https://openclaw.ai/docs",
  validate, healthPoll, sendMessage, listMetrics,
};
