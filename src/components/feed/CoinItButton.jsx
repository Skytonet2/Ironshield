"use client";
// CoinItButton — the "⚡ Coin It" affordance that appears on every
// feed card per spec §8A.
//
// This turn: button + basic modal + backend log to coin_it_events
// so the data model is live and analytics can start tracking which
// posts produce the most launches. Full flow (IronClaw token-name
// suggestion, chain picker, then hand-off to the launchpad selector
// from Phase 5) lands alongside Phase 5's launchpad modal.
//
// Can be dropped on any card — caller supplies the source (post,
// news, external) + identifying fields. Hover-revealed per spec;
// always keyboard-focusable.

import { useState } from "react";
import { Zap } from "lucide-react";
import { useTheme } from "@/lib/contexts";
import LaunchpadSelector from "@/components/create/LaunchpadSelector";

const BACKEND_BASE = (() => {
  if (typeof window === "undefined") return "";
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3001";
  return "https://ironclaw-backend.onrender.com";
})();

export default function CoinItButton({
  sourceType,          // 'post' | 'news' | 'external'
  sourcePostId = null,
  sourceUrl    = null,
  sourceText   = "",
  suggestedName,       // pre-fill for the modal
  suggestedTicker,
  style,
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title="Launch this as a token"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "3px 8px",
          borderRadius: 999,
          border: `1px solid ${t.border}`,
          background: "var(--bg-input)",
          color: t.accent,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.4,
          cursor: "pointer",
          ...(style || {}),
        }}
      >
        <Zap size={11} /> Coin It
      </button>
      {open && (
        <CoinItModal
          sourceType={sourceType}
          sourcePostId={sourcePostId}
          sourceUrl={sourceUrl}
          sourceText={sourceText}
          suggestedName={suggestedName}
          suggestedTicker={suggestedTicker}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function CoinItModal({
  sourceType, sourcePostId, sourceUrl, sourceText,
  suggestedName, suggestedTicker,
  onClose,
}) {
  const t = useTheme();
  const defaultName   = suggestedName   || (sourceText ? sourceText.slice(0, 40) : "");
  const defaultTicker = suggestedTicker || deriveTicker(sourceText || suggestedName || "");
  const [name, setName]     = useState(defaultName);
  const [ticker, setTicker] = useState(defaultTicker);
  const [chain, setChain]   = useState("near");
  const [busy, setBusy]     = useState(false);
  const [status, setStatus] = useState(null);
  const [handoff, setHandoff] = useState(null);  // non-null opens the LaunchpadSelector

  async function submit() {
    if (!name.trim() || !ticker.trim()) return;
    setBusy(true);
    setStatus("Logging intent…");
    try {
      // Fire-and-forget the analytics log so the funnel is measured
      // even if the user abandons the launchpad step.
      await fetch(`${BACKEND_BASE}/api/feed/coin-it`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_type:    sourceType,
          source_post_id: sourcePostId,
          source_url:     sourceUrl,
          name:           name.trim(),
          ticker:         ticker.trim().toUpperCase(),
          chain,
          platform:       "ironshield",
        }),
      }).catch(() => { /* soft-fail — keep the UX moving */ });

      // Hand off to the launchpad selector pre-filled with the user's
      // edited name/ticker. Closes the Coin It → launch funnel fully;
      // external platforms open in a new tab, IronShield Pad deep-
      // links into the NewsCoin flow.
      setHandoff({
        name:   name.trim(),
        ticker: ticker.trim().toUpperCase(),
        sourceUrl: sourceUrl || null,
        initialChain: chain,
      });
    } catch (e) {
      setStatus(`Failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  // Once the user commits, the Coin It modal fades into the
  // LaunchpadSelector. Keeps the back-to-source continuity —
  // prefill carries forward so they don't retype anything.
  if (handoff) {
    return (
      <LaunchpadSelector
        prefill={handoff}
        initialChain={handoff.initialChain}
        onClose={() => { setHandoff(null); onClose(); }}
      />
    );
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(6px)",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 460,
          background: "var(--bg-surface)",
          border: `1px solid ${t.border}`,
          borderRadius: 14,
          boxShadow: "var(--accent-glow)",
          padding: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <Zap size={16} style={{ color: t.accent }} />
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: t.white }}>
            Coin It
          </h3>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: t.textDim,
              fontSize: 18,
              cursor: "pointer",
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <Field label="Name" t={t}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="E.g. Golden Retriever Mafia"
            style={fieldInput(t)}
          />
        </Field>
        <Field label="Ticker" t={t}>
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase().slice(0, 10))}
            placeholder="GRM"
            style={fieldInput(t)}
            maxLength={10}
          />
        </Field>
        <Field label="Chain" t={t}>
          <div style={{ display: "flex", gap: 6 }}>
            {[["near", "NEAR"], ["sol", "Solana"]].map(([v, label]) => {
              const active = chain === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setChain(v)}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 8,
                    border: `1px solid ${active ? t.accent : t.border}`,
                    background: active ? "var(--accent-dim)" : "transparent",
                    color: active ? t.accent : t.textMuted,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </Field>

        {status && (
          <div style={{
            marginTop: 12,
            padding: "8px 10px",
            borderRadius: 8,
            background: "var(--bg-input)",
            color: t.textMuted,
            fontSize: 11,
            lineHeight: 1.4,
          }}>
            {status}
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={busy || !name.trim() || !ticker.trim()}
          style={{
            width: "100%",
            marginTop: 16,
            padding: "12px 16px",
            borderRadius: 8,
            border: "none",
            background: busy ? "var(--bg-input)" : t.accent,
            color: busy ? t.textDim : "#fff",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? "Logging…" : "Continue to Launchpad"}
        </button>
      </div>
    </div>
  );
}

function deriveTicker(text) {
  if (!text) return "";
  const words = text.replace(/[^A-Za-z0-9 ]/g, "").trim().split(/\s+/).slice(0, 3);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0].slice(0, 5).toUpperCase();
  return words.map((w) => w[0]).join("").toUpperCase().slice(0, 5);
}

function fieldInput(t) {
  return {
    width: "100%",
    padding: "8px 12px",
    borderRadius: 8,
    border: `1px solid ${t.border}`,
    background: "var(--bg-input)",
    color: t.text,
    fontSize: 13,
    outline: "none",
    fontFamily: "inherit",
  };
}

function Field({ label, children, t }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{
        display: "block",
        fontSize: 10,
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: t.textDim,
        marginBottom: 4,
      }}>
        {label}
      </span>
      {children}
    </label>
  );
}
