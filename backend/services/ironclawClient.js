// backend/services/ironclawClient.js
//
// Thin client for the IronClaw agent runtime (NEAR AI Cloud product).
// IronShield runs ON TOP of IronClaw — we are not re-implementing an
// agent runtime here. This module just talks to our hosted agent at
// {IRONCLAW_BASE_URL} using the scoped gateway token.
//
// Agent surface documented inline (discovered via app.js):
//   POST /api/chat/thread/new       → create a thread
//   POST /api/chat/send             → send a user turn (async, returns message_id)
//   GET  /api/chat/events (SSE)     → stream agent events (assistant reply)
//   GET  /api/chat/threads          → list threads
//   GET  /api/gateway/status        → liveness
//
// Auth: Authorization: Bearer <IRONCLAW_GATEWAY_TOKEN>

const fetch = require("node-fetch");

const BASE  = process.env.IRONCLAW_BASE_URL       || "https://stark-goat.agent0.near.ai";
const TOKEN = process.env.IRONCLAW_GATEWAY_TOKEN  || "";

const authHeaders = () => ({
  "Authorization": `Bearer ${TOKEN}`,
  "Content-Type":  "application/json",
});

const assertConfigured = () => {
  if (!TOKEN) throw new Error("IRONCLAW_GATEWAY_TOKEN not set — IronClaw client unavailable");
};

/* ── Liveness ────────────────────────────────────────────────── */
async function status() {
  assertConfigured();
  const res = await fetch(`${BASE}/api/gateway/status`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`IronClaw status ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ── Threads ─────────────────────────────────────────────────── */
async function newThread() {
  assertConfigured();
  const res = await fetch(`${BASE}/api/chat/thread/new`, {
    method:  "POST",
    headers: authHeaders(),
    body:    JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`IronClaw thread/new ${res.status}: ${await res.text()}`);
  return res.json(); // { id, state, turn_count, ... }
}

async function listThreads() {
  assertConfigured();
  const res = await fetch(`${BASE}/api/chat/threads`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`IronClaw threads ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ── Send ────────────────────────────────────────────────────── */
async function send({ content, threadId, systemPrompt }) {
  assertConfigured();
  if (!content || typeof content !== "string") {
    throw new Error("ironclaw.send: content (string) required");
  }
  const body = { content };
  if (threadId)     body.thread_id     = threadId;
  if (systemPrompt) body.system_prompt = systemPrompt; // best-effort — accepted if server supports it
  const res = await fetch(`${BASE}/api/chat/send`, {
    method:  "POST",
    headers: authHeaders(),
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`IronClaw send ${res.status}: ${await res.text()}`);
  return res.json(); // { message_id, status: "accepted" }
}

/* ── SSE event stream ────────────────────────────────────────── */
// Minimal SSE parser — yields { event, data } objects. Closes when
// the caller breaks out of the for-await loop or the server closes.
async function* eventStream({ signal } = {}) {
  assertConfigured();
  const res = await fetch(`${BASE}/api/chat/events`, {
    headers: { ...authHeaders(), "Accept": "text/event-stream" },
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`IronClaw events ${res.status}`);

  let buf = "";
  for await (const chunk of res.body) {
    buf += chunk.toString("utf8");
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const ev = { event: "message", data: "" };
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) ev.event = line.slice(6).trim();
        else if (line.startsWith("data:")) ev.data += (ev.data ? "\n" : "") + line.slice(5).trim();
      }
      if (ev.data) {
        try { ev.json = JSON.parse(ev.data); } catch { ev.json = null; }
        yield ev;
      }
    }
  }
}

/* ── Wait for assistant reply on a thread ────────────────────── */
// Subscribes to SSE and returns the assistant reply text for the
// given thread_id. IronClaw emits events in this order per turn:
//   event: thinking   (0..N, progress pings)
//   event: status     ("Done")
//   event: turn_cost  (usage)
//   event: response   { type:"response", content, thread_id }   ← final
// Times out after timeoutMs (default 60s).
async function awaitReply({ threadId, timeoutMs = 60000 }) {
  if (!threadId) throw new Error("awaitReply: threadId required");
  const ctl   = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    for await (const ev of eventStream({ signal: ctl.signal })) {
      const d = ev.json;
      if (!d) continue;
      if (d.thread_id && d.thread_id !== threadId) continue;
      if (ev.event === "response" || d.type === "response") {
        return d.content || d.text || "";
      }
    }
  } finally {
    clearTimeout(timer);
    try { ctl.abort(); } catch (_) {}
  }
  throw new Error(`IronClaw: no response event on thread ${threadId} within ${timeoutMs}ms`);
}

/* ── One-shot convenience: send + await ─────────────────────── */
async function chat({ content, threadId, systemPrompt, timeoutMs = 45000 }) {
  let tid = threadId;
  if (!tid) {
    const t = await newThread();
    tid = t.id;
  }
  // Subscribe to SSE BEFORE sending, so we don't miss fast replies.
  const replyP = awaitReply({ threadId: tid, timeoutMs });
  // Give the subscription a beat to attach before we send.
  await new Promise((r) => setTimeout(r, 150));
  await send({ content, threadId: tid, systemPrompt });
  const reply = await replyP;
  return { threadId: tid, reply };
}

module.exports = {
  status,
  newThread,
  listThreads,
  send,
  eventStream,
  awaitReply,
  chat,
};
