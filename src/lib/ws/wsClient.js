"use client";
// wsClient — singleton WebSocket connection to /ws/feed.
//
// One connection per tab (not per component), infinite exponential-
// backoff reconnect (1s → 30s cap), pushes incoming `event` messages
// into useFeed. Status changes flow through useFeed.setWsStatus so
// the bottom-bar dot reflects reality.
//
// connect() is idempotent; components can call it on mount without
// guarding. disconnect() is mostly for tests — real sessions keep the
// socket open for the lifetime of the tab.

import { useFeed } from "@/lib/stores/feedStore";

// Backend URL resolution. In production it's the Render host, served
// over wss. In dev it's the same-host backend on :3001, served over
// ws. NEXT_PUBLIC_BACKEND_URL overrides if present (for staging hosts
// or a local non-standard port).
function resolveWsUrl() {
  if (typeof window === "undefined") return null;
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_WS_URL;
  if (explicit) {
    // Accept http(s):// → ws(s):// conversion automatically.
    return explicit.replace(/^http/, "ws").replace(/\/+$/, "") + "/ws/feed";
  }
  const { protocol, hostname } = window.location;
  // Localhost dev: talk to the local Express backend.
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `ws://${hostname}:3001/ws/feed`;
  }
  // Production default: the Render-hosted backend.
  return "wss://ironclaw-backend.onrender.com/ws/feed";
}

let ws = null;
let reconnectTimer = null;
let backoffMs = 1_000;
const BACKOFF_MAX = 30_000;
let manualDisconnect = false;

function setStatus(status) {
  useFeed.getState().setWsStatus(status);
}

function scheduleReconnect() {
  if (manualDisconnect) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, backoffMs);
  // Double the next wait, capped. Reset to 1s on successful open.
  backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX);
}

export function connect({ token = null, userId = null, trackers = null } = {}) {
  if (typeof window === "undefined") return;
  if (ws && (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING)) return;

  const url = resolveWsUrl();
  if (!url) return;
  manualDisconnect = false;
  setStatus("connecting");

  try {
    ws = new WebSocket(url);
  } catch {
    setStatus("disconnected");
    scheduleReconnect();
    return;
  }

  ws.addEventListener("open", () => {
    backoffMs = 1_000;
    setStatus("connected");
    if (token) ws.send(JSON.stringify({ type: "auth", token, userId }));
    if (trackers) ws.send(JSON.stringify({ type: "subscribe", trackers }));
  });

  ws.addEventListener("message", (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "event" && msg.event) {
      useFeed.getState().push(msg.event);
    }
    // hello / authed / subscribed / pong are informational — no-op.
  });

  const onClose = () => {
    setStatus("disconnected");
    if (!manualDisconnect) scheduleReconnect();
  };
  ws.addEventListener("close", onClose);
  ws.addEventListener("error", onClose);
}

export function disconnect() {
  manualDisconnect = true;
  clearTimeout(reconnectTimer);
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
  setStatus("disconnected");
}

export function send(msg) {
  if (!ws || ws.readyState !== ws.OPEN) return false;
  ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
  return true;
}
