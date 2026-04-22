"use client";
// useNotifications — shared store for the Notifications drawer and
// every badge it feeds (TopNav bell, mobile bottom-nav Alerts).
//
// One module-level fetch loop keeps every consumer in sync. Polls
// /api/notifications every 30s while a wallet is connected; pauses
// when no one's subscribed to save bandwidth.

import { useEffect, useState } from "react";

const POLL_MS = 30_000;

const BACKEND_BASE = (() => {
  if (typeof window === "undefined") return "";
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3001";
  return "https://ironclaw-backend.onrender.com";
})();

let state = {
  wallet: null,
  items: [],
  unreadCount: 0,
  lastFetch: 0,
};
let pollTimer = null;
const listeners = new Set();

function emit() {
  for (const fn of listeners) fn(state);
}

async function refresh() {
  if (!state.wallet) return;
  try {
    const r = await fetch(`${BACKEND_BASE}/api/notifications`, {
      headers: { "x-wallet": state.wallet },
    });
    if (!r.ok) return;
    const j = await r.json();
    const items = Array.isArray(j.notifications) ? j.notifications : [];
    const unreadCount = items.filter((n) => !n.read_at).length;
    state = { ...state, items, unreadCount, lastFetch: Date.now() };
    emit();
  } catch { /* keep previous state */ }
}

function startPoll() {
  if (pollTimer) return;
  pollTimer = setInterval(refresh, POLL_MS);
}
function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

export function useNotifications(wallet) {
  const [snap, setSnap] = useState(state);

  useEffect(() => {
    // When the wallet changes, reset and refetch.
    if (state.wallet !== wallet) {
      state = { wallet: wallet || null, items: [], unreadCount: 0, lastFetch: 0 };
      emit();
      if (wallet) refresh();
    }
    listeners.add(setSnap);
    if (wallet) startPoll();
    return () => {
      listeners.delete(setSnap);
      if (listeners.size === 0) stopPoll();
    };
  }, [wallet]);

  return {
    items: snap.items,
    unreadCount: snap.unreadCount,
    lastFetch: snap.lastFetch,
    reload: refresh,
    markAllRead: async () => {
      if (!state.wallet) return;
      try {
        await fetch(`${BACKEND_BASE}/api/notifications/read-all`, {
          method: "POST",
          headers: { "x-wallet": state.wallet },
        });
        state = {
          ...state,
          items: state.items.map((n) => n.read_at ? n : { ...n, read_at: new Date().toISOString() }),
          unreadCount: 0,
        };
        emit();
      } catch { /* optimistic stays */ }
    },
  };
}
