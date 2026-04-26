"use client";
// useNotifications — shared store for the Notifications drawer and
// every badge it feeds (TopNav bell, mobile bottom-nav Alerts).
//
// One module-level fetch seeds the cache on wallet connect; from then
// on the WS `notification:new` event prepends new rows in real time
// (Day 5.5 — replaced the old 30s poll on /api/notifications).
// Consumers can still call reload() to re-pull authoritatively (e.g.
// after a markAllRead / dismiss flow that mutates server state in a
// way the WS event doesn't cover).

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiFetch";

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

// Called by AppShell when a `notification:new` WS event arrives.
// Idempotent on id so a re-emit (server retry, page refocus refetch
// race) doesn't double-count unread.
export function prependNotification(n) {
  if (!n || n.id == null) return;
  if (state.items.some((existing) => existing.id === n.id)) return;
  const items = [n, ...state.items].slice(0, 200);
  const unreadCount = items.filter((x) => !x.read_at).length;
  state = { ...state, items, unreadCount };
  emit();
}

export function useNotifications(wallet) {
  const [snap, setSnap] = useState(state);

  useEffect(() => {
    if (state.wallet !== wallet) {
      state = { wallet: wallet || null, items: [], unreadCount: 0, lastFetch: 0 };
      emit();
      if (wallet) refresh();
    }
    listeners.add(setSnap);
    return () => { listeners.delete(setSnap); };
  }, [wallet]);

  return {
    items: snap.items,
    unreadCount: snap.unreadCount,
    lastFetch: snap.lastFetch,
    reload: refresh,
    markAllRead: async () => {
      if (!state.wallet) return;
      try {
        await apiFetch(`/api/notifications/read-all`, {
          method: "POST",
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
