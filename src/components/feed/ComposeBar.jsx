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
import { createPortal } from "react-dom";
import {
  Plus, X, Megaphone, Send, Image as ImageIcon, Film, BarChart3,
  Smile, Link2, Globe, Users, Lock, ChevronDown, Sparkles,
} from "lucide-react";
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

const AUDIENCES = [
  { key: "everyone",  label: "Everyone",  Icon: Globe },
  { key: "followers", label: "Followers", Icon: Users },
  { key: "private",   label: "Only me",   Icon: Lock },
];

export default function ComposeBar({ onPosted }) {
  const t = useTheme();
  const { address, showModal } = useWallet();
  const [open, setOpen]       = useState(false);
  const [text, setText]       = useState("");
  const [voice, setVoice]     = useState(false);
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState(null);
  const [audience, setAud]    = useState("everyone");
  const [audOpen, setAudOpen] = useState(false);
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const [mediaUrls, setMediaUrls] = useState([]);
  const [uploadBusy, setUploadBusy] = useState(false);

  // Detect mobile once on mount + on resize. When `open && isMobile`
  // we render the whole composer inside a full-screen portal (reference
  // panel #6) instead of inline. Gives phones a proper native-feel
  // post surface without stealing layout from the inline version on
  // desktop.
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    try { return window.matchMedia("(max-width: 899px)").matches; }
    catch { return false; }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 899px)");
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  // AI Post Generator (panel #6 bottom card) — draft a short post
  // from a prompt. The backend endpoint is optional; when absent we
  // fall back to a cheerful "coming soon" toast instead of failing.
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiBusy, setAiBusy]     = useState(false);
  const aiSuggest = useCallback(async () => {
    const p = aiPrompt.trim();
    if (!p) return;
    setAiBusy(true);
    try {
      const r = await fetch(`${API}/api/ai/compose`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": address || "" },
        body: JSON.stringify({ prompt: p, maxChars: MAX }),
      });
      if (r.ok) {
        const j = await r.json();
        if (j?.text) setText(j.text.slice(0, MAX));
      } else if (r.status === 404) {
        setErr("AI compose endpoint isn't enabled on this backend yet.");
      } else {
        setErr(`AI suggest failed (${r.status})`);
      }
    } catch (e) {
      setErr(e.message || "AI suggest failed");
    } finally {
      setAiBusy(false);
    }
  }, [aiPrompt, address]);

  const aud = AUDIENCES.find((a) => a.key === audience) || AUDIENCES[0];
  const AudIcon = aud.Icon;

  const upload = useCallback(async (files) => {
    if (!files || !files.length || !address) return;
    setUploadBusy(true);
    try {
      const sigRes = await fetch(`${API}/api/profile/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": address },
      });
      if (!sigRes.ok) {
        const j = await sigRes.json().catch(() => ({}));
        throw new Error(j?.hint || j?.error || `upload-signature ${sigRes.status}`);
      }
      const sig = await sigRes.json();
      const urls = [];
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("api_key", sig.apiKey);
        fd.append("timestamp", String(sig.timestamp));
        fd.append("signature", sig.signature);
        fd.append("folder", sig.folder);
        const up = await fetch(sig.uploadUrl, { method: "POST", body: fd });
        if (!up.ok) throw new Error(`cloudinary ${up.status}`);
        const j = await up.json();
        urls.push(j.secure_url);
      }
      setMediaUrls((prev) => [...prev, ...urls].slice(0, 4));
    } catch (e) {
      setErr(e.message || "Upload failed");
    } finally {
      setUploadBusy(false);
    }
  }, [address]);

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
    if (!content && mediaUrls.length === 0) return;
    if (content.length > MAX) { setErr(`Max ${MAX} chars`); return; }
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": address },
        body: JSON.stringify({
          content,
          mediaUrls,
          // Posts flagged as Voice carry it through in the media_type field
          // so any client can render the label without schema changes.
          mediaType: voice ? "VOICE" : (mediaUrls.length ? "MEDIA" : "NONE"),
          audience,
        }),
      });
      if (!res.ok) throw new Error(`post failed (${res.status})`);
      const j = await res.json();
      setText(""); setVoice(false); setMediaUrls([]); setOpen(false); setAud("everyone");
      onPosted?.(j.post || null);
    } catch (e) {
      setErr(e.message || "Post failed — is the backend online?");
    } finally {
      setBusy(false);
    }
  }, [address, text, voice, mediaUrls, audience, onPosted, showModal]);

  const iconBtn = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 32, height: 32, borderRadius: 8,
    background: "transparent", border: "none",
    color: t.textMuted, cursor: "pointer",
    transition: "background 120ms ease, color 120ms ease",
  };

  // ─── Full-screen mobile sheet (reference panel #6) ───────────────
  // Rendered as a portal to <body> so it escapes the feed's scroll
  // container and any ancestor transforms. Shares state with the
  // inline composer so switching between viewports doesn't lose
  // drafted text or media.
  const mobileSheet = isMobile && open && typeof document !== "undefined"
    ? createPortal(
        <div
          role="dialog"
          aria-label="Create post"
          style={{
            position: "fixed", inset: 0, zIndex: 400,
            background: "var(--bg-app)",
            display: "flex", flexDirection: "column",
            animation: "ix-sheet-in 220ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {/* Sheet header */}
          <header style={{
            height: 52, flexShrink: 0,
            display: "flex", alignItems: "center", gap: 10,
            padding: "0 12px", borderBottom: `1px solid ${t.border}`,
            background: "var(--bg-surface)",
          }}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              style={{
                width: 34, height: 34, borderRadius: 8,
                border: `1px solid ${t.border}`, background: "transparent",
                color: t.textMuted, cursor: "pointer",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <X size={16} />
            </button>
            <div style={{ flex: 1, textAlign: "center", fontSize: 14, fontWeight: 700, color: t.white }}>
              Create Post
            </div>
            <button
              type="button"
              disabled={busy || (!text.trim() && mediaUrls.length === 0)}
              onClick={submit}
              style={{
                padding: "7px 16px", borderRadius: 999, border: "none",
                background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
                color: "#fff", fontSize: 13, fontWeight: 700,
                cursor: busy ? "wait" : "pointer",
                opacity: (busy || (!text.trim() && mediaUrls.length === 0)) ? 0.5 : 1,
                boxShadow: "0 6px 16px rgba(168,85,247,0.35)",
              }}
            >
              {busy ? "…" : "Post"}
            </button>
          </header>

          {/* Body — scrollable */}
          <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 20px" }}>
            {/* Author strip */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{
                width: 40, height: 40, borderRadius: "50%",
                background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
                color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16, fontWeight: 800, flexShrink: 0,
              }}>
                {(address?.[0]?.toUpperCase()) || <Plus size={16} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: t.white }}>
                  {address ? "Shield Holder" : "Guest"}
                </div>
                <div style={{ fontSize: 12, color: t.textDim }}>
                  @{address ? (address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address) : "signin"}
                </div>
              </div>

              {/* Audience pill */}
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setAudOpen((v) => !v)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "5px 10px", borderRadius: 999,
                    border: `1px solid ${t.border}`, background: "var(--bg-surface)",
                    color: t.text, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  <AudIcon size={12} />
                  {aud.label}
                  <ChevronDown size={11} />
                </button>
                {audOpen && (
                  <div
                    onMouseLeave={() => setAudOpen(false)}
                    style={{
                      position: "absolute", right: 0, top: "calc(100% + 4px)",
                      minWidth: 160, padding: 4, borderRadius: 8,
                      border: `1px solid ${t.border}`, background: "var(--bg-card)",
                      boxShadow: "0 14px 28px rgba(0,0,0,0.4)", zIndex: 50,
                    }}
                  >
                    {AUDIENCES.map((a) => {
                      const AIcon2 = a.Icon;
                      const sel = a.key === audience;
                      return (
                        <button
                          key={a.key}
                          type="button"
                          onClick={() => { setAud(a.key); setAudOpen(false); }}
                          style={{
                            width: "100%", textAlign: "left",
                            display: "flex", alignItems: "center", gap: 8,
                            padding: "8px 10px", borderRadius: 6,
                            background: sel ? "var(--accent-dim)" : "transparent",
                            color: sel ? t.accent : t.text,
                            border: "none", cursor: "pointer", fontSize: 13,
                          }}
                        >
                          <AIcon2 size={12} />
                          {a.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Big textarea */}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX))}
              placeholder={voice ? "Voice post — your quick take…" : "What's on your mind?"}
              autoFocus
              style={{
                width: "100%", minHeight: 160, maxHeight: "40vh",
                resize: "none", padding: 0, border: "none", outline: "none",
                background: "transparent",
                color: t.text, fontSize: 17, lineHeight: 1.5, fontFamily: "inherit",
              }}
            />

            {/* Media previews */}
            {mediaUrls.length > 0 && (
              <div style={{ display: "grid", gap: 6, gridTemplateColumns: mediaUrls.length === 1 ? "1fr" : "1fr 1fr", marginTop: 10 }}>
                {mediaUrls.map((u, i) => (
                  <div key={i} style={{ position: "relative", borderRadius: 12, overflow: "hidden", border: `1px solid ${t.border}` }}>
                    {/\.(mp4|webm|mov)(\?|#|$)/i.test(u)
                      ? <video src={u} controls playsInline style={{ width: "100%", maxHeight: 260, display: "block" }} />
                      : <img src={u} alt="" style={{ width: "100%", maxHeight: 260, objectFit: "cover", display: "block" }} />}
                    <button
                      type="button"
                      onClick={() => setMediaUrls((m) => m.filter((_, idx) => idx !== i))}
                      style={{
                        position: "absolute", top: 6, right: 6,
                        width: 28, height: 28, borderRadius: "50%",
                        background: "rgba(0,0,0,0.6)", border: `1px solid rgba(255,255,255,0.2)`,
                        color: "#fff", cursor: "pointer",
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Counter + Voice status */}
            <div style={{
              marginTop: 12, display: "flex", alignItems: "center", gap: 8,
              fontSize: 12, color: t.textDim,
            }}>
              <span>{text.length}/{MAX}</span>
              {voice && <span style={{ color: "#c084fc", fontWeight: 700 }}>· Voice post</span>}
              {uploadBusy && <span>· Uploading…</span>}
            </div>

            {err && (
              <div style={{
                marginTop: 10, padding: "8px 10px", borderRadius: 8,
                background: "rgba(239,68,68,0.08)", border: "1px solid var(--red)",
                color: "var(--red)", fontSize: 12,
              }}>
                {err}
              </div>
            )}

            {/* AI Post Generator card */}
            <div style={{
              marginTop: 18, padding: 14, borderRadius: 14,
              border: `1px solid ${t.border}`,
              background: "linear-gradient(180deg, rgba(168,85,247,0.08), rgba(59,130,246,0.04) 70%, transparent), var(--bg-card)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <Sparkles size={13} color="#c084fc" />
                <div style={{ fontSize: 13, fontWeight: 700, color: t.white }}>
                  AI Post Generator
                </div>
                <span style={{
                  fontSize: 9, padding: "2px 6px", borderRadius: 4,
                  background: "rgba(168,85,247,0.18)", color: "#c084fc",
                  letterSpacing: 0.5, fontWeight: 800,
                }}>BETA</span>
              </div>
              <div style={{ fontSize: 12, color: t.textDim, marginBottom: 10 }}>
                Generate a post with AI
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value.slice(0, 300))}
                  placeholder="Describe what you want to post about…"
                  rows={2}
                  style={{
                    flex: 1, minHeight: 54, resize: "vertical",
                    padding: 10, borderRadius: 10,
                    border: `1px solid ${t.border}`, background: "var(--bg-input)",
                    color: t.text, fontSize: 13, fontFamily: "inherit", outline: "none",
                  }}
                />
                <button
                  type="button"
                  disabled={aiBusy || !aiPrompt.trim()}
                  onClick={aiSuggest}
                  aria-label="Generate"
                  style={{
                    width: 44, height: 44, borderRadius: 12, border: "none",
                    background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
                    color: "#fff", cursor: aiBusy ? "wait" : "pointer",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    opacity: aiBusy || !aiPrompt.trim() ? 0.5 : 1,
                    boxShadow: "0 8px 20px rgba(168,85,247,0.35)",
                    flexShrink: 0,
                  }}
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* Sticky action row — same icons as the inline version so
              muscle memory carries over. */}
          <div style={{
            height: 56, flexShrink: 0,
            display: "flex", alignItems: "center", gap: 2,
            padding: "0 10px",
            borderTop: `1px solid ${t.border}`,
            background: "var(--bg-surface)",
          }}>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*"
              multiple
              style={{ display: "none" }}
              onChange={(e) => upload(Array.from(e.target.files || []))}
            />
            <IconAction Icon={ImageIcon} label="Image" onClick={() => fileRef.current?.click()} disabled={uploadBusy || mediaUrls.length >= 4} style={iconBtn} t={t} />
            <IconAction Icon={Film}      label="Video" onClick={() => fileRef.current?.click()} disabled={uploadBusy || mediaUrls.length >= 4} style={iconBtn} t={t} />
            <IconAction Icon={BarChart3} label="Poll — soon" disabled style={iconBtn} t={t} />
            <IconAction Icon={Smile}     label="Emoji — soon" disabled style={iconBtn} t={t} />
            <IconAction Icon={Link2}     label="Link — soon" disabled style={iconBtn} t={t} />
            <IconAction Icon={Megaphone} label="Tag as Voice" onClick={() => setVoice((v) => !v)} active={voice} style={iconBtn} t={t} />
          </div>

          <style jsx global>{`
            @keyframes ix-sheet-in {
              from { opacity: 0; transform: translateY(18px); }
              to   { opacity: 1; transform: translateY(0); }
            }
          `}</style>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      {mobileSheet}

      {/* Composer — glass card. Avatar left, single-line input, then
          an action row with media buttons, audience dropdown, and the
          Post CTA. Expands on focus to grow the textarea. */}
      <div style={{
        border: `1px solid ${t.border}`,
        background: "linear-gradient(180deg, rgba(168,85,247,0.04), transparent 60%), var(--bg-card)",
        borderRadius: 14,
        marginBottom: 12,
        padding: 12,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
      }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          {/* Avatar — neutral gradient when no pfp. Click routes to profile. */}
          <a
            href={address ? `/profile?address=${encodeURIComponent(address)}` : "/profile"}
            style={{
              width: 40, height: 40, borderRadius: "50%",
              background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
              color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 16, fontWeight: 800, flexShrink: 0,
              textDecoration: "none",
            }}
            aria-label="Your profile"
          >
            {(address?.[0]?.toUpperCase()) || <Plus size={16} />}
          </a>

          <div style={{ flex: 1, minWidth: 0 }}>
            <textarea
              ref={taRef}
              value={text}
              onFocus={() => setOpen(true)}
              onChange={(e) => setText(e.target.value.slice(0, MAX))}
              placeholder={voice
                ? "Voice post — your quick take…"
                : "What's on your mind?"}
              rows={open ? 2 : 1}
              style={{
                width: "100%", resize: "none",
                minHeight: open ? 72 : 38, maxHeight: 320,
                padding: open ? "10px 4px" : "8px 4px",
                borderRadius: 0,
                border: "none",
                background: "transparent",
                color: t.text, fontSize: 15, fontFamily: "inherit",
                outline: "none",
                transition: "min-height 160ms ease",
              }}
            />

            {mediaUrls.length > 0 && (
              <div style={{ display: "grid", gap: 6, gridTemplateColumns: mediaUrls.length === 1 ? "1fr" : "1fr 1fr", marginTop: 6 }}>
                {mediaUrls.map((u, i) => (
                  <div key={i} style={{ position: "relative", borderRadius: 10, overflow: "hidden", border: `1px solid ${t.border}` }}>
                    {/\.(mp4|webm|mov)(\?|#|$)/i.test(u)
                      ? <video src={u} controls playsInline style={{ width: "100%", maxHeight: 200, display: "block" }} />
                      : <img src={u} alt="" style={{ width: "100%", maxHeight: 200, objectFit: "cover", display: "block" }} />}
                    <button
                      type="button"
                      onClick={() => setMediaUrls((m) => m.filter((_, idx) => idx !== i))}
                      style={{
                        position: "absolute", top: 6, right: 6,
                        width: 26, height: 26, borderRadius: "50%",
                        background: "rgba(0,0,0,0.6)", border: `1px solid rgba(255,255,255,0.2)`,
                        color: "#fff", cursor: "pointer",
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {err && (
              <div style={{ color: "var(--red)", fontSize: 12, margin: "6px 0 0" }}>
                {err}
              </div>
            )}

            {/* Action row — icons left, audience + Post right. */}
            <div style={{
              display: "flex", alignItems: "center", gap: 2, marginTop: open ? 6 : 4,
              paddingTop: 8, borderTop: open ? `1px solid ${t.border}` : "none",
            }}>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*"
                multiple
                style={{ display: "none" }}
                onChange={(e) => upload(Array.from(e.target.files || []))}
              />
              <IconAction Icon={ImageIcon} label="Image" onClick={() => fileRef.current?.click()} disabled={uploadBusy || mediaUrls.length >= 4} style={iconBtn} t={t} />
              <IconAction Icon={Film}      label="Video" onClick={() => fileRef.current?.click()} disabled={uploadBusy || mediaUrls.length >= 4} style={iconBtn} t={t} />
              <IconAction Icon={BarChart3} label="Poll — soon" disabled style={iconBtn} t={t} />
              <IconAction Icon={Smile}     label="Emoji — soon" disabled style={iconBtn} t={t} />
              <IconAction Icon={Link2}     label="Link — soon" disabled style={iconBtn} t={t} />
              <IconAction
                Icon={Sparkles}
                label="AI suggest — soon"
                disabled
                style={iconBtn}
                t={t}
              />
              <IconAction
                Icon={Megaphone}
                label="Tag as Voice"
                onClick={() => setVoice((v) => !v)}
                active={voice}
                style={iconBtn}
                t={t}
              />
              <div style={{ flex: 1 }} />

              {/* Audience dropdown */}
              <div style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setAudOpen((v) => !v)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "5px 10px", borderRadius: 999,
                    border: `1px solid ${t.border}`, background: "var(--bg-surface)",
                    color: t.text, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  <AudIcon size={12} />
                  {aud.label}
                  <ChevronDown size={12} />
                </button>
                {audOpen && (
                  <div
                    onMouseLeave={() => setAudOpen(false)}
                    style={{
                      position: "absolute", right: 0, top: "calc(100% + 4px)",
                      minWidth: 160, padding: 4, borderRadius: 8,
                      border: `1px solid ${t.border}`, background: "var(--bg-card)",
                      boxShadow: "0 14px 28px rgba(0,0,0,0.4)",
                      zIndex: 50,
                    }}
                  >
                    {AUDIENCES.map((a) => {
                      const AIcon = a.Icon;
                      const sel = a.key === audience;
                      return (
                        <button
                          key={a.key}
                          type="button"
                          onClick={() => { setAud(a.key); setAudOpen(false); }}
                          style={{
                            width: "100%", textAlign: "left",
                            display: "flex", alignItems: "center", gap: 8,
                            padding: "8px 10px", borderRadius: 6,
                            background: sel ? "var(--accent-dim)" : "transparent",
                            color: sel ? t.accent : t.text,
                            border: "none", cursor: "pointer", fontSize: 13,
                          }}
                        >
                          <AIcon size={12} />
                          {a.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <button
                type="button"
                disabled={busy || (!text.trim() && mediaUrls.length === 0)}
                onClick={submit}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "6px 16px", borderRadius: 999, border: "none",
                  background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
                  color: "#fff",
                  fontSize: 13, fontWeight: 700, cursor: busy ? "wait" : "pointer",
                  opacity: (busy || (!text.trim() && mediaUrls.length === 0)) ? 0.5 : 1,
                  boxShadow: "0 6px 20px rgba(168,85,247,0.35)",
                }}
              >
                {busy ? "Posting…" : "Post"}
              </button>
            </div>
            {open && (
              <div style={{ fontSize: 11, color: t.textDim, marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
                <span>{text.length}/{MAX}</span>
                {voice && <span style={{ color: "#c084fc", fontWeight: 700 }}>· Voice post</span>}
                {uploadBusy && <span>· Uploading…</span>}
                <span style={{ flex: 1 }} />
                {open && (
                  <button
                    type="button"
                    onClick={() => { setOpen(false); setText(""); setVoice(false); setMediaUrls([]); setErr(null); }}
                    style={{
                      padding: "2px 8px", borderRadius: 6, border: "none",
                      background: "transparent", color: t.textMuted,
                      fontSize: 11, cursor: "pointer",
                    }}
                  >
                    Collapse
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Floating + FAB — pinned to the viewport. Rendered via a portal
          to <body> because any ancestor with a non-"none" transform
          turns position:fixed into position:relative-to-that-ancestor,
          and <main> has a page-enter animation whose transform lingered
          in the computed style. Portal sidesteps that class of bug for
          good. */}
      {/* The standalone FAB used to live here, but the mobile
          bottom nav now carries a gradient + button in the center
          slot — we don't want two pink blobs fighting for the same
          corner. On desktop there's no FAB either; the composer
          itself is always visible at the top of /feed.
          The ComposerBar still listens for the global
          "ironshield:open-composer" event + the ?compose=1 query,
          so the bottom-nav + button (which fires that action) still
          opens this composer in place. */}
    </>
  );
}

function IconAction({ Icon, label, onClick, disabled, active, style, t }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
      style={{
        ...style,
        color: active ? t.accent : disabled ? t.textDim : t.textMuted,
        background: active ? "var(--accent-dim)" : "transparent",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled && !active) { e.currentTarget.style.background = "var(--bg-card-hover)"; e.currentTarget.style.color = t.accent; } }}
      onMouseLeave={(e) => { if (!disabled && !active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = t.textMuted; } }}
    >
      <Icon size={16} />
    </button>
  );
}
