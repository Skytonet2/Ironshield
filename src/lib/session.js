"use client";
// session.js — localStorage-backed session token cache.
//
// Day 5.6 added /api/auth/login which mints a 24h HMAC token after a
// single NEP-413 signature. This module is the client-side store: read
// the token before every mutation, fall back to signature + login if
// missing/expired/wallet-mismatched. apiFetch is the only consumer.
//
// Storage shape: a single record keyed under `ironshield:session`. We
// store the wallet alongside the token so a wallet switch invalidates
// the cached session before any request fires (instead of acting under
// the wrong identity until the server rejects).

const STORAGE_KEY = "ironshield:session";

// 30s grace so we never send a token that's about to tip over mid-flight.
const EXPIRY_GRACE_MS = 30_000;

export function readSession() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!j || typeof j.token !== "string" || typeof j.wallet !== "string") return null;
    if (typeof j.expiresAt !== "number") return null;
    return j;
  } catch { return null; }
}

export function saveSession({ wallet, token, expiresAt }) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ wallet, token, expiresAt })
    );
  } catch { /* quota / private mode */ }
}

export function clearSession() {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
}

export function isExpired(s) {
  if (!s || typeof s.expiresAt !== "number") return true;
  return Date.now() + EXPIRY_GRACE_MS >= s.expiresAt;
}

export function sessionFor(wallet) {
  const s = readSession();
  if (!s) return null;
  if (s.wallet !== String(wallet || "").toLowerCase().trim()) return null;
  if (isExpired(s)) return null;
  return s;
}
