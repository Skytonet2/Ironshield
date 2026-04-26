"use client";
// wsClient — singleton WebSocket connection to /ws/feed.
//
// One connection per tab, infinite exponential-backoff reconnect (1s →
// 30s cap). Public events flow into useFeed.push. Per-wallet private
// events (dm:new, notification:new) route only to listeners registered
// via addListener — the feed store would otherwise pollute the public
// feed with private metadata.
//
// Auth: Day 5.5 added a ticket-based handshake. Callers pass a wallet
// + a ticketProvider() async fn; on each (re)connect the client mints
// a fresh ticket via /api/auth/ws-ticket (signed REST), sends it as
// `{type:"auth", wallet, ticket}`, and only flips to authed=true after
// the server echoes `{type:"authed", ok:true}`. Trackers are sent
// after auth resolves.
//
// connect() is idempotent. Re-calling with a wallet upgrades an
// already-open public connection by sending a fresh auth message.

import { useFeed } from "@/lib/stores/feedStore";

function resolveWsUrl() {
  if (typeof window === "undefined") return null;
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.NEXT_PUBLIC_WS_URL;
  if (explicit) {
    return explicit.replace(/^http/, "ws").replace(/\/+$/, "") + "/ws/feed";
  }
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `ws://${hostname}:3001/ws/feed`;
  }
  return "wss://ironclaw-backend.onrender.com/ws/feed";
}

// Event types that carry per-wallet private content. These bypass
// useFeed.push so they don't pollute the public feed UI / unread badge.
const PRIVATE_TYPES = new Set(["dm:new", "notification:new"]);

let ws = null;
let reconnectTimer = null;
let backoffMs = 1_000;
const BACKOFF_MAX = 30_000;
let manualDisconnect = false;

// Last connect args, replayed on every reconnect.
let lastConfig = { wallet: null, ticketProvider: null, trackers: null };

// Wallet the *current* socket is server-confirmed authed for. Set on
// `{type:"authed", ok:true}`, cleared on close.
let authedWallet = null;
// Wallet we've *attempted* to auth on the current socket (set when
// sendAuth starts, before the await). Distinct from authedWallet so we
// can suppress concurrent connect() calls during the auth-in-flight
// window — every ticket fetch is a signed REST call that surfaces a
// wallet popup, and AppShell remounts on every route nav. Cleared on
// close so a fresh socket re-attempts.
let authAttemptedFor = null;

const listeners = new Map();   // type -> Set<fn>

function setStatus(status) {
  useFeed.getState().setWsStatus(status);
}

function dispatch(event) {
  const set = listeners.get(event.type);
  if (set && set.size > 0) {
    for (const fn of set) {
      try { fn(event); } catch { /* listener errors don't break the bus */ }
    }
  }
  if (!PRIVATE_TYPES.has(event.type)) {
    useFeed.getState().push(event);
  }
}

function scheduleReconnect() {
  if (manualDisconnect) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => connect(lastConfig), backoffMs);
  backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX);
}

export function connect({ wallet = null, ticketProvider = null, trackers = null } = {}) {
  if (typeof window === "undefined") return;
  // Merge over previous config so the trading page (no wallet) and the
  // shell (with wallet) can both call connect without clobbering each
  // other's intent.
  if (wallet !== undefined && wallet !== null) lastConfig.wallet = wallet;
  if (ticketProvider) lastConfig.ticketProvider = ticketProvider;
  if (trackers) {
    // Union the requested trackers with any previously requested set so
    // dm:new / notification:new survive a trading-page connect call.
    const merged = new Set(lastConfig.trackers || []);
    for (const t of trackers) merged.add(t);
    lastConfig.trackers = [...merged];
  }

  if (ws && (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING)) {
    // Already connecting/open. Only kick a new auth handshake if we
    // have not yet attempted one on this socket for this wallet.
    // authAttemptedFor covers both "in-flight" and "completed" — both
    // states must suppress re-signing, since each retry is a wallet
    // popup. AppShell remounts on every route nav, so without this
    // guard every click would re-sign.
    if (
      ws.readyState === ws.OPEN &&
      lastConfig.wallet &&
      lastConfig.ticketProvider &&
      authAttemptedFor !== lastConfig.wallet
    ) {
      void sendAuth();
    }
    return;
  }

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
    // Fresh socket — clear any prior in-flight memo so the new socket
    // gets its own auth attempt.
    authAttemptedFor = null;
    authedWallet = null;
    if (lastConfig.wallet && lastConfig.ticketProvider) {
      void sendAuth();
    } else if (lastConfig.trackers) {
      // Public-only connection (e.g. /trading before login).
      ws.send(JSON.stringify({ type: "subscribe", trackers: lastConfig.trackers }));
    }
  });

  ws.addEventListener("message", (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "event" && msg.event) {
      dispatch(msg.event);
      return;
    }
    if (msg.type === "authed" && msg.ok) {
      authedWallet = msg.wallet || lastConfig.wallet || null;
      if (lastConfig.trackers) {
        // Defer the subscribe until after auth resolves so the server
        // already knows which wallet's private events the socket is
        // permitted to receive when it starts filtering subscriptions.
        ws.send(JSON.stringify({ type: "subscribe", trackers: lastConfig.trackers }));
      }
    } else if (msg.type === "authed" && !msg.ok) {
      authedWallet = null;
    }
  });

  const onClose = () => {
    authedWallet = null;
    authAttemptedFor = null;
    setStatus("disconnected");
    if (!manualDisconnect) scheduleReconnect();
  };
  ws.addEventListener("close", onClose);
  ws.addEventListener("error", onClose);
}

async function sendAuth() {
  if (!ws || ws.readyState !== ws.OPEN) return;
  if (!lastConfig.wallet || !lastConfig.ticketProvider) return;
  // Mark BEFORE the await so a concurrent connect() call sees the
  // in-flight attempt and doesn't kick off a second ticket fetch.
  // Cleared on close, so a fresh socket re-attempts.
  authAttemptedFor = lastConfig.wallet;
  try {
    const t = await lastConfig.ticketProvider();
    if (!t?.ticket || !ws || ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ type: "auth", wallet: lastConfig.wallet, ticket: t.ticket }));
  } catch {
    // Ticket fetch failed (offline, signing rejected, backend down).
    // Connection stays open as a public socket. We deliberately leave
    // authAttemptedFor set so we don't loop the wallet popup if the
    // user rejected — a new attempt is gated on socket close or wallet
    // change. A page refresh also gives them a fresh attempt.
  }
}

export function disconnect() {
  manualDisconnect = true;
  clearTimeout(reconnectTimer);
  if (ws) {
    try { ws.close(); } catch {}
    ws = null;
  }
  authedWallet = null;
  authAttemptedFor = null;
  lastConfig = { wallet: null, ticketProvider: null, trackers: null };
  setStatus("disconnected");
}

export function send(msg) {
  if (!ws || ws.readyState !== ws.OPEN) return false;
  ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
  return true;
}

export function addListener(type, fn) {
  let set = listeners.get(type);
  if (!set) { set = new Set(); listeners.set(type, set); }
  set.add(fn);
  return () => removeListener(type, fn);
}

export function removeListener(type, fn) {
  const set = listeners.get(type);
  if (!set) return;
  set.delete(fn);
  if (set.size === 0) listeners.delete(type);
}
