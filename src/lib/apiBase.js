"use client";
// Single source of truth for the backend base URL.
//
// Lookup order:
//   1. NEXT_PUBLIC_BACKEND_URL inlined at build time (explicit override)
//   2. Hostname-based fallback: localhost → http://localhost:3001,
//      anything else → https://ironclaw-backend.onrender.com
//
// Using `process.env.X || "http://localhost:3001"` in-file (the old
// pattern) silently broke production when the env var wasn't set at
// build time — every page-scoped fetch would target localhost, which
// resolves to nothing in a deployed browser and returns "Failed to
// fetch" with no useful error. Centralizing it here makes regressions
// obvious and keeps the fallback smart.

export const API_BASE = (() => {
  if (typeof window === "undefined") return "";
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3001";
  return "https://ironclaw-backend.onrender.com";
})();
