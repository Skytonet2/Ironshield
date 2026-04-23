"use client";
// First-visit modal that nudges users to link the IronShield Telegram
// bot. Shown once per browser (localStorage gate). If a wallet is
// connected we mint a `link-code` on the backend so the deep link
// auto-claims the wallet on the bot side — otherwise the user gets a
// plain /start and can paste their address in chat.

import { useEffect, useState } from "react";
import { Bell, BellOff, Wallet, X } from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";

const STORAGE_KEY = "ironshield:tg-onboarding:v1";
const BOT_USERNAME = process.env.NEXT_PUBLIC_TG_BOT_USERNAME || "IronShieldCore_bot";
import { API_BASE as API } from "@/lib/apiBase";

export default function TelegramOnboardingModal() {
  const t = useTheme();
  const { address } = useWallet() || {};
  const [open, setOpen] = useState(false);
  const [deepLink, setDeepLink] = useState(`https://t.me/${BOT_USERNAME}`);
  const [loading, setLoading] = useState(false);

  // Decide whether to show. We only show if:
  //   1. The user hasn't dismissed/confirmed before (localStorage),
  //   2. And we're on the client.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (localStorage.getItem(STORAGE_KEY)) return;
    } catch {}
    // Give the page a beat before popping the modal.
    const t = setTimeout(() => setOpen(true), 1800);
    return () => clearTimeout(t);
  }, []);

  // If a wallet connects while the modal is open, refresh the deep
  // link so it carries the wallet's link-code.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`${API}/api/tg/link-code`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ wallet: address || null }),
        });
        const j = await r.json();
        if (!cancelled && j.deepLink) setDeepLink(j.deepLink);
      } catch {
        // fall back to the plain bot URL already in state
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, address]);

  const close = (remember = true) => {
    setOpen(false);
    if (remember) {
      try { localStorage.setItem(STORAGE_KEY, new Date().toISOString()); } catch {}
    }
  };

  if (!open) return null;

  return (
    <div
      onClick={() => close(true)}
      style={{
        position: "fixed", inset: 0, zIndex: 140,
        background: "rgba(0,0,0,0.72)", backdropFilter: "blur(8px)",
        display: "grid", placeItems: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 460,
          background: t.bgCard, border: `1px solid ${t.border}`,
          borderRadius: 20, padding: 26, position: "relative",
          boxShadow: "0 30px 80px rgba(0,0,0,0.55)",
        }}
      >
        <button
          onClick={() => close(true)}
          title="Not now"
          style={{
            position: "absolute", top: 14, right: 14,
            width: 32, height: 32, borderRadius: "50%",
            border: `1px solid ${t.border}`, background: t.bgSurface,
            color: t.textMuted, cursor: "pointer",
            display: "grid", placeItems: "center",
          }}
        ><X size={16} /></button>

        <div style={{
          width: 56, height: 56, borderRadius: 16,
          background: `${t.accent}18`, color: t.accent,
          display: "grid", placeItems: "center", marginBottom: 14,
        }}>
          <Bell size={26} />
        </div>

        <div style={{ color: t.white, fontSize: 22, fontWeight: 800, letterSpacing: "-0.3px" }}>
          Connect our Telegram bot
        </div>
        <div style={{ color: t.textMuted, fontSize: 14, marginTop: 8, lineHeight: 1.6 }}>
          Real-time alerts for likes, follows, tips, DMs, new tokens and pump signals — plus one-tap <strong style={{ color: t.white }}>/portfolio</strong>, price alerts (<em>10x</em>, <em>5%</em>), watchlist and tipping from anywhere.
        </div>

        <ul style={{ marginTop: 14, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
          {[
            "🔔 Likes, reposts, comments, follows, tips, DMs",
            "🪙 Fires when a coin you created launches or pumps",
            "📨 Reply to site DMs directly from Telegram",
            "💸 Send tips and buy/sell from Telegram",
          ].map((line) => (
            <li key={line} style={{ color: t.text, fontSize: 13 }}>{line}</li>
          ))}
        </ul>

        <a
          href={deepLink}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => close(true)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            marginTop: 18, padding: "14px 20px", borderRadius: 12,
            background: "linear-gradient(135deg, #229ED9 0%, #0088cc 100%)",
            color: "#fff", fontWeight: 800, fontSize: 15, textDecoration: "none",
            opacity: loading ? 0.75 : 1,
          }}
        >
          {/* Telegram paper-plane glyph */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M21.5 4.2L2.7 11.5c-.9.4-.9 1.7 0 2l4.4 1.5 1.7 5.4c.3.9 1.5 1.1 2.1.3l2.5-3 4.7 3.5c.7.5 1.7.2 2-.7l3.6-14c.3-1.1-.9-2-1.9-1.5l-.3.2z"/>
          </svg>
          Open in Telegram
        </a>

        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, justifyContent: "center", color: t.textDim, fontSize: 12 }}>
          {address
            ? <><Wallet size={13} /> Linking <code style={{ color: t.textMuted }}>{address.slice(0, 8)}…{address.slice(-4)}</code> automatically</>
            : <>Connect a wallet first — or paste it to the bot later.</>}
        </div>

        <button
          onClick={() => close(true)}
          style={{
            width: "100%", marginTop: 12, padding: "10px 14px",
            background: "transparent", border: "none", color: t.textMuted,
            fontSize: 12, cursor: "pointer", display: "flex",
            alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          <BellOff size={12} /> Not now (don't ask again)
        </button>
      </div>
    </div>
  );
}
