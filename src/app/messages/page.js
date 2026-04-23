"use client";
// /messages — IronShield DM inbox.
//
// Two-pane layout: conversation list on the left, thread on the right.
// Mobile stacks to one pane at a time (list ↔ thread).
//
// Encryption: messages are end-to-end encrypted with tweetnacl (Curve25519
// + XSalsa20-Poly1305). The viewer's secret key lives in localStorage
// per-wallet (via lib/dmCrypto). The server only stores ciphertext + nonce
// and can't read message bodies. On first visit we register the public
// key via POST /api/profile/dm-pubkey so peers can encrypt to us.
//
// This page intentionally does NOT embed call UI — the existing
// DMCallPanel + callContext in the shell already handles calls from
// anywhere. We just surface a "Call" button per thread that opens the
// same global call flow used by the feed page.

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useTheme, useWallet } from "@/lib/contexts";
import AppShell from "@/components/shell/AppShell";
import {
  Search, ArrowLeft, Send, User, Shield, Loader2, MessageCircle,
  Phone, Plus, X as XIcon, CheckCheck, Info, Bell, BellOff, Pin,
  UserX, Flag, Sparkles, DollarSign, Briefcase, BarChart3, Zap,
  Calendar, Wallet, ExternalLink, Hash, TrendingUp, Check,
  ChevronRight, Star, Trophy, Crown,
} from "lucide-react";
import {
  getOrCreateKeypair, exportPublicKey,
  encrypt as naclEncrypt, decrypt as naclDecrypt,
} from "@/lib/dmCrypto";
import {
  splitBody, detectAutomationIntent, encodeChip,
  CHIP_TYPES, classifyAddress,
} from "@/lib/messageParser";

const API = (() => {
  if (typeof window === "undefined") return "";
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3001";
  return "https://ironclaw-backend.onrender.com";
})();

async function api(path, { method = "GET", wallet, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(wallet ? { "x-wallet": wallet } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j?.error || `${method} ${path} → ${res.status}`);
  }
  return res.json();
}

export default function MessagesPage() {
  const t = useTheme();
  const { address: wallet, showModal } = useWallet();

  const [keypair, setKeypair] = useState(null);
  const [convs, setConvs] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [active, setActive] = useState(null); // { kind, id, peer | group }
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [showThread, setShowThread] = useState(false); // mobile single-pane switch
  const [showContext, setShowContext] = useState(false); // tablet/mobile context toggle
  const [newConvOpen, setNewConvOpen] = useState(false);
  const [peerProfile, setPeerProfile] = useState(null);
  const [peerPrefs, setPeerPrefs] = useState({}); // { [convId]: { mute, pin } }

  // Lazily create the local keypair and publish the public half so
  // anyone who opens our profile can DM us. This no-ops after the first
  // visit on a given device.
  useEffect(() => {
    if (!wallet) return;
    const kp = getOrCreateKeypair(wallet);
    if (!kp) return;
    setKeypair(kp);
    const pub = exportPublicKey(kp);
    if (pub) {
      api("/api/profile/dm-pubkey", { method: "POST", wallet, body: { pubkey: pub } }).catch(() => {});
    }
  }, [wallet]);

  // Load conversation list + groups. Polls every 20s so the inbox
  // freshens without a manual refresh. The list call also ships an
  // `unread` count we surface on the row.
  const loadList = useCallback(async () => {
    if (!wallet) return;
    setLoadingList(true);
    try {
      const [c, g] = await Promise.all([
        api("/api/dm/conversations", { wallet }).catch(() => ({ conversations: [] })),
        api("/api/dm/groups", { wallet }).catch(() => ({ groups: [] })),
      ]);
      setConvs((c.conversations || []).map((x) => ({ ...x, kind: "direct" })));
      setGroups((g.groups || []).map((x) => ({ ...x, kind: "group" })));
    } finally {
      setLoadingList(false);
    }
  }, [wallet]);
  useEffect(() => {
    loadList();
    if (!wallet) return;
    const id = setInterval(loadList, 20_000);
    return () => clearInterval(id);
  }, [loadList, wallet]);

  // Load messages for the active conversation. For direct convs we
  // decrypt with tweetnacl; group chats are plaintext per the backend
  // contract (feed_group_messages.content is NOT encrypted).
  const loadThread = useCallback(async (conv) => {
    if (!wallet || !conv) return;
    setMessagesLoading(true);
    try {
      if (conv.kind === "direct") {
        const r = await api(`/api/dm/${conv.id}/messages`, { wallet });
        // Server returns newest first; reverse for chronological display.
        const ordered = (r.messages || []).slice().reverse();
        setMessages(ordered);
        api(`/api/dm/${conv.id}/read`, { method: "POST", wallet }).catch(() => {});
      } else if (conv.kind === "group") {
        const r = await api(`/api/dm/groups/${conv.id}/messages`, { wallet });
        setMessages(r.messages || []);
      }
    } catch (e) {
      console.warn("loadThread:", e.message);
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  }, [wallet]);

  useEffect(() => {
    if (!active) { setPeerProfile(null); return; }
    loadThread(active);
    // Fetch the richer profile for the context pane. Conversation rows
    // only carry name + pfp + pubkey; the profile endpoint adds bio,
    // account type, follower counts, and the on/off-chain badge
    // signals we need to render the wallet-identity card.
    if (active.kind === "direct" && active.peer?.wallet) {
      api(`/api/profile/${encodeURIComponent(active.peer.wallet)}`)
        .then((j) => setPeerProfile(j?.user || null))
        .catch(() => setPeerProfile(null));
    } else {
      setPeerProfile(null);
    }
  }, [active, loadThread]);

  // Poll the active thread for fresh messages every 8s. Cheap polling
  // keeps this page alive without WebSocket plumbing. When the message
  // volume grows we can swap to SSE without UI changes.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => loadThread(active), 8_000);
    return () => clearInterval(id);
  }, [active, loadThread]);

  // Open a conversation by walletOrUsername (from the "New message" sheet).
  const openWith = useCallback(async (peerWallet) => {
    if (!wallet || !peerWallet) return;
    const r = await api("/api/dm/conversation", {
      method: "POST", wallet, body: { peerWallet },
    });
    const conv = { id: r.conversationId, kind: "direct", peer: r.peer, unread: 0 };
    // Insert at the top of the list if not already there.
    setConvs((prev) => {
      if (prev.some((c) => c.id === conv.id)) return prev;
      return [conv, ...prev];
    });
    setActive(conv);
    setShowThread(true);
    setNewConvOpen(false);
  }, [wallet]);

  const activeKey = active ? `${active.kind}-${active.id}` : null;

  if (!wallet) {
    return (
      <AppShell>
        <div style={{
          maxWidth: 520, margin: "80px auto", padding: 24,
          border: `1px dashed ${t.border}`, borderRadius: 12, textAlign: "center",
        }}>
          <MessageCircle size={28} color={t.accent} style={{ marginBottom: 10 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: t.text, marginBottom: 6 }}>
            Connect a wallet to use Messages
          </div>
          <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 14 }}>
            Your messages are end-to-end encrypted with a key that lives on this device.
          </div>
          <button
            type="button"
            onClick={() => showModal?.()}
            style={{
              padding: "8px 16px", borderRadius: 8, border: "none",
              background: t.accent, color: "#fff", fontWeight: 700, cursor: "pointer",
            }}
          >
            Connect wallet
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="ix-msg-root" style={{ height: "calc(100vh - 140px)", minHeight: 520 }}>
        <div className="ix-msg-grid" data-context-open={showContext ? "true" : "false"}>
          <MessageList
            t={t}
            loading={loadingList}
            convs={convs}
            groups={groups}
            activeKey={activeKey}
            onOpen={(conv) => { setActive(conv); setShowThread(true); setShowContext(false); }}
            onNewConv={() => setNewConvOpen(true)}
            showThread={showThread}
          />
          <Thread
            t={t}
            wallet={wallet}
            keypair={keypair}
            conv={active}
            messages={messages}
            loading={messagesLoading}
            onBack={() => setShowThread(false)}
            onSent={(msg) => setMessages((prev) => [...prev, msg])}
            showThread={showThread}
            onToggleContext={() => setShowContext((v) => !v)}
            contextOpen={showContext}
          />
          {active && (
            <ContextPane
              t={t}
              conv={active}
              profile={peerProfile}
              prefs={peerPrefs[active.id] || {}}
              onPref={(patch) => setPeerPrefs((p) => ({ ...p, [active.id]: { ...(p[active.id] || {}), ...patch } }))}
              onClose={() => setShowContext(false)}
              open={showContext}
            />
          )}
        </div>
      </div>

      {newConvOpen && (
        <NewConversationModal
          t={t}
          wallet={wallet}
          onClose={() => setNewConvOpen(false)}
          onPicked={openWith}
        />
      )}

      <style jsx global>{`
        .ix-msg-grid {
          display: grid;
          grid-template-columns: 300px minmax(0, 1fr);
          height: 100%;
          border: 1px solid var(--border, #1d2540);
          border-radius: 14px;
          overflow: hidden;
          background: var(--bg-card, #0e1324);
        }
        /* 3-column layout kicks in when a conversation is selected and
           the user toggles the context pane open (desktop only). */
        @media (min-width: 1180px) {
          .ix-msg-grid[data-context-open="true"] {
            grid-template-columns: 290px minmax(0, 1fr) 320px;
          }
        }
        @media (max-width: 899px) {
          .ix-msg-root { height: calc(100vh - 120px); min-height: 480px; }
          .ix-msg-grid { grid-template-columns: 1fr; }
          /* Single-pane switching is driven by data-hidden-on-mobile
             attributes on .ix-msg-list and .ix-msg-thread — those rules
             live in Thread's styled-jsx block so they can read the
             component's local state. */
        }

        /* Motion primitives shared across the page. Bubbles slide in
           from below on mount; incoming messages pulse a soft purple
           halo once on arrival. Respect reduced motion. */
        @keyframes ix-bubble-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes ix-bubble-glow {
          0%   { box-shadow: 0 0 0 0 rgba(168,85,247,0); }
          25%  { box-shadow: 0 0 0 6px rgba(168,85,247,0.18); }
          100% { box-shadow: 0 0 0 0 rgba(168,85,247,0); }
        }
        @keyframes ix-typing-dot {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30%           { transform: translateY(-4px); opacity: 1; }
        }
        .ix-msg-bubble { animation: ix-bubble-in 260ms cubic-bezier(0.16, 1, 0.3, 1); }
        .ix-msg-bubble[data-fresh="true"] { animation: ix-bubble-in 260ms cubic-bezier(0.16, 1, 0.3, 1), ix-bubble-glow 1200ms ease-out 240ms; }
        @media (prefers-reduced-motion: reduce) {
          .ix-msg-bubble, .ix-msg-bubble[data-fresh="true"] { animation: none !important; }
          .ix-typing-dot { animation: none !important; }
        }
      `}</style>
    </AppShell>
  );
}

/* ─────────── Conversation list ─────────── */

function MessageList({ t, loading, convs, groups, activeKey, onOpen, onNewConv, showThread }) {
  const [q, setQ] = useState("");
  const items = useMemo(() => {
    const rows = [
      ...convs.map((c) => ({
        kind: "direct", id: c.id, unread: c.unread,
        title: c.peer?.displayName || c.peer?.username || shortAddr(c.peer?.wallet),
        sub:   c.peer?.username ? `@${c.peer.username}` : shortAddr(c.peer?.wallet),
        pfp:   c.peer?.pfpUrl,
        ts:    c.lastMessageAt,
        raw:   c,
      })),
      ...groups.map((g) => ({
        kind: "group", id: g.id, unread: 0,
        title: g.name,
        sub:   g.handle ? `@${g.handle}` : `${g.memberCount} members`,
        pfp:   g.pfpUrl,
        ts:    g.lastMessageAt,
        raw:   g,
      })),
    ];
    rows.sort((a, b) => (b.ts || 0) > (a.ts || 0) ? 1 : -1);
    if (!q.trim()) return rows;
    const s = q.toLowerCase();
    return rows.filter((r) => r.title?.toLowerCase().includes(s) || r.sub?.toLowerCase().includes(s));
  }, [convs, groups, q]);

  return (
    <aside
      className="ix-msg-list"
      data-hidden-on-mobile={showThread ? "true" : "false"}
      style={{
        display: "flex", flexDirection: "column",
        borderRight: `1px solid ${t.border}`,
        minHeight: 0,
        background: "var(--bg-card)",
      }}
    >
      <div style={{
        padding: "12px 14px", display: "flex", alignItems: "center", gap: 10,
        borderBottom: `1px solid ${t.border}`,
      }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: t.white, flex: 1 }}>
          Messages
        </div>
        <button
          type="button"
          onClick={onNewConv}
          title="New message"
          aria-label="New message"
          style={{
            width: 32, height: 32, borderRadius: 8, border: "none",
            background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
            color: "#fff", cursor: "pointer",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 6px 14px rgba(168,85,247,0.3)",
          }}
        >
          <Plus size={15} />
        </button>
      </div>

      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${t.border}` }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "7px 10px", borderRadius: 8,
          border: `1px solid ${t.border}`, background: "var(--bg-input)",
        }}>
          <Search size={13} color={t.textMuted} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search conversations"
            style={{
              flex: 1, border: "none", outline: "none",
              background: "transparent", color: t.text, fontSize: 13, fontFamily: "inherit",
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        {loading && items.length === 0 && (
          <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div className="ix-skel" style={{ width: 38, height: 38, borderRadius: "50%" }} />
                <div style={{ flex: 1 }}>
                  <div className="ix-skel" style={{ width: "60%", height: 12, borderRadius: 4, marginBottom: 6 }} />
                  <div className="ix-skel" style={{ width: "36%", height: 10, borderRadius: 4 }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && items.length === 0 && (
          <div style={{
            padding: 24, textAlign: "center", color: t.textMuted, fontSize: 13,
          }}>
            No conversations yet.<br />
            <button
              type="button"
              onClick={onNewConv}
              style={{
                marginTop: 10, padding: "7px 12px", borderRadius: 8, border: "none",
                background: "var(--accent-dim)", color: t.accent, fontSize: 12, fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Start your first chat
            </button>
          </div>
        )}

        {items.map((row) => {
          const key = `${row.kind}-${row.id}`;
          const isActive = key === activeKey;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onOpen(row.raw)}
              style={{
                width: "100%", textAlign: "left",
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 14px", border: "none",
                background: isActive ? "var(--accent-dim)" : "transparent",
                borderLeft: `2px solid ${isActive ? t.accent : "transparent"}`,
                cursor: "pointer",
                borderBottom: `1px solid rgba(255,255,255,0.03)`,
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-card-hover)"; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
            >
              <div style={{
                width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
                background: row.pfp
                  ? `url("${row.pfp}") center/cover no-repeat`
                  : `linear-gradient(135deg, ${t.accent}, #a855f7)`,
                color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, fontWeight: 800,
              }}>
                {!row.pfp && (row.title?.[0]?.toUpperCase() || "?")}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 700, color: t.white,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {row.title || "anon"}
                  {row.kind === "group" && (
                    <span style={{
                      marginLeft: 6, fontSize: 9, fontWeight: 800,
                      padding: "1px 5px", borderRadius: 4,
                      background: "rgba(59,130,246,0.15)", color: "#60a5fa",
                      letterSpacing: 0.4,
                    }}>GROUP</span>
                  )}
                </div>
                <div style={{
                  fontSize: 11, color: t.textDim,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {row.sub}
                </div>
              </div>
              {row.unread > 0 && (
                <span style={{
                  minWidth: 18, height: 18, padding: "0 6px", borderRadius: 999,
                  background: "linear-gradient(135deg, #ef4444, #f97316)",
                  color: "#fff", fontSize: 10, fontWeight: 800,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}>{row.unread}</span>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

/* ─────────── Thread view ─────────── */

function Thread({ t, wallet, keypair, conv, messages, loading, onBack, onSent, showThread, onToggleContext, contextOpen }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState(null);
  const [actionOpen, setActionOpen] = useState(false);
  const scrollRef = useRef(null);
  // Track which message ids were already on screen so only *new*
  // arrivals get the fresh-glow halo.
  const seenIdsRef = useRef(new Set());
  const [freshIds, setFreshIds] = useState(() => new Set());

  // Auto-scroll to newest message whenever the list grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages?.length, conv?.id]);

  // Diff message ids to mark which ones are new *this render*. First
  // render of a thread: mark nothing fresh (avoid a full-list flash);
  // subsequent renders: anything we haven't seen is fresh for ~1.2s.
  useEffect(() => {
    if (!conv) return;
    const incoming = new Set(messages.map((m) => m.id ?? `tmp-${m.created_at || ""}`));
    if (seenIdsRef.current.size === 0) {
      seenIdsRef.current = incoming;
      return;
    }
    const fresh = new Set();
    for (const id of incoming) {
      if (!seenIdsRef.current.has(id)) fresh.add(id);
    }
    if (fresh.size) {
      setFreshIds(fresh);
      const to = setTimeout(() => setFreshIds(new Set()), 1400);
      seenIdsRef.current = incoming;
      return () => clearTimeout(to);
    }
    seenIdsRef.current = incoming;
  }, [messages, conv?.id]);

  // Reset per-thread state when the conversation changes.
  useEffect(() => {
    seenIdsRef.current = new Set();
    setFreshIds(new Set());
    setActionOpen(false);
  }, [conv?.id]);

  // Natural-language automation intent. Runs on every input change so
  // the suggestion chip appears/disappears as the phrase is typed. We
  // only show it if the thread is a direct chat (group chat automations
  // would need more auth plumbing; out of scope).
  const automationIntent = useMemo(() => {
    if (!text || conv?.kind !== "direct") return null;
    return detectAutomationIntent(text);
  }, [text, conv?.kind]);

  // Low-level send that takes an explicit body (text or body-with-chip).
  // Used by both the plain send button and the Smart Action sheet.
  const sendRaw = useCallback(async (body) => {
    if (!body.trim() || !conv || !wallet || sending) return;
    setSending(true);
    setErr(null);
    try {
      if (conv.kind === "direct") {
        if (!keypair) throw new Error("Local key not ready — try again in a second");
        if (!conv.peer?.dmPubkey) {
          throw new Error("Recipient hasn't registered a DM key yet. They need to open Messages once.");
        }
        const enc = naclEncrypt(body, conv.peer.dmPubkey, keypair);
        const r = await api("/api/dm/send", {
          method: "POST", wallet,
          body: {
            conversationId: conv.id,
            encryptedPayload: enc.encryptedPayload,
            nonce: enc.nonce,
          },
        });
        onSent?.({
          ...r.message,
          _decrypted: body,
          from_id: r.message.from_id,
        });
      } else if (conv.kind === "group") {
        const r = await api(`/api/dm/groups/${conv.id}/send`, {
          method: "POST", wallet, body: { content: body },
        });
        onSent?.(r.message);
      }
    } catch (e) {
      setErr(e.message || "Send failed");
      throw e;
    } finally {
      setSending(false);
    }
  }, [conv, wallet, keypair, sending, onSent]);

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body) return;
    try { await sendRaw(body); setText(""); } catch { /* handled above */ }
  }, [text, sendRaw]);

  // Attach a structured chip (token send, portfolio share, etc.) by
  // appending the encoded token to whatever's in the composer. If the
  // input was empty, we send the chip by itself — the receiver renders
  // it as a rich card and plain text is skipped.
  const insertChip = useCallback(async (type, data, prefixText = "") => {
    const chip = encodeChip(type, data);
    const body = (prefixText ? `${prefixText}\n` : "") + chip;
    setActionOpen(false);
    try {
      await sendRaw(body);
      if (text.trim()) setText(""); // also clears any draft
    } catch { /* handled */ }
  }, [sendRaw, text]);

  if (!conv) {
    return (
      <section
        className="ix-msg-thread"
        data-hidden-on-mobile={showThread ? "false" : "true"}
        style={{
          flex: 1, minWidth: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column", gap: 10, padding: 30,
          background: "var(--bg-app)",
        }}
      >
        <MessageCircle size={36} color={t.textMuted} />
        <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>
          Select a conversation
        </div>
        <div style={{ fontSize: 12, color: t.textMuted, textAlign: "center", maxWidth: 320 }}>
          Pick a chat on the left, or tap + to start a new one.
        </div>
      </section>
    );
  }

  const peerName = conv.kind === "direct"
    ? (conv.peer?.displayName || conv.peer?.username || shortAddr(conv.peer?.wallet))
    : (conv.name || `Group ${conv.id}`);
  const peerSub = conv.kind === "direct"
    ? (conv.peer?.username ? `@${conv.peer.username}` : shortAddr(conv.peer?.wallet))
    : (conv.memberCount ? `${conv.memberCount} members` : "Group chat");

  return (
    <section
      className="ix-msg-thread"
      data-hidden-on-mobile={showThread ? "false" : "true"}
      style={{
        display: "flex", flexDirection: "column",
        minWidth: 0, minHeight: 0, flex: 1,
        background: "var(--bg-app)",
      }}
    >
      <header style={{
        height: 56, flexShrink: 0,
        display: "flex", alignItems: "center", gap: 10,
        padding: "0 14px", borderBottom: `1px solid ${t.border}`,
        background: "var(--bg-card)",
      }}>
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="ix-msg-back"
          style={{
            width: 32, height: 32, borderRadius: 8,
            border: `1px solid ${t.border}`, background: "transparent",
            color: t.textMuted, cursor: "pointer",
            display: "none", alignItems: "center", justifyContent: "center",
          }}
        >
          <ArrowLeft size={15} />
        </button>
        <div style={{
          width: 36, height: 36, borderRadius: "50%",
          background: conv.peer?.pfpUrl || conv.pfpUrl
            ? `url("${conv.peer?.pfpUrl || conv.pfpUrl}") center/cover no-repeat`
            : `linear-gradient(135deg, ${t.accent}, #a855f7)`,
          color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, fontWeight: 800, flexShrink: 0,
        }}>
          {!(conv.peer?.pfpUrl || conv.pfpUrl) && (peerName?.[0]?.toUpperCase() || "?")}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 14, fontWeight: 800, color: t.white,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {peerName}
          </div>
          <div style={{ fontSize: 11, color: t.textDim, display: "flex", alignItems: "center", gap: 6 }}>
            {conv.kind === "direct" && <Shield size={10} color="#10b981" />}
            {conv.kind === "direct" ? "End-to-end encrypted · " : ""}{peerSub}
          </div>
        </div>

        {/* Header actions — voice placeholder + info/context toggle.
            The phone icon is intentionally here so the motion pattern
            matches the reference screenshot, but the actual call
            handshake lives in the global callContext (out of scope for
            Tier-1 — wired up under feature flag later). */}
        <button
          type="button"
          title="Voice call — coming soon"
          aria-label="Voice call"
          disabled
          style={iconHeaderBtn(t, { disabled: true })}
        >
          <Phone size={15} />
        </button>
        <button
          type="button"
          onClick={onToggleContext}
          title={contextOpen ? "Hide details" : "Show details"}
          aria-label="Toggle details"
          aria-pressed={contextOpen}
          style={iconHeaderBtn(t, { active: contextOpen })}
        >
          <Info size={15} />
        </button>
      </header>

      <div
        ref={scrollRef}
        style={{
          flex: 1, overflowY: "auto", padding: "14px 14px 10px",
          display: "flex", flexDirection: "column", gap: 6,
          minHeight: 0,
        }}
      >
        {loading && messages.length === 0 && (
          <div style={{ textAlign: "center", padding: 24, color: t.textMuted, fontSize: 12 }}>
            <Loader2 size={16} className="ic-spin" /> Loading…
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div style={{
            textAlign: "center", padding: 24, color: t.textMuted, fontSize: 12,
            margin: "auto 0",
          }}>
            No messages yet. Say hi!
          </div>
        )}

        {messages.map((m) => {
          const key = m.id ?? `tmp-${m.created_at || ""}`;
          return (
            <MessageBubble
              key={key} m={m} t={t} wallet={wallet} conv={conv} keypair={keypair}
              fresh={freshIds.has(key)}
            />
          );
        })}
      </div>

      {/* Automation suggestion chip — fires when the composer text
          matches a trade intent. One tap routes to /automations with
          the parsed side/symbol/threshold prefilled. */}
      {automationIntent && (
        <AutomationSuggest
          t={t}
          intent={automationIntent}
          onDismiss={() => { /* dismiss just by editing the text */ }}
          onAccept={() => {
            insertChip(CHIP_TYPES.AUTOMATION, {
              side: automationIntent.side,
              symbol: automationIntent.symbol,
              op: automationIntent.op,
              threshold: automationIntent.threshold,
              summary: automationIntent.summary,
            }, text.replace(automationIntent.phrase, "").trim());
            setText("");
          }}
        />
      )}

      {err && (
        <div style={{
          padding: "8px 14px", background: "rgba(239,68,68,0.08)",
          color: "var(--red)", fontSize: 12, borderTop: "1px solid var(--red)",
        }}>
          {err}
        </div>
      )}

      {/* Smart action sheet — slides in above the composer when + is
          tapped. Each card inserts a structured chip into the thread. */}
      {actionOpen && (
        <SmartActionSheet
          t={t}
          wallet={wallet}
          onClose={() => setActionOpen(false)}
          onAction={(type, data) => insertChip(type, data)}
        />
      )}

      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        style={{
          flexShrink: 0,
          display: "flex", alignItems: "flex-end", gap: 8,
          padding: 12, borderTop: `1px solid ${t.border}`,
          background: "var(--bg-card)",
        }}
      >
        <button
          type="button"
          onClick={() => setActionOpen((v) => !v)}
          aria-label="Attach or act"
          aria-pressed={actionOpen}
          title="Smart actions"
          style={{
            width: 40, height: 40, borderRadius: 10,
            border: `1px solid ${actionOpen ? t.accent : t.border}`,
            background: actionOpen ? "var(--accent-dim)" : "var(--bg-input)",
            color: actionOpen ? t.accent : t.textMuted,
            cursor: "pointer", display: "inline-flex",
            alignItems: "center", justifyContent: "center", flexShrink: 0,
            transition: "border-color 140ms ease, background 140ms ease, transform 160ms ease",
            transform: actionOpen ? "rotate(45deg)" : "rotate(0deg)",
          }}
        >
          <Plus size={16} />
        </button>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 4000))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder={conv.kind === "direct" ? "Encrypted message…" : "Message the group…"}
          rows={1}
          style={{
            flex: 1, resize: "none", maxHeight: 160,
            padding: "10px 12px", borderRadius: 10,
            border: `1px solid ${t.border}`, background: "var(--bg-input)",
            color: t.text, fontSize: 14, fontFamily: "inherit", outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          aria-label="Send"
          style={{
            width: 40, height: 40, borderRadius: 10, border: "none",
            background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
            color: "#fff", cursor: sending ? "wait" : "pointer",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            opacity: sending || !text.trim() ? 0.5 : 1,
            boxShadow: "0 6px 14px rgba(168,85,247,0.3)",
            flexShrink: 0,
          }}
        >
          {sending ? <Loader2 size={14} className="ic-spin" /> : <Send size={14} />}
        </button>
      </form>

      <style jsx global>{`
        /* Context pane: docked on desktop, overlay on tablet/mobile. */
        @media (min-width: 1180px) {
          .ix-msg-context { position: static; width: auto; }
        }
        @media (max-width: 1179px) {
          .ix-msg-context {
            position: absolute;
            top: 0; right: 0; bottom: 0;
            width: min(92vw, 340px);
            transform: translateX(100%);
            transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
            z-index: 5;
            box-shadow: -14px 0 38px rgba(0,0,0,0.35);
          }
          .ix-msg-context[data-open="true"] { transform: translateX(0); }
        }
        .ix-msg-root { position: relative; }
        .ix-msg-grid { position: relative; }

        @media (max-width: 899px) {
          .ix-msg-list[data-hidden-on-mobile="true"]   { display: none; }
          .ix-msg-thread[data-hidden-on-mobile="true"] { display: none; }
          .ix-msg-back { display: inline-flex !important; }
        }
        @keyframes ic-spin { to { transform: rotate(360deg); } }
        .ic-spin { animation: ic-spin 800ms linear infinite; }

        @keyframes ix-skel-shimmer-msg {
          0%   { background-position: -400px 0; }
          100% { background-position:  400px 0; }
        }
        .ix-skel {
          background: linear-gradient(
            90deg,
            rgba(255,255,255,0.04) 0%,
            rgba(255,255,255,0.08) 50%,
            rgba(255,255,255,0.04) 100%
          );
          background-size: 800px 100%;
          animation: ix-skel-shimmer-msg 1.4s linear infinite;
        }
      `}</style>
    </section>
  );
}

function MessageBubble({ m, t, wallet, conv, keypair, fresh }) {
  const isMine = conv.kind === "group"
    ? (m.from_wallet && wallet && m.from_wallet.toLowerCase() === wallet.toLowerCase())
    : (m._decrypted ? true : (conv.peer?.id != null ? m.from_id !== conv.peer.id : false));

  let body = m._decrypted || "";
  if (!body) {
    if (conv.kind === "direct") {
      if (keypair && conv.peer?.dmPubkey && m.encrypted_payload && m.nonce) {
        body = naclDecrypt(m.encrypted_payload, m.nonce, conv.peer.dmPubkey, keypair) || "[unable to decrypt]";
      } else {
        body = "[encrypted]";
      }
    } else {
      body = m.content || "";
    }
  }

  // Parse the body into segments so chip tokens render as rich cards
  // and plain URLs/addresses become inline entity pills. A bubble can
  // hold any mix of text + entity + chip segments.
  const segs = useMemo(() => splitBody(body), [body]);
  const hasOnlyChips = segs.length && segs.every((s) => s.kind === "chip");

  // When a bubble is JUST a chip, skip the gradient wrapper and let
  // the chip card own its own styling — keeps the thread airy.
  const wrapperStyle = hasOnlyChips ? {
    background: "transparent", padding: 0, border: "none", boxShadow: "none",
  } : {
    background: isMine
      ? `linear-gradient(135deg, ${t.accent}, #a855f7)`
      : "var(--bg-card)",
    color: isMine ? "#fff" : t.text,
    border: isMine ? "none" : `1px solid ${t.border}`,
    boxShadow: isMine ? "0 4px 10px rgba(168,85,247,0.25)" : "none",
  };

  return (
    <div style={{
      display: "flex",
      justifyContent: isMine ? "flex-end" : "flex-start",
      paddingLeft: isMine ? 40 : 0,
      paddingRight: isMine ? 0 : 40,
    }}>
      <div
        className="ix-msg-bubble"
        data-fresh={fresh && !isMine ? "true" : "false"}
        style={{
          maxWidth: "100%",
          padding: hasOnlyChips ? 0 : "9px 12px",
          borderRadius: 14,
          fontSize: 14, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word",
          ...wrapperStyle,
        }}
      >
        {conv.kind === "group" && !isMine && !hasOnlyChips && (
          <div style={{
            fontSize: 10, fontWeight: 800, letterSpacing: 0.3,
            color: t.accent, marginBottom: 3, opacity: 0.8,
          }}>
            {m.from_display || shortAddr(m.from_wallet)}
          </div>
        )}
        <BodySegments segs={segs} t={t} isMine={isMine} />
        {!hasOnlyChips && (
          <div style={{
            fontSize: 10, opacity: 0.7, marginTop: 4,
            display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 3,
          }}>
            {formatTime(m.created_at)}
            {isMine && m.read_at && <CheckCheck size={10} />}
          </div>
        )}
      </div>
    </div>
  );
}

function BodySegments({ segs, t, isMine }) {
  if (!segs.length) return null;
  return (
    <>
      {segs.map((s, i) => {
        if (s.kind === "text") return <span key={i}>{s.text}</span>;
        if (s.kind === "entity") return <EntityPill key={i} e={s.entity} t={t} inverted={isMine} />;
        if (s.kind === "chip") return <AttachmentCard key={i} chip={s} t={t} />;
        return null;
      })}
    </>
  );
}

function EntityPill({ e, t, inverted }) {
  // Inline rich mention for URLs / addresses / tx-hashes / @handles.
  // Renders as a subtly-tinted pill that links out to an explorer or
  // keeps users on-app for handles. Icons match the parser's type.
  const { type, raw } = e;
  let icon = <Hash size={10} />;
  let label = raw;
  let href = null;
  let chain = null;
  if (type === "url") { icon = <ExternalLink size={10} />; href = raw; }
  else if (type === "evm_addr") {
    chain = "evm"; icon = <Wallet size={10} />;
    label = `${raw.slice(0, 6)}…${raw.slice(-4)}`;
    href = `https://etherscan.io/address/${raw}`;
  }
  else if (type === "near_account") {
    chain = "near"; icon = <Wallet size={10} />;
    label = raw;
    href = `https://nearblocks.io/address/${raw}`;
  }
  else if (type === "tx_hash") {
    chain = classifyAddress(raw) === "solana" ? "solana" : "near";
    icon = <Zap size={10} />;
    label = `${raw.slice(0, 6)}…${raw.slice(-4)} · tx`;
    href = chain === "solana"
      ? `https://solscan.io/tx/${raw}`
      : `https://nearblocks.io/txns/${raw}`;
  }
  else if (type === "mention") {
    icon = <User size={10} />;
    href = `/profile?username=${encodeURIComponent(raw.slice(1))}`;
  }
  const accent = inverted ? "rgba(255,255,255,0.92)" : "#60a5fa";
  const bg     = inverted ? "rgba(255,255,255,0.14)" : "rgba(96,165,250,0.08)";
  const border = inverted ? "rgba(255,255,255,0.25)" : "rgba(96,165,250,0.35)";
  const pill = (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "1px 7px", borderRadius: 6,
      background: bg, color: accent,
      border: `1px solid ${border}`,
      fontSize: 12, fontWeight: 600, verticalAlign: "baseline",
    }}>
      {icon}{label}
    </span>
  );
  if (!href) return pill;
  return (
    <a href={href} target={href.startsWith("http") ? "_blank" : undefined}
       rel={href.startsWith("http") ? "noreferrer" : undefined}
       style={{ textDecoration: "none" }}>
      {pill}
    </a>
  );
}

function AttachmentCard({ chip, t }) {
  const { type, data } = chip;
  const card = {
    display: "block", textDecoration: "none", color: "inherit",
    padding: 12, borderRadius: 12,
    border: `1px solid ${t.border}`,
    background: "linear-gradient(180deg, rgba(168,85,247,0.06), transparent 60%), var(--bg-card)",
    boxShadow: "0 6px 14px rgba(0,0,0,0.25)",
    minWidth: 240, maxWidth: 340,
  };
  if (type === CHIP_TYPES.AUTOMATION) {
    return (
      <a href={`/automations?draft=${encodeURIComponent(JSON.stringify(data))}`} style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={chipIcon("#a855f7")}><Zap size={14} /></span>
          <span style={chipTitle}>Automation plan</span>
          <span style={chipBadge("#a855f7")}>TRADE</span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.white, marginBottom: 4 }}>
          {data.summary || `${(data.side || "").toUpperCase()} ${data.symbol}`}
        </div>
        <div style={{ fontSize: 11, color: t.textDim }}>
          Tap to review and deploy on IronShield Automations
        </div>
      </a>
    );
  }
  if (type === CHIP_TYPES.TOKEN_SEND) {
    return (
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={chipIcon("#10b981")}><DollarSign size={14} /></span>
          <span style={chipTitle}>Token transfer</span>
          <span style={chipBadge("#10b981")}>SEND</span>
        </div>
        <div style={{ fontSize: 17, fontWeight: 800, color: t.white, letterSpacing: -0.2 }}>
          {data.amount} {data.symbol || "NEAR"}
        </div>
        <div style={{ fontSize: 11, color: t.textDim, marginTop: 2 }}>
          to <strong style={{ color: t.text }}>{data.to || "peer"}</strong> · {data.chain || "NEAR"}
        </div>
        {data.note && (
          <div style={{ fontSize: 12, color: t.textMuted, marginTop: 6, fontStyle: "italic" }}>
            "{data.note}"
          </div>
        )}
      </div>
    );
  }
  if (type === CHIP_TYPES.PORTFOLIO) {
    return (
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={chipIcon("#60a5fa")}><Briefcase size={14} /></span>
          <span style={chipTitle}>Portfolio snapshot</span>
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: t.white }}>
          ${Number(data.total || 0).toLocaleString()}
        </div>
        <div style={{ fontSize: 11, color: "#10b981", marginTop: 2, fontWeight: 700 }}>
          {data.change24h != null ? `${data.change24h > 0 ? "+" : ""}${data.change24h}% · 24h` : "24h change"}
        </div>
        <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
          {(data.holdings || []).slice(0, 4).map((h, i) => (
            <span key={i} style={{
              fontSize: 10, padding: "2px 6px", borderRadius: 4,
              background: "var(--bg-input)", color: t.textMuted, fontWeight: 600,
            }}>{h.symbol} {h.pct}%</span>
          ))}
        </div>
      </div>
    );
  }
  if (type === CHIP_TYPES.CHART) {
    return (
      <a href={`/trading?token=${encodeURIComponent(data.symbol || "")}`} style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={chipIcon("#3b82f6")}><BarChart3 size={14} /></span>
          <span style={chipTitle}>Chart</span>
          <span style={chipBadge("#3b82f6")}>{(data.symbol || "?").toUpperCase()}</span>
        </div>
        <div style={{ fontSize: 17, fontWeight: 800, color: t.white }}>
          ${Number(data.price || 0).toLocaleString()}
        </div>
        <div style={{
          fontSize: 11, fontWeight: 700,
          color: Number(data.change24h) >= 0 ? "#10b981" : "#ef4444",
          marginTop: 2,
        }}>
          {data.change24h != null ? `${data.change24h > 0 ? "+" : ""}${data.change24h}% · 24h` : ""}
        </div>
      </a>
    );
  }
  if (type === CHIP_TYPES.WALLET_SHARE) {
    return (
      <a href={`/profile?address=${encodeURIComponent(data.address || "")}`} style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={chipIcon("#f59e0b")}><Wallet size={14} /></span>
          <span style={chipTitle}>Wallet</span>
          <span style={chipBadge("#f59e0b")}>{(data.chain || "near").toUpperCase()}</span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.white, wordBreak: "break-all" }}>
          {data.address}
        </div>
      </a>
    );
  }
  if (type === CHIP_TYPES.REMINDER) {
    const when = data.when ? new Date(data.when) : null;
    return (
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={chipIcon("#f97316")}><Calendar size={14} /></span>
          <span style={chipTitle}>Reminder</span>
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.white, marginBottom: 4 }}>
          {data.label || "Scheduled"}
        </div>
        <div style={{ fontSize: 11, color: t.textDim }}>
          {when ? when.toLocaleString() : "Time not set"}
        </div>
      </div>
    );
  }
  // Unknown chip type — render a debug pill rather than crash.
  return (
    <div style={{ ...card, opacity: 0.7 }}>
      <div style={{ fontSize: 11, color: t.textMuted }}>Unsupported card: {type}</div>
    </div>
  );
}

const chipIcon = (color) => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 28, height: 28, borderRadius: 8,
  background: `${color}1e`, color,
  border: `1px solid ${color}55`,
});
const chipTitle = {
  fontSize: 11, fontWeight: 800, letterSpacing: 0.4,
  color: "var(--text-muted, #9aa4bd)", textTransform: "uppercase",
};
const chipBadge = (color) => ({
  marginLeft: "auto",
  fontSize: 9, fontWeight: 800, letterSpacing: 0.6,
  padding: "2px 6px", borderRadius: 4,
  background: `${color}22`, color,
  textTransform: "uppercase",
});

function iconHeaderBtn(t, { active = false, disabled = false } = {}) {
  return {
    width: 34, height: 34, borderRadius: 8, flexShrink: 0,
    border: `1px solid ${active ? t.accent : t.border}`,
    background: active ? "var(--accent-dim)" : "transparent",
    color: active ? t.accent : (disabled ? t.textDim : t.textMuted),
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    transition: "border-color 140ms ease, background 140ms ease",
  };
}

/* ─────────── Smart action sheet ─────────── */

function SmartActionSheet({ t, wallet, onClose, onAction }) {
  const ACTIONS = [
    { key: "send",     Icon: DollarSign, color: "#10b981", label: "Send token",       hint: "Transfer NEAR or tokens" },
    { key: "chart",    Icon: BarChart3,  color: "#3b82f6", label: "Share chart",      hint: "Live price + 24h" },
    { key: "port",     Icon: Briefcase,  color: "#60a5fa", label: "Share portfolio",  hint: "Your holdings snapshot" },
    { key: "auto",     Icon: Zap,        color: "#a855f7", label: "Create automation",hint: "If/when trade rule" },
    { key: "wallet",   Icon: Wallet,     color: "#f59e0b", label: "Share wallet",     hint: "Your address" },
    { key: "remind",   Icon: Calendar,   color: "#f97316", label: "Schedule reminder",hint: "Ping later" },
  ];
  const onPick = (key) => {
    if (key === "send") {
      const amount = window.prompt("Amount to send:");
      if (!amount) return;
      const symbol = window.prompt("Token symbol (default NEAR):", "NEAR") || "NEAR";
      onAction(CHIP_TYPES.TOKEN_SEND, {
        amount, symbol, chain: "NEAR", to: "peer",
      });
    } else if (key === "wallet") {
      onAction(CHIP_TYPES.WALLET_SHARE, { address: wallet, chain: "NEAR" });
    } else if (key === "port") {
      // Placeholder snapshot — real impl will pull from portfolioStore.
      onAction(CHIP_TYPES.PORTFOLIO, {
        total: 0, change24h: 0, holdings: [],
      });
    } else if (key === "chart") {
      const symbol = window.prompt("Ticker to share (e.g. BTC, ETH, SOL):", "BTC");
      if (!symbol) return;
      onAction(CHIP_TYPES.CHART, { symbol: symbol.toUpperCase(), price: null, change24h: null });
    } else if (key === "auto") {
      const summary = window.prompt("Describe the trigger (e.g. 'buy BTC when price breaks 110k'):");
      if (!summary) return;
      onAction(CHIP_TYPES.AUTOMATION, { summary });
    } else if (key === "remind") {
      const label = window.prompt("Remind me to…");
      if (!label) return;
      const whenStr = window.prompt("When? (e.g. 2026-05-01 17:00):");
      onAction(CHIP_TYPES.REMINDER, {
        label,
        when: whenStr ? new Date(whenStr).toISOString() : null,
      });
    }
  };

  return (
    <div
      style={{
        flexShrink: 0, borderTop: `1px solid ${t.border}`,
        background: "var(--bg-card)", padding: 12,
        animation: "ix-sheet-up 200ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <div style={{
        display: "flex", alignItems: "center", gap: 6, marginBottom: 10,
      }}>
        <Sparkles size={13} color="#c084fc" />
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, color: t.textMuted, textTransform: "uppercase" }}>
          Smart actions
        </div>
        <div style={{ flex: 1 }} />
        <button
          type="button" onClick={onClose} aria-label="Close"
          style={{
            width: 26, height: 26, borderRadius: 6, border: "none",
            background: "transparent", color: t.textMuted, cursor: "pointer",
          }}
        ><XIcon size={13} /></button>
      </div>
      <div style={{
        display: "grid", gap: 8,
        gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
      }}>
        {ACTIONS.map((a) => (
          <button
            key={a.key}
            type="button"
            onClick={() => onPick(a.key)}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: 10, borderRadius: 10,
              border: `1px solid ${t.border}`, background: "var(--bg-input)",
              color: t.text, fontSize: 13, fontFamily: "inherit",
              cursor: "pointer", textAlign: "left",
              transition: "border-color 140ms ease, transform 140ms ease, background 140ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${a.color}66`; e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.transform = "translateY(0)"; }}
          >
            <span style={chipIcon(a.color)}><a.Icon size={14} /></span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.white }}>{a.label}</div>
              <div style={{ fontSize: 10, color: t.textDim }}>{a.hint}</div>
            </div>
          </button>
        ))}
      </div>
      <style jsx global>{`
        @keyframes ix-sheet-up {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

/* ─────────── NL automation suggestion chip ─────────── */

function AutomationSuggest({ t, intent, onAccept, onDismiss }) {
  return (
    <div
      role="status"
      style={{
        display: "flex", alignItems: "center", gap: 10,
        margin: "0 12px 8px", padding: "8px 12px",
        borderRadius: 10,
        border: `1px solid rgba(168,85,247,0.4)`,
        background: "linear-gradient(180deg, rgba(168,85,247,0.1), transparent 65%), var(--bg-card)",
        animation: "ix-sheet-up 180ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <span style={chipIcon("#a855f7")}><Zap size={13} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, letterSpacing: 0.4, color: "#c084fc", fontWeight: 800, textTransform: "uppercase" }}>
          Looks like a trade rule
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: t.white, marginTop: 1 }}>
          {intent.summary}
        </div>
      </div>
      <button
        type="button" onClick={onAccept}
        style={{
          padding: "6px 12px", borderRadius: 8, border: "none",
          background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
          color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
          boxShadow: "0 4px 10px rgba(168,85,247,0.3)",
          whiteSpace: "nowrap",
        }}
      >
        Create automation
      </button>
    </div>
  );
}

/* ─────────── Context pane (right sidebar) ─────────── */

function ContextPane({ t, conv, profile, prefs, onPref, onClose, open }) {
  // Derive badges from what the profile endpoint gives us. This is the
  // "wallet identity layer" surface — the badges here are the ones we
  // can support today without schema changes; richer signals (whale
  // via on-chain balance, governance participation) come when those
  // pipelines ship. Each badge carries a color + icon + tooltip.
  const badges = useMemo(() => {
    const out = [];
    if (profile?.verified) out.push({ key: "verified", label: "Verified", color: "#60a5fa", Icon: Check });
    if (profile?.accountType === "pro" || profile?.accountType === "ironshield_pro") {
      out.push({ key: "pro", label: "IronShield Pro", color: "#a855f7", Icon: Crown });
    }
    if ((profile?.followers ?? 0) >= 500) {
      out.push({ key: "whale", label: "Top Trader", color: "#10b981", Icon: TrendingUp });
    }
    if ((profile?.posts ?? 0) >= 25) {
      out.push({ key: "creator", label: "Creator", color: "#f97316", Icon: Star });
    }
    if (profile?.accountType === "og") {
      out.push({ key: "og", label: "OG Member", color: "#f59e0b", Icon: Trophy });
    }
    return out;
  }, [profile]);

  // Direct conversations show the peer card; group conversations show
  // the group card (out of scope for Tier-1 — we render a minimal
  // placeholder so toggling the pane in a group doesn't blank out).
  if (conv.kind !== "direct") {
    return (
      <aside
        className="ix-msg-context"
        data-open={open ? "true" : "false"}
        style={contextShell(t, open)}
      >
        <ContextHeader t={t} title="Group details" onClose={onClose} />
        <div style={{ padding: 18, color: t.textMuted, fontSize: 13, textAlign: "center" }}>
          Group context pane coming soon.
        </div>
      </aside>
    );
  }

  const peer = profile || {};
  const displayName = peer.displayName || conv.peer?.displayName || conv.peer?.username || shortAddr(conv.peer?.wallet);
  const handle = peer.username || conv.peer?.username;
  const pfpUrl = peer.pfpUrl || conv.peer?.pfpUrl;
  const short = shortAddr(peer.walletAddress || conv.peer?.wallet);

  return (
    <aside
      className="ix-msg-context"
      data-open={open ? "true" : "false"}
      style={contextShell(t, open)}
    >
      <ContextHeader t={t} title="Details" onClose={onClose} />

      <div style={{ padding: "20px 16px", textAlign: "center", borderBottom: `1px solid ${t.border}` }}>
        <div style={{
          width: 80, height: 80, borderRadius: "50%",
          margin: "0 auto 10px",
          background: pfpUrl ? `url("${pfpUrl}") center/cover no-repeat` : `linear-gradient(135deg, ${t.accent}, #a855f7)`,
          color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 28, fontWeight: 800,
          boxShadow: "0 14px 34px rgba(168,85,247,0.25)",
          border: `2px solid ${t.border}`,
        }}>
          {!pfpUrl && (displayName?.[0]?.toUpperCase() || "?")}
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: t.white }}>{displayName}</div>
          {peer.verified && <Check size={13} color="#60a5fa" strokeWidth={3} />}
        </div>
        {handle && (
          <div style={{ fontSize: 12, color: t.textDim, marginTop: 2 }}>@{handle}</div>
        )}
        {peer.bio && (
          <div style={{ fontSize: 13, color: t.textMuted, marginTop: 10, lineHeight: 1.45 }}>
            {peer.bio}
          </div>
        )}

        {badges.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", marginTop: 12 }}>
            {badges.map((b) => (
              <span key={b.key} title={b.label} style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "3px 9px", borderRadius: 999,
                background: `${b.color}1e`, color: b.color,
                border: `1px solid ${b.color}44`,
                fontSize: 11, fontWeight: 700,
              }}>
                <b.Icon size={11} />{b.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Stats */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
        borderBottom: `1px solid ${t.border}`,
      }}>
        <Stat t={t} n={peer.followers ?? 0} l="Followers" />
        <Stat t={t} n={peer.following ?? 0} l="Following" />
        <Stat t={t} n={peer.posts ?? 0} l="Posts" />
      </div>

      {/* Identity row */}
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${t.border}` }}>
        <SectionLabel t={t}>Wallet</SectionLabel>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "8px 10px", borderRadius: 8,
          border: `1px solid ${t.border}`, background: "var(--bg-input)",
        }}>
          <Wallet size={13} color={t.accent} />
          <span style={{ flex: 1, fontSize: 12, fontFamily: "var(--font-jetbrains-mono), monospace", color: t.text }}>
            {short}
          </span>
          <a
            href={`https://nearblocks.io/address/${encodeURIComponent(peer.walletAddress || conv.peer?.wallet || "")}`}
            target="_blank" rel="noreferrer"
            title="View on NEARBlocks"
            style={{ color: t.textMuted, display: "inline-flex", alignItems: "center" }}
          >
            <ExternalLink size={12} />
          </a>
        </div>
      </div>

      {/* Options */}
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${t.border}` }}>
        <SectionLabel t={t}>Options</SectionLabel>
        <PaneToggle
          t={t}
          Icon={prefs.muted ? BellOff : Bell}
          label="Mute notifications"
          on={!!prefs.muted}
          onToggle={() => onPref?.({ muted: !prefs.muted })}
        />
        <PaneToggle
          t={t}
          Icon={Pin}
          label="Pin conversation"
          on={!!prefs.pinned}
          onToggle={() => onPref?.({ pinned: !prefs.pinned })}
        />
        <PaneButton t={t} Icon={UserX} color="#ef4444" label="Block user" />
        <PaneButton t={t} Icon={Flag}   color="#ef4444" label="Report user" />
      </div>

      {/* Quick link to profile */}
      <div style={{ padding: "12px 16px" }}>
        <a
          href={`/profile?address=${encodeURIComponent(peer.walletAddress || conv.peer?.wallet || "")}`}
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "10px 12px", borderRadius: 8,
            border: `1px solid ${t.border}`, background: "transparent",
            color: t.text, fontSize: 13, textDecoration: "none",
          }}
        >
          <User size={13} />
          View full profile
          <ChevronRight size={13} style={{ marginLeft: "auto", opacity: 0.6 }} />
        </a>
      </div>
    </aside>
  );
}

function ContextHeader({ t, title, onClose }) {
  return (
    <header style={{
      height: 56, flexShrink: 0,
      display: "flex", alignItems: "center", gap: 10,
      padding: "0 14px", borderBottom: `1px solid ${t.border}`,
      background: "var(--bg-card)",
    }}>
      <div style={{ fontSize: 14, fontWeight: 800, flex: 1, color: t.white }}>{title}</div>
      <button
        type="button" onClick={onClose} aria-label="Close"
        style={{
          width: 30, height: 30, borderRadius: 6, border: "none",
          background: "transparent", color: t.textMuted, cursor: "pointer",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}
      ><XIcon size={14} /></button>
    </header>
  );
}

function contextShell(t, open) {
  return {
    display: "flex", flexDirection: "column",
    minHeight: 0, overflowY: "auto",
    background: "var(--bg-card)",
    borderLeft: `1px solid ${t.border}`,
  };
}

function Stat({ t, n, l }) {
  return (
    <div style={{ padding: "12px 6px", textAlign: "center", borderRight: `1px solid ${t.border}` }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: t.white, fontFamily: "var(--font-jetbrains-mono), monospace" }}>
        {typeof n === "number" ? n.toLocaleString() : n}
      </div>
      <div style={{ fontSize: 10, color: t.textDim, letterSpacing: 0.4, marginTop: 2 }}>{l}</div>
    </div>
  );
}

function SectionLabel({ t, children }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 800, letterSpacing: 0.6,
      color: t.textDim, textTransform: "uppercase", marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

function PaneToggle({ t, Icon, label, on, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 10,
        padding: "8px 4px", border: "none", background: "transparent",
        color: t.text, cursor: "pointer", textAlign: "left",
      }}
    >
      <Icon size={14} color={t.textMuted} />
      <span style={{ flex: 1, fontSize: 13 }}>{label}</span>
      <span
        aria-hidden
        style={{
          width: 30, height: 18, borderRadius: 999,
          background: on ? t.accent : "var(--bg-input)",
          border: `1px solid ${on ? t.accent : t.border}`,
          position: "relative",
          transition: "background 160ms ease, border-color 160ms ease",
        }}
      >
        <span style={{
          position: "absolute", top: 1, left: on ? 13 : 1,
          width: 14, height: 14, borderRadius: "50%",
          background: "#fff",
          transition: "left 160ms ease",
        }} />
      </span>
    </button>
  );
}

function PaneButton({ t, Icon, label, color }) {
  return (
    <button
      type="button"
      style={{
        width: "100%", display: "flex", alignItems: "center", gap: 10,
        padding: "8px 4px", border: "none", background: "transparent",
        color: color || t.text, cursor: "pointer", textAlign: "left",
        fontSize: 13,
      }}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

/* ─────────── New conversation modal ─────────── */

function NewConversationModal({ t, wallet, onClose, onPicked }) {
  const [q, setQ] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const search = useCallback(async () => {
    const s = q.trim();
    if (!s) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api(`/api/dm/search?q=${encodeURIComponent(s)}`, { wallet });
      setResult(r);
      if (!r.user) setErr("No user found with that handle or wallet.");
    } catch (e) {
      setErr(e.message || "Search failed");
    } finally {
      setBusy(false);
    }
  }, [q, wallet]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(100vw, 440px)",
          borderRadius: 14, overflow: "hidden",
          border: `1px solid ${t.border}`, background: "var(--bg-card)",
        }}
      >
        <header style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 16px", borderBottom: `1px solid ${t.border}`,
        }}>
          <div style={{ fontSize: 15, fontWeight: 800, flex: 1, color: t.white }}>
            New message
          </div>
          <button
            type="button" onClick={onClose} aria-label="Close"
            style={{
              width: 30, height: 30, borderRadius: 6, border: "none",
              background: "transparent", color: t.textMuted, cursor: "pointer",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}
          ><XIcon size={14} /></button>
        </header>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12, color: t.textDim }}>
            Enter a NEAR account (<code>foo.near</code>) or @username to start an
            end-to-end encrypted chat.
          </div>

          <form onSubmit={(e) => { e.preventDefault(); search(); }} style={{ display: "flex", gap: 8 }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="foo.near or @handle"
              autoFocus
              style={{
                flex: 1, padding: "9px 12px", borderRadius: 8,
                border: `1px solid ${t.border}`, background: "var(--bg-input)",
                color: t.text, fontSize: 14, fontFamily: "inherit", outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={busy || !q.trim()}
              style={{
                padding: "9px 14px", borderRadius: 8, border: "none",
                background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
                color: "#fff", fontSize: 13, fontWeight: 700, cursor: busy ? "wait" : "pointer",
                opacity: busy || !q.trim() ? 0.5 : 1,
              }}
            >
              Search
            </button>
          </form>

          {err && (
            <div style={{
              padding: "8px 10px", borderRadius: 8,
              background: "rgba(239,68,68,0.08)", border: "1px solid var(--red)",
              color: "var(--red)", fontSize: 12,
            }}>{err}</div>
          )}

          {result?.user && (
            <div style={{
              padding: 12, borderRadius: 10,
              border: `1px solid ${t.border}`, background: "var(--bg-input)",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: "50%",
                background: result.user.pfp_url
                  ? `url("${result.user.pfp_url}") center/cover no-repeat`
                  : `linear-gradient(135deg, ${t.accent}, #a855f7)`,
                color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 14, fontWeight: 800, flexShrink: 0,
              }}>
                {!result.user.pfp_url && ((result.user.display_name || result.user.username || "?")[0]?.toUpperCase())}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.white }}>
                  {result.user.display_name || result.user.username || shortAddr(result.user.wallet_address)}
                </div>
                <div style={{ fontSize: 11, color: t.textDim }}>
                  {shortAddr(result.user.wallet_address)}
                </div>
                {!result.user.dm_pubkey && (
                  <div style={{ fontSize: 10, color: "var(--amber)", marginTop: 3 }}>
                    Hasn't opened Messages yet — they need to sign in once to receive encrypted DMs.
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onPicked(result.user.wallet_address)}
                style={{
                  padding: "7px 12px", borderRadius: 8, border: "none",
                  background: t.accent, color: "#fff",
                  fontSize: 12, fontWeight: 700, cursor: "pointer",
                }}
              >
                Message
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────── utils ─────────── */

function shortAddr(a) {
  if (!a) return "anon";
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function formatTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch { return ""; }
}
