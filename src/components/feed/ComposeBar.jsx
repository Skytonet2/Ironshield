"use client";
// Inline composer for the IronFeed. Sits above the tab strip. Opens to
// a full-height textarea + action row on focus. A floating + FAB is
// available when collapsed so users on mobile always have a visible
// affordance to post.
//
// The "voice" toggle lets a post be tagged as a Voice — a mini-piece
// (short take, reply-thread-opener, etc.) that still renders inline
// with everything else in the main feed but carries a visible label.
//
// Posts go to POST /api/posts.

import { useEffect, useState, useCallback, useRef } from "react";
import { Plus, X, Megaphone, Send } from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";

const API = (() => {
  if (typeof window === "undefined") return "";
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3001";
  return "https://ironclaw-backend.onrender.com";
})();

const MAX = 500;

export default function ComposeBar({ onPosted }) {
  const t = useTheme();
  const { address, showModal } = useWallet();
  const [open, setOpen]   = useState(false);
  const [text, setText]   = useState("");
  const [voice, setVoice] = useState(false);
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState(null);
  const taRef = useRef(null);

  // Listen for the global "post" action from TopNav / Sidebar / FAB and
  // auto-open + focus. Also honors ?compose=1 so cross-page links from
  // the AppShell can land straight on the composer.
  useEffect(() => {
    const openFromEvent = () => { setOpen(true); setTimeout(() => taRef.current?.focus(), 40); };
    window.addEventListener("ironshield:open-composer", openFromEvent);
    try {
      if (new URLSearchParams(location.search).get("compose") === "1") openFromEvent();
    } catch {}
    return () => window.removeEventListener("ironshield:open-composer", openFromEvent);
  }, []);

  const submit = useCallback(async () => {
    setErr(null);
    if (!address) { showModal?.(); return; }
    const content = text.trim();
    if (!content) return;
    if (content.length > MAX) { setErr(`Max ${MAX} chars`); return; }
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": address },
        body: JSON.stringify({
          content,
          // Posts flagged as Voice carry it through in the media_type field
          // so any client can render the label without schema changes.
          mediaType: voice ? "VOICE" : "NONE",
        }),
      });
      if (!res.ok) throw new Error(`post failed (${res.status})`);
      const j = await res.json();
      setText(""); setVoice(false); setOpen(false);
      onPosted?.(j.post || null);
    } catch (e) {
      setErr(e.message || "Post failed — is the backend online?");
    } finally {
      setBusy(false);
    }
  }, [address, text, voice, onPosted, showModal]);

  return (
    <>
      {/* Inline composer */}
      <div style={{
        border: `1px solid ${t.border}`,
        background: "var(--bg-card)",
        borderRadius: 12,
        marginBottom: 12,
        padding: open ? 12 : 10,
        transition: "padding 120ms ease",
      }}>
        {!open ? (
          <button
            type="button"
            onClick={() => { setOpen(true); setTimeout(() => taRef.current?.focus(), 40); }}
            style={{
              display: "flex", alignItems: "center", gap: 12, width: "100%",
              padding: "8px 10px", borderRadius: 8, background: "transparent",
              border: "none", color: t.textDim, cursor: "pointer", fontSize: 14,
              textAlign: "left",
            }}
            aria-label="Open post composer"
          >
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              background: "var(--accent-dim)", color: t.accent,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Plus size={16} />
            </div>
            <span>What's on your mind?</span>
          </button>
        ) : (
          <div>
            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX))}
              placeholder={voice
                ? "Voice post — your quick take…"
                : "What's happening in IronShield?"}
              rows={3}
              style={{
                width: "100%", resize: "vertical", minHeight: 80, maxHeight: 320,
                padding: 10, borderRadius: 8,
                border: `1px solid ${t.border}`, background: "var(--bg-input)",
                color: t.text, fontSize: 14, fontFamily: "inherit",
                outline: "none",
              }}
            />
            {err && (
              <div style={{ color: "var(--red)", fontSize: 12, margin: "6px 0 0" }}>
                {err}
              </div>
            )}
            <div style={{
              display: "flex", alignItems: "center", gap: 10, marginTop: 10,
            }}>
              <button
                type="button"
                onClick={() => setVoice((v) => !v)}
                title="Tag as Voice — a short take that shows a Voice label in the feed"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "6px 10px", borderRadius: 999,
                  border: `1px solid ${voice ? t.accent : t.border}`,
                  background: voice ? "var(--accent-dim)" : "transparent",
                  color: voice ? t.accent : t.textMuted,
                  fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}
              >
                <Megaphone size={12} />
                Voice
              </button>
              <div style={{ flex: 1 }} />
              <div style={{ fontSize: 11, color: text.length > MAX - 40 ? t.amber : t.textDim }}>
                {text.length}/{MAX}
              </div>
              <button
                type="button"
                onClick={() => { setOpen(false); setText(""); setVoice(false); setErr(null); }}
                style={{
                  padding: "6px 10px", borderRadius: 8,
                  border: `1px solid ${t.border}`, background: "transparent",
                  color: t.textMuted, fontSize: 12, cursor: "pointer",
                }}
              >
                <X size={12} style={{ verticalAlign: "middle" }} />
              </button>
              <button
                type="button"
                disabled={busy || !text.trim()}
                onClick={submit}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "7px 14px", borderRadius: 8, border: "none",
                  background: t.accent, color: "#fff",
                  fontSize: 13, fontWeight: 700, cursor: busy ? "wait" : "pointer",
                  opacity: (busy || !text.trim()) ? 0.5 : 1,
                }}
              >
                <Send size={12} />
                {busy ? "Posting…" : "Post"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Floating + FAB — mobile affordance that scrolls with the page. */}
      {!open && (
        <button
          type="button"
          onClick={() => { setOpen(true); setTimeout(() => taRef.current?.focus(), 40); }}
          aria-label="Post"
          className="ix-compose-fab"
          style={{
            position: "fixed", bottom: 74, right: 16, zIndex: 90,
            width: 52, height: 52, borderRadius: "50%",
            background: t.accent, color: "#fff",
            border: "none", cursor: "pointer",
            boxShadow: "0 6px 24px rgba(59,130,246,0.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <Plus size={22} />
        </button>
      )}
    </>
  );
}
