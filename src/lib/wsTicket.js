"use client";
// wsTicket — fetches a short-lived HMAC ticket from the backend so the
// /ws/feed handshake can verify the connecting wallet without running
// a NEP-413 popup on every reconnect.
//
// Tickets are minted by POST /api/auth/ws-ticket — a signed REST call
// that already requires a fresh nonce + signature. apiFetch handles
// the signing; this helper just exposes the resulting ticket.

import { apiFetch } from "@/lib/apiFetch";

export async function fetchWsTicket() {
  const r = await apiFetch("/api/auth/ws-ticket", { method: "POST" });
  if (!r.ok) throw new Error(`ws-ticket ${r.status}`);
  return r.json();
}
