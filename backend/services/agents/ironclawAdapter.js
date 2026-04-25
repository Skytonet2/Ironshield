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

// Chat round-trip: open a thread, send the user turn, subscribe to
// the SSE event stream until the matching assistant message lands,
// and return the reply. Threads are persistent on IronClaw's side —
// callers that want stateful chat should pass a `thread_id` in
// `meta`.
//
// SSE is the canonical delivery on IronClaw; switching from the old
// 800ms polling loop drops sandbox-chat latency from ~1s+ to as
// little as the model takes to start streaming. Falls back to a
// short polling window if SSE 404s (older IronClaw deployments).

const SSE_TIMEOUT_MS = 25_000;
const POLL_TIMEOUT_MS = 25_000;

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

  // Try SSE first. A 404 / 4xx falls through to the polling path so
  // older deployments keep working.
  let reply = null;
  try {
    reply = await readReplyFromSse({ base, auth, threadId, sentId: sent.message_id });
  } catch (sseErr) {
    if (!String(sseErr?.message || "").includes("HTTP 4")) {
      console.warn("[ironclaw] SSE failed, falling back to polling:", sseErr.message);
    }
    reply = await readReplyFromPolling({ base, auth, threadId, sentId: sent.message_id });
  }

  return {
    reply: reply || "(IronClaw is still processing; refresh the dashboard to see the reply)",
    raw:   { threadId, sent_id: sent.message_id || null },
  };
}

/** Subscribe to /api/chat/events and resolve when an assistant
 *  message tied to our `sentId` lands. We accumulate streamed text
 *  events ('delta' | 'token') and commit on a 'done' / 'message'
 *  envelope — IronClaw's protocol is best-effort backward-compatible. */
async function readReplyFromSse({ base, auth, threadId, sentId }) {
  const url = `${base}/api/chat/events?thread_id=${encodeURIComponent(threadId)}`;
  const res = await fetch(url, {
    headers: { ...authHeaders(auth), "Accept": "text/event-stream" },
    timeout: 8000,                  // connect timeout only
  });
  if (!res.ok) throw new Error(`SSE HTTP ${res.status}`);
  if (!res.body || !res.body[Symbol.asyncIterator]) {
    // node-fetch v2 returns Readable; v3 returns web ReadableStream.
    // We handle both via getReader() + a tiny shim.
    return await readSseFromReadable(res, sentId);
  }
  return await readSseFromAsyncIterable(res.body, sentId);
}

async function readSseFromAsyncIterable(stream, sentId) {
  const startedAt = Date.now();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let acc    = "";
  const deadline = setTimeout(() => stream.destroy?.(), SSE_TIMEOUT_MS);
  try {
    for await (const chunk of stream) {
      buffer += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const settled = handleSseEvent(event, sentId, (delta) => { acc += delta; });
        if (settled !== null) return settled || acc;
      }
      if (Date.now() - startedAt > SSE_TIMEOUT_MS) break;
    }
  } finally {
    clearTimeout(deadline);
  }
  return acc || null;
}

async function readSseFromReadable(res, sentId) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let buffer = "", acc = "";
    const timer = setTimeout(() => { res.body.destroy(); resolve(acc || null); }, SSE_TIMEOUT_MS);
    res.body.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const settled = handleSseEvent(event, sentId, (delta) => { acc += delta; });
        if (settled !== null) {
          clearTimeout(timer);
          res.body.destroy();
          return resolve(settled || acc);
        }
      }
      if (Date.now() - startedAt > SSE_TIMEOUT_MS) {
        clearTimeout(timer);
        res.body.destroy();
        resolve(acc || null);
      }
    });
    res.body.on("error", (err) => { clearTimeout(timer); reject(err); });
    res.body.on("end",   ()    => { clearTimeout(timer); resolve(acc || null); });
  });
}

/** Parse one SSE event block. Calls `onDelta(text)` for streamed
 *  tokens and returns either:
 *    - null  → keep reading
 *    - ""    → commit whatever we've accumulated
 *    - "..." → final reply text from the server
 */
function handleSseEvent(rawEvent, sentId, onDelta) {
  const dataLines = rawEvent.split(/\n/).filter(l => l.startsWith("data:"));
  if (!dataLines.length) return null;
  const data = dataLines.map(l => l.slice(5).trim()).join("\n");
  if (!data) return null;
  let parsed;
  try { parsed = JSON.parse(data); }
  catch { return null; }

  const type = parsed.type || parsed.event || parsed.kind;
  // Ignore events that don't match our send (heartbeats, other turns).
  if (sentId && parsed.in_reply_to && parsed.in_reply_to !== sentId &&
      parsed.parent_id && parsed.parent_id !== sentId) {
    return null;
  }

  if (type === "delta" || type === "token" || type === "chunk") {
    const piece = parsed.delta || parsed.token || parsed.content || "";
    if (piece) onDelta(piece);
    return null;
  }
  if (type === "message" || type === "done" || type === "complete") {
    return parsed.content || parsed.reply || "";
  }
  return null;
}

async function readReplyFromPolling({ base, auth, threadId, sentId }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    await new Promise(r => setTimeout(r, 800));
    const tRes = await fetch(`${base}/api/chat/thread/${encodeURIComponent(threadId)}/messages`, {
      headers: authHeaders(auth),
      timeout: 5000,
    });
    if (!tRes.ok) continue;
    const list = await tRes.json().catch(() => null);
    const msgs = Array.isArray(list?.messages) ? list.messages : Array.isArray(list) ? list : [];
    const assistant = msgs
      .filter(m => m.role === "assistant" && (!sentId || m.parent_id === sentId || m.in_reply_to === sentId))
      .pop();
    if (assistant?.content) return assistant.content;
  }
  return null;
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
