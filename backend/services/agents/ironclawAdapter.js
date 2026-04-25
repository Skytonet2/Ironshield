// backend/services/agents/ironclawAdapter.js
//
// Adapter for IronClaw — the secure-enclave agent platform on NEAR
// AI Cloud (https://stark-goat.agent0.near.ai is the project's own
// agent; users bring their own IronClaw deployment by pasting their
// gateway base URL + token).
//
// This wraps the existing services/ironclawClient.js so we don't
// duplicate the SSE-streamed thread protocol — but we delegate
// configuration to the per-connection credentials instead of the
// global IRONCLAW_* env vars. The shared client still works for the
// single project-owned agent powering the orchestrator.

const fetch = require("node-fetch");

function pickBase(endpoint) {
  return (endpoint || "https://stark-goat.agent0.near.ai").replace(/\/+$/, "");
}

function authHeaders(token) {
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type":  "application/json",
  };
}

async function validate({ external_id, endpoint, auth }) {
  if (!auth) return { ok: false, error: "Gateway token required" };
  const base = pickBase(endpoint);
  try {
    const res = await fetch(`${base}/api/gateway/status`, {
      headers: authHeaders(auth),
      timeout: 8000,
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: "IronClaw rejected the gateway token" };
    }
    if (!res.ok) {
      return { ok: false, error: `IronClaw status returned HTTP ${res.status}` };
    }
    const body = await res.json().catch(() => ({}));
    return {
      ok:        true,
      framework: "ironclaw",
      info: {
        name:    external_id || body?.agent_id || "IronClaw agent",
        version: body?.version || null,
        status:  body?.status  || "live",
        enclave: Boolean(body?.enclave_attested),
      },
    };
  } catch (err) {
    return { ok: false, error: `Couldn't reach IronClaw: ${err.message}` };
  }
}

async function healthPoll({ external_id, endpoint, auth }) {
  const v = await validate({ external_id, endpoint, auth });
  return v.ok ? "active" : "disconnected";
}

// Chat round-trip: open a thread, send the user turn, poll the SSE
// stream until the assistant message is committed, and return the
// reply. Threads are persistent on IronClaw's side — callers that
// want stateful chat should pass a `thread_id` in `meta`.
async function sendMessage({ endpoint, auth, message, systemPrompt, meta = {} }) {
  const base = pickBase(endpoint);

  let threadId = meta.thread_id;
  if (!threadId) {
    const tRes = await fetch(`${base}/api/chat/thread/new`, {
      method: "POST",
      headers: authHeaders(auth),
      body: JSON.stringify({}),
      timeout: 8000,
    });
    if (!tRes.ok) throw new Error(`IronClaw thread/new ${tRes.status}: ${await tRes.text()}`);
    const t = await tRes.json();
    threadId = t.id || t.thread_id;
    if (!threadId) throw new Error("IronClaw thread/new returned no thread id");
  }

  const sRes = await fetch(`${base}/api/chat/send`, {
    method: "POST",
    headers: authHeaders(auth),
    body: JSON.stringify({
      thread_id: threadId,
      content:   message,
      system:    systemPrompt || undefined,
    }),
    timeout: 12000,
  });
  if (!sRes.ok) throw new Error(`IronClaw send ${sRes.status}: ${await sRes.text()}`);
  const sent = await sRes.json();

  // Poll for the assistant turn. IronClaw's SSE stream is the canonical
  // delivery, but for a sandbox round-trip a short polling window keeps
  // the adapter HTTP-only and easier to test. Real-time streaming is
  // reserved for a future SSE-aware path.
  const startedAt = Date.now();
  let reply = null;
  while (Date.now() - startedAt < 25_000) {
    await new Promise(r => setTimeout(r, 800));
    const tRes = await fetch(`${base}/api/chat/thread/${encodeURIComponent(threadId)}/messages`, {
      headers: authHeaders(auth),
      timeout: 5000,
    });
    if (!tRes.ok) continue;
    const list = await tRes.json().catch(() => null);
    const msgs = Array.isArray(list?.messages) ? list.messages : Array.isArray(list) ? list : [];
    const assistant = msgs
      .filter(m => m.role === "assistant" && (!sent.message_id || m.parent_id === sent.message_id || m.in_reply_to === sent.message_id))
      .pop();
    if (assistant?.content) { reply = assistant.content; break; }
  }
  return {
    reply: reply || "(IronClaw is still processing; refresh the dashboard to see the reply)",
    raw:   { threadId, sent_id: sent.message_id || null },
  };
}

async function listMetrics({ external_id, endpoint, auth }) {
  // IronClaw doesn't publish per-agent metrics through the gateway;
  // the dashboard surface should fall back to the on-chain AgentStats
  // we already maintain.
  return {
    messages_processed: null,
    alerts_sent:        null,
    uptime_pct:         null,
    note: "IronClaw runs in encrypted enclaves; runtime telemetry stays inside the TEE. On-chain AgentStats is the canonical activity record.",
  };
}

module.exports = {
  name: "ironclaw",
  display: "IronClaw",
  docs_url: "https://docs.near.ai/agents/quickstart",
  validate, healthPoll, sendMessage, listMetrics,
};
