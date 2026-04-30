"use client";
// /onboard — AZUKA Guide concierge web chat.
//
// Free, anonymous-friendly entry point. Visitor doesn't need a wallet
// to chat — but to deploy the recommended Kit they'll need to connect
// one (the wallet header attaches the session to the wallet so /onboard
// resumes on revisit).
//
// Conversation is a deterministic step machine on the backend. Each
// turn returns a structured `question` object with optional clickable
// chips. Free-text input is still accepted on every step that has
// `allow_other: true` (almost all of them).
//
// Brand: matches AZUKA dark aesthetic via tokens.css CSS vars.
// No external chat-UI dependency — the bubble layout is a thin custom
// shell so it slots into the existing app shell without conflicting
// fonts or message-bubble libraries.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Send, ArrowRight, Loader2, RotateCcw, Bot, User } from "lucide-react";
import { useWallet } from "@/lib/contexts";
import { API_BASE } from "@/lib/apiBase";

export default function OnboardPage() {
  const { address: wallet } = useWallet?.() || {};
  const [sessionId, setSessionId]   = useState(null);
  const [messages, setMessages]     = useState([]);
  const [currentQuestion, setQuestion] = useState(null); // { id, text, options, allow_other }
  const [recommendation, setRec]    = useState(null);
  const [status, setStatus]         = useState("idle"); // idle | active | recommended | sending
  const [draft, setDraft]           = useState("");
  const [error, setError]           = useState(null);
  const scrollerRef                 = useRef(null);

  const headers = useMemo(() => {
    const h = { "Content-Type": "application/json" };
    if (wallet) h["x-wallet"] = String(wallet).toLowerCase();
    return h;
  }, [wallet]);

  // Resume an open session if there is one for this wallet, else start fresh.
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        let openSession = null;
        if (wallet) {
          const r = await fetch(`${API_BASE}/api/ironguide/open?channel=web`, { headers });
          if (r.ok) {
            const j = await r.json();
            openSession = j.session;
          }
        }
        if (cancelled) return;
        if (openSession?.id) {
          setSessionId(openSession.id);
          setMessages(Array.isArray(openSession.messages_json) ? openSession.messages_json : []);
          setStatus(openSession.status === "active" ? "active" : "recommended");
          if (openSession.recommended_kit_id) {
            setRec({
              kit_slug: openSession.recommended_kit_id,
              presets:  openSession.recommended_presets_json || {},
            });
          }
          // No question object on the open response — we only have the
          // text in messages_json. Re-fetching the question is a future
          // improvement; for now, still allow free-text input.
          setQuestion(null);
          return;
        }
        // Start fresh
        const r = await fetch(`${API_BASE}/api/ironguide/start`, {
          method: "POST",
          headers,
          body: JSON.stringify({ channel: "web" }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Could not start AZUKA Guide");
        if (cancelled) return;
        setSessionId(j.session.id);
        setMessages(Array.isArray(j.session.messages_json) ? j.session.messages_json : []);
        setQuestion(j.question || null);
        setStatus("active");
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    }
    boot();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);

  // Auto-scroll the conversation to the bottom on each turn.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, recommendation]);

  // Send an answer. `value` is what we POST (e.g. an option id like "ng"
  // or a free-text answer). `displayLabel` is what we render in the
  // optimistic user bubble (e.g. "🇳🇬 Nigeria"); defaults to value.
  const sendAnswer = useCallback(async (value, displayLabel = null) => {
    if (!sessionId || !value || status === "sending") return;
    setStatus("sending");
    // Optimistic user bubble — show the human-readable label, not the id.
    setMessages((m) => [...m, { role: "user", content: displayLabel || value, ts: Date.now() }]);
    try {
      const r = await fetch(`${API_BASE}/api/ironguide/${sessionId}/reply`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: value }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Reply failed");
      // Server returns the canonical messages array — overwrite the
      // optimistic state so we don't drift if it normalised anything.
      if (Array.isArray(j.session?.messages_json)) {
        setMessages(j.session.messages_json);
      } else if (j.question?.text) {
        setMessages((m) => [...m, { role: "assistant", content: j.question.text, ts: Date.now() }]);
      }
      if (j.recommendation && j.recommendation.kit) {
        setRec({
          kit_slug: j.recommendation.kit.slug,
          kit:      j.recommendation.kit,
          presets:  j.recommendation.presets || {},
        });
        setQuestion(null);
        setStatus("recommended");
      } else if (j.session?.status === "recommended") {
        setQuestion(null);
        setStatus("recommended");
      } else {
        setQuestion(j.question || null);
        setStatus("active");
      }
    } catch (e) {
      setError(e.message);
      setStatus("active");
    }
  }, [sessionId, headers, status]);

  const send = useCallback(() => {
    if (!draft.trim()) return;
    const content = draft.trim();
    setDraft("");
    sendAnswer(content);
  }, [draft, sendAnswer]);

  const recommendNow = useCallback(async () => {
    if (!sessionId || status === "sending") return;
    setStatus("sending");
    try {
      const r = await fetch(`${API_BASE}/api/ironguide/${sessionId}/recommend`, {
        method: "POST",
        headers,
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not recommend");
      if (Array.isArray(j.session?.messages_json)) setMessages(j.session.messages_json);
      if (j.recommendation?.kit) {
        setRec({
          kit_slug: j.recommendation.kit.slug,
          kit:      j.recommendation.kit,
          presets:  j.recommendation.presets || {},
        });
      }
      setStatus("recommended");
    } catch (e) {
      setError(e.message);
      setStatus("active");
    }
  }, [sessionId, headers, status]);

  const restart = useCallback(async () => {
    setSessionId(null);
    setMessages([]);
    setQuestion(null);
    setRec(null);
    setStatus("idle");
    setError(null);
    setDraft("");
    try {
      const r = await fetch(`${API_BASE}/api/ironguide/start`, {
        method: "POST",
        headers,
        body: JSON.stringify({ channel: "web" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not restart");
      setSessionId(j.session.id);
      setMessages(Array.isArray(j.session.messages_json) ? j.session.messages_json : []);
      setQuestion(j.question || null);
      setStatus("active");
    } catch (e) {
      setError(e.message);
    }
  }, [headers]);

  const onKey = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }, [send]);

  const deployHref = recommendation?.kit_slug
    ? `/agents/deploy/${encodeURIComponent(recommendation.kit_slug)}?ironguide=${sessionId}`
    : null;

  return (
    <div style={pageStyle}>
      <div style={shellStyle}>
        <header style={headerStyle}>
          <div style={brandStyle}>
            <span style={brandIconStyle}><Sparkles size={14} /></span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-1)" }}>AZUKA Guide</div>
              <div style={{ fontSize: 11, color: "var(--text-2)" }}>Free concierge — finds the right agent in under a minute</div>
            </div>
          </div>
          <button
            type="button"
            onClick={restart}
            disabled={status === "idle"}
            style={ghostButtonStyle}
            title="Start over"
          >
            <RotateCcw size={13} />
            <span>Restart</span>
          </button>
        </header>

        <div ref={scrollerRef} style={scrollerStyle}>
          {messages.map((m, i) => (
            <Bubble key={i} role={m.role} content={m.content} />
          ))}
          {status === "sending" && (
            <Bubble role="assistant" content={<Loader2 size={14} style={{ animation: "ig-spin 0.9s linear infinite" }} />} />
          )}
          {recommendation?.kit_slug && (
            <RecommendationCard rec={recommendation} deployHref={deployHref} />
          )}
        </div>

        {status !== "recommended" && (
          <div style={composerStyle}>
            {/* Chip row — only when the current question has options.
                Picking a chip submits the answer immediately; no draft
                state, no second click. */}
            {currentQuestion?.options?.length > 0 && (
              <ChipRow
                options={currentQuestion.options}
                onPick={(o) => sendAnswer(o.value, o.label)}
                disabled={status === "sending" || !sessionId}
              />
            )}
            {/* Textarea — for free-text steps and "Or type yours" on
                option steps with allow_other. Hide entirely when the
                step is option-only (allow_other = false), so the user
                isn't tempted to type into a text input that'll be
                rejected by canonicalize(). */}
            {(currentQuestion === null || currentQuestion?.allow_other !== false) && (
              <form onSubmit={(e) => { e.preventDefault(); send(); }}>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKey}
                  placeholder={currentQuestion?.options?.length ? "Or type your own answer…" : "Type your answer…"}
                  rows={2}
                  style={textareaStyle}
                  disabled={status === "sending" || !sessionId}
                />
                <div style={composerActionsStyle}>
                  <button
                    type="button"
                    onClick={recommendNow}
                    disabled={status === "sending" || !sessionId || messages.filter((m) => m.role === "user").length === 0}
                    style={ghostButtonStyle}
                    title="Skip ahead and pick a Kit now"
                  >
                    <ArrowRight size={13} />
                    <span>I'm ready, recommend</span>
                  </button>
                  <button
                    type="submit"
                    disabled={!draft.trim() || status === "sending" || !sessionId}
                    style={primaryButtonStyle}
                  >
                    <Send size={13} />
                    <span>Send</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {error && <div style={errorStyle}>{error}</div>}

        <footer style={footerStyle}>
          {wallet
            ? <>Signed in as <code style={codeStyle}>{wallet}</code> — your session resumes on revisit.</>
            : <>Tip: connect a wallet to save your progress and deploy the recommended Kit. <Link href="/skills" style={linkStyle}>Browse Kits manually →</Link></>}
        </footer>
      </div>

      <style jsx global>{`
        @keyframes ig-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function ChipRow({ options, onPick, disabled }) {
  // Wrap chips in a flex row that wraps on narrow screens. Each chip is
  // a button — clicking dispatches the answer immediately (no separate
  // submit). Disabled while a request is in flight so a fast double-tap
  // doesn't double-send.
  return (
    <div style={{
      display: "flex",
      flexWrap: "wrap",
      gap: 8,
      paddingBottom: 8,
    }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onPick(o)}
          disabled={disabled}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            borderRadius: 999,
            border: "1px solid var(--accent-border)",
            background: disabled ? "var(--bg-card)" : "var(--accent-dim)",
            color: "var(--text-1)",
            fontSize: 13,
            fontWeight: 600,
            cursor: disabled ? "not-allowed" : "pointer",
            transition: "background 120ms ease, border-color 120ms ease",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Bubble({ role, content }) {
  const isUser = role === "user";
  return (
    <div style={{
      display:        "flex",
      gap:            10,
      flexDirection:  isUser ? "row-reverse" : "row",
      alignItems:     "flex-start",
    }}>
      <div style={{
        width: 28, height: 28, borderRadius: 9,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: isUser ? "var(--accent-dim)" : "rgba(168, 85, 247, 0.12)",
        color: isUser ? "var(--accent)" : "#a855f7",
        flexShrink: 0,
        border: `1px solid ${isUser ? "var(--accent-border)" : "rgba(168, 85, 247, 0.3)"}`,
      }}>
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>
      <div style={{
        maxWidth: "min(78%, 540px)",
        background: isUser ? "var(--accent-dim)" : "var(--bg-card)",
        border: `1px solid ${isUser ? "var(--accent-border)" : "var(--border)"}`,
        borderRadius: 12,
        padding: "10px 13px",
        fontSize: 13.5,
        lineHeight: 1.55,
        color: "var(--text-1)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}>
        {content}
      </div>
    </div>
  );
}

function RecommendationCard({ rec, deployHref }) {
  const kit = rec.kit;
  return (
    <div style={{
      marginTop: 6,
      padding: 18,
      borderRadius: 14,
      background: "linear-gradient(160deg, rgba(168, 85, 247, 0.14), rgba(96, 165, 250, 0.10) 50%, transparent)",
      border: "1px solid var(--accent-border)",
      boxShadow: "var(--accent-glow)",
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, color: "var(--accent)", textTransform: "uppercase" }}>
        Recommended Kit
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, color: "var(--text-1)", margin: "6px 0 4px" }}>
        {kit?.title || rec.kit_slug}
      </div>
      {kit?.description && (
        <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.55, marginBottom: 12 }}>
          {kit.description}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {deployHref && (
          <Link href={deployHref} style={{
            ...primaryButtonStyle,
            textDecoration: "none",
            display: "inline-flex",
          }}>
            <ArrowRight size={13} />
            <span>Deploy this Kit</span>
          </Link>
        )}
        <Link href="/marketplace/kits" style={{
          ...ghostButtonStyle,
          textDecoration: "none",
          display: "inline-flex",
        }}>
          Browse all Kits
        </Link>
      </div>
    </div>
  );
}

const pageStyle = {
  minHeight: "100vh",
  background: "var(--bg-app)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "32px 16px",
};

const shellStyle = {
  width: "100%",
  maxWidth: 760,
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  borderRadius: 16,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  minHeight: "78vh",
  boxShadow: "0 18px 60px rgba(0, 0, 0, 0.45)",
};

const headerStyle = {
  padding: "16px 20px",
  borderBottom: "1px solid var(--border)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const brandStyle = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const brandIconStyle = {
  width: 32,
  height: 32,
  borderRadius: 10,
  background: "linear-gradient(135deg, #a855f7, #60a5fa)",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 4px 12px rgba(168, 85, 247, 0.35)",
};

const scrollerStyle = {
  flex: 1,
  padding: 20,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  overflowY: "auto",
};

const composerStyle = {
  borderTop: "1px solid var(--border)",
  padding: 14,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const textareaStyle = {
  width: "100%",
  background: "var(--bg-input)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "10px 12px",
  color: "var(--text-1)",
  fontFamily: "inherit",
  fontSize: 13.5,
  resize: "none",
  outline: "none",
};

const composerActionsStyle = {
  display: "flex",
  gap: 8,
  justifyContent: "flex-end",
  alignItems: "center",
  flexWrap: "wrap",
};

const primaryButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "9px 14px",
  borderRadius: 10,
  border: "1px solid var(--accent-border)",
  background: "linear-gradient(135deg, #a855f7, #60a5fa)",
  color: "#fff",
  fontSize: 12.5,
  fontWeight: 700,
  cursor: "pointer",
};

const ghostButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg-card)",
  color: "var(--text-1)",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
};

const errorStyle = {
  padding: "10px 14px",
  margin: "0 14px 12px",
  borderRadius: 8,
  background: "rgba(255, 77, 77, 0.08)",
  border: "1px solid rgba(255, 77, 77, 0.3)",
  color: "var(--red)",
  fontSize: 12,
};

const footerStyle = {
  padding: "12px 20px 18px",
  borderTop: "1px solid var(--border)",
  fontSize: 11.5,
  color: "var(--text-2)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  flexWrap: "wrap",
};

const codeStyle = {
  fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
  fontSize: 11,
  background: "var(--bg-card)",
  padding: "2px 6px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  color: "var(--text-1)",
};

const linkStyle = {
  color: "var(--accent)",
  textDecoration: "none",
  fontWeight: 700,
};
