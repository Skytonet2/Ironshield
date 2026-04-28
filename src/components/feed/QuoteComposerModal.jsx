"use client";
// QuoteComposerModal — opened when the user picks "Quote" from a
// FeedCard's repost menu. Renders the original post inline (read-only)
// with a textarea above it; submits to POST /api/posts with
// `quotedPostId` set so backend embeds the link on hydratePosts.

import { useEffect, useState } from "react";
import { X as XIcon, Loader2, Send } from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import { apiFetch } from "@/lib/apiFetch";

export default function QuoteComposerModal({ post, onClose, onPosted }) {
  const t = useTheme();
  const { address } = useWallet();
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!post) return null;
  const author = post.author || {};
  const name = author.display_name || author.username || "—";
  const handle = author.username ? `@${author.username}` : null;

  const submit = async () => {
    const content = text.trim();
    if (!content) { setErr("Add a comment to quote with."); return; }
    if (content.length > 500) { setErr("Max 500 chars."); return; }
    setPosting(true); setErr(null);
    try {
      const r = await apiFetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, quotedPostId: post.id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `post ${r.status}`);
      onPosted?.(j.post);
      onClose?.();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.62)",
        backdropFilter: "blur(8px)",
        zIndex: 240,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 540,
          background: "var(--bg-surface)",
          border: `1px solid ${t.border}`,
          borderRadius: 14,
          padding: 18,
          boxShadow: "0 20px 80px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.white }}>
            Quote post
          </h2>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} aria-label="Close" style={{
            background: "transparent", border: "none", color: t.textDim, cursor: "pointer", padding: 4,
          }}>
            <XIcon size={16} />
          </button>
        </div>

        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value.slice(0, 500)); setErr(null); }}
          placeholder="Add a comment…"
          rows={3}
          autoFocus
          disabled={!address || posting}
          style={{
            width: "100%", resize: "vertical", minHeight: 72,
            padding: 10, borderRadius: 10,
            border: `1px solid ${t.border}`, background: "var(--bg-input)",
            color: t.text, fontSize: 14, fontFamily: "inherit", outline: "none",
          }}
        />

        {/* Embedded original */}
        <div style={{
          marginTop: 10, padding: 10, borderRadius: 10,
          border: `1px solid ${t.border}`, background: "var(--bg-card)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            {author.pfp_url ? (
              <img src={author.pfp_url} alt="" width={20} height={20}
                   style={{ borderRadius: "50%", objectFit: "cover" }}
                   onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
            ) : (
              <div style={{
                width: 20, height: 20, borderRadius: "50%",
                background: `linear-gradient(135deg, #a855f7, ${t.accent})`,
                color: "#fff", fontSize: 10, fontWeight: 800,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>{(name[0] || "?").toUpperCase()}</div>
            )}
            <span style={{ fontSize: 12, fontWeight: 700, color: t.white }}>{name}</span>
            {handle && <span style={{ fontSize: 11, color: t.textDim }}>{handle}</span>}
          </div>
          <div style={{
            fontSize: 13, color: t.text, lineHeight: 1.45,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
            display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden",
          }}>
            {post.content}
          </div>
        </div>

        {err && (
          <div style={{ marginTop: 8, padding: "6px 10px", fontSize: 12, color: "var(--red)",
            background: "rgba(239,68,68,0.08)", borderRadius: 8 }}>{err}</div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
          <span style={{ fontSize: 11, color: t.textDim }}>
            {text.length}/500
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            disabled={!text.trim() || posting || !address}
            onClick={submit}
            style={{
              padding: "9px 16px", borderRadius: 10, border: "none",
              background: text.trim() && !posting ? t.accent : "var(--bg-input)",
              color: text.trim() && !posting ? "#fff" : t.textDim,
              fontSize: 13, fontWeight: 700, letterSpacing: 0.4,
              cursor: text.trim() && !posting ? "pointer" : "not-allowed",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
          >
            {posting ? <><Loader2 size={13} style={{ animation: "spin 0.9s linear infinite" }} /> Posting</> : <><Send size={13} /> Post</>}
          </button>
        </div>
      </div>
    </div>
  );
}
