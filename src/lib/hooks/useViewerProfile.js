"use client";
// useViewerProfile — shared hook that fetches and caches the connected
// viewer's profile row (displayName, pfpUrl, bannerUrl, counts, etc.).
//
// Multiple surfaces need this: the top-nav UserMenu renders the pfp as
// an avatar, the ComposeBar renders it beside "What's on your mind",
// the sidebar "Your Account" card shows stats. Without a shared cache
// each surface re-fetches on every mount, which is both wasteful and
// lets the avatars flash in staggered order.
//
// Cache key is the wallet address. Results persist across unmounts
// (module-level Map), so switching routes doesn't re-fetch the same
// row. A simple 60s TTL keeps it fresh after profile edits — the
// Profile page can also call `primeViewerProfile(wallet, user)` after
// a successful PATCH so the new values show up everywhere immediately
// instead of waiting for the next fetch.

import { useEffect, useState } from "react";

const API = (() => {
  if (typeof window === "undefined") return "";
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3001";
  return "https://ironclaw-backend.onrender.com";
})();

const TTL_MS = 60_000;
const cache = new Map(); // wallet -> { user, fetchedAt }
const listeners = new Map(); // wallet -> Set<setProfile>

function notify(wallet) {
  const set = listeners.get(wallet);
  if (!set) return;
  const entry = cache.get(wallet);
  const user = entry?.user || null;
  for (const fn of set) fn(user);
}

export function primeViewerProfile(wallet, user) {
  if (!wallet) return;
  cache.set(wallet, { user, fetchedAt: Date.now() });
  notify(wallet);
}

export function invalidateViewerProfile(wallet) {
  if (!wallet) return;
  cache.delete(wallet);
}

async function fetchOnce(wallet) {
  const entry = cache.get(wallet);
  if (entry && Date.now() - entry.fetchedAt < TTL_MS) return entry.user;
  try {
    const r = await fetch(`${API}/api/profile/${encodeURIComponent(wallet)}`);
    if (!r.ok) {
      cache.set(wallet, { user: null, fetchedAt: Date.now() });
      return null;
    }
    const j = await r.json();
    cache.set(wallet, { user: j?.user || null, fetchedAt: Date.now() });
    return j?.user || null;
  } catch {
    return null;
  }
}

export default function useViewerProfile(wallet) {
  const [profile, setProfile] = useState(() => {
    if (!wallet) return null;
    return cache.get(wallet)?.user || null;
  });

  useEffect(() => {
    if (!wallet) { setProfile(null); return; }
    // Subscribe this setter to updates for this wallet so `prime()`
    // calls propagate across every mounted consumer.
    let set = listeners.get(wallet);
    if (!set) { set = new Set(); listeners.set(wallet, set); }
    set.add(setProfile);
    // Kick off / reuse a fetch.
    let alive = true;
    fetchOnce(wallet).then((u) => {
      if (alive) setProfile(u);
    });
    return () => {
      alive = false;
      set.delete(setProfile);
      if (set.size === 0) listeners.delete(wallet);
    };
  }, [wallet]);

  return profile;
}
