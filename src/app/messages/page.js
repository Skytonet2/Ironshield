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
  ChevronRight, Star, Trophy, Crown, Video, MoreHorizontal,
  Image as ImageIcon, Smile, AtSign, CornerUpLeft,
} from "lucide-react";
import {
  getOrCreateKeypair, exportPublicKey,
  encrypt as naclEncrypt, decrypt as naclDecrypt,
  getKeypairByFp, fingerprint as keyFingerprint,
  generateAttachmentKey, encryptAttachmentBytes, decryptAttachmentBytes,
  attachmentKeyToBase64, attachmentNonceToBase64,
  getCachedGroupKey, cacheGroupKey, unwrapGroupKey, decryptGroup, encryptGroup,
} from "@/lib/dmCrypto";
import {
  splitBody, detectAutomationIntent, encodeChip,
  CHIP_TYPES, classifyAddress,
} from "@/lib/messageParser";
import { apiFetch } from "@/lib/apiFetch";
import * as wsClient from "@/lib/ws/wsClient";

const API = (() => {
  if (typeof window === "undefined") return "";
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3001";
  return "https://ironclaw-backend.onrender.com";
})();

async function api(path, { method = "GET", wallet, body } = {}) {
  // GETs still rely on the legacy x-wallet header for personalization;
  // mutating calls go through apiFetch which signs them via NEP-413.
  const isGet = (method || "GET").toUpperCase() === "GET";
  const headers = {
    "Content-Type": "application/json",
    ...(isGet && wallet ? { "x-wallet": wallet } : {}),
  };
  const opts = { method, headers, body: body ? JSON.stringify(body) : undefined };
  const res = isGet ? await fetch(`${API}${path}`, opts) : await apiFetch(path, opts);
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
  // Peer presence for the active DM, kept separate from `active` so a
  // WS event doesn't have to clone the whole conv object. Merged into
  // the conv prop at render time. null → unknown (initial fetch
  // pending or non-DM); { online, lastSeenAt } once resolved.
  const [peerPresence, setPeerPresence] = useState(null);
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

  // Day 8.2: subscribe to dm:state events. The server emits these to the
  // sender when their messages flip to delivered (recipient socket got
  // the dm:new push) or read (recipient called /read). We patch the
  // local `messages` array in place so the bubble's tick rerenders
  // without a full thread refetch.
  useEffect(() => {
    if (!wallet) return;
    const off = wsClient.addListener("dm:state", (event) => {
      const ids = event?.messageIds;
      if (!Array.isArray(ids) || !ids.length) return;
      const stamp = event.at || new Date().toISOString();
      const field = event.state === "read" ? "read_at" : "delivered_at";
      setMessages((prev) => {
        let changed = false;
        const next = prev.map((m) => {
          if (!ids.includes(m.id)) return m;
          if (m[field]) return m;
          changed = true;
          // Read implies delivered — backfill the lower state for free
          // so a bubble that goes straight from sent to read still has
          // a coherent timeline.
          return event.state === "read" && !m.delivered_at
            ? { ...m, read_at: stamp, delivered_at: m.delivered_at || stamp }
            : { ...m, [field]: stamp };
        });
        return changed ? next : prev;
      });
    });
    return () => { off(); };
  }, [wallet]);

  // Peer presence: REST fetch on conversation open + live WS updates.
  // Only direct DMs have a peer with a wallet; group threads skip the
  // whole flow. The fetch covers initial state (peer was online before
  // we opened the page); the WS listener handles 0↔1 transitions
  // emitted by feedHub on auth/disconnect.
  useEffect(() => {
    const peerWallet = active?.kind === "direct" ? active.peer?.wallet : null;
    if (!peerWallet) { setPeerPresence(null); return; }
    let cancelled = false;
    api(`/api/users/presence?wallet=${encodeURIComponent(peerWallet)}`)
      .then((j) => {
        if (cancelled) return;
        setPeerPresence({ online: !!j?.online, lastSeenAt: j?.lastSeenAt || null });
      })
      .catch(() => { if (!cancelled) setPeerPresence(null); });
    return () => { cancelled = true; };
  }, [active?.kind, active?.peer?.wallet]);

  useEffect(() => {
    const peerWallet = active?.kind === "direct" ? active.peer?.wallet?.toLowerCase() : null;
    if (!peerWallet) return;
    const off = wsClient.addListener("presence:update", (event) => {
      if (!event?.wallet || event.wallet.toLowerCase() !== peerWallet) return;
      setPeerPresence({
        online: !!event.online,
        lastSeenAt: event.lastSeenAt || (event.online ? null : new Date().toISOString()),
      });
    });
    return () => { off(); };
  }, [active?.kind, active?.peer?.wallet]);
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
            conv={
              active && active.peer && peerPresence
                ? { ...active, peer: { ...active.peer, online: peerPresence.online, lastSeenAt: peerPresence.lastSeenAt } }
                : active
            }
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
          /* Row template is load-bearing. Without \`minmax(0, 1fr)\` the
             implicit row auto-sizes to content, so when a thread is
             short (few messages) the row collapses and the composer
             floats in the middle of the viewport with a giant empty
             band below it. The minmax floor at 0 also lets the scroll
             area shrink below its intrinsic content size instead of
             blowing out the row. */
          grid-template-rows: minmax(0, 1fr);
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

        /* Composer drag handle: thin hairline that thickens on hover
           so users find the grab target without cluttering the chrome
           at rest. The inner bar gets the accent when the user is
           actively dragging. */
        .ix-msg-composer-handle:hover > div,
        .ix-msg-composer-handle:active > div {
          height: 3px !important;
          background: var(--accent, #a855f7) !important;
          opacity: 0.55;
        }
      `}</style>
    </AppShell>
  );
}

/* ─────────── Conversation list ─────────── */

function MessageList({ t, loading, convs, groups, activeKey, onOpen, onNewConv, showThread }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all"); // all | unread | groups | mentions
  const rowsAll = useMemo(() => {
    const rows = [
      ...convs.map((c) => ({
        kind: "direct", id: c.id, unread: c.unread,
        title: c.peer?.displayName || c.peer?.username || shortAddr(c.peer?.wallet),
        sub:   c.peer?.username ? `@${c.peer.username}` : shortAddr(c.peer?.wallet),
        pfp:   c.peer?.pfpUrl,
        ts:    c.lastMessageAt,
        muted: !!c.muted,
        verified: c.peer?.verified,
        online: c.peer?.online,
        raw:   c,
      })),
      ...groups.map((g) => ({
        kind: "group", id: g.id, unread: 0,
        title: g.name,
        sub:   g.handle ? `@${g.handle}` : `${g.memberCount} members`,
        pfp:   g.pfpUrl,
        ts:    g.lastMessageAt,
        muted: !!g.muted,
        verified: false,
        raw:   g,
      })),
    ];
    rows.sort((a, b) => (b.ts || 0) > (a.ts || 0) ? 1 : -1);
    return rows;
  }, [convs, groups]);

  const unreadTotal = useMemo(
    () => rowsAll.reduce((n, r) => n + (r.unread || 0), 0),
    [rowsAll]
  );
  const groupCount = useMemo(
    () => rowsAll.filter((r) => r.kind === "group").length,
    [rowsAll]
  );

  const items = useMemo(() => {
    let rows = rowsAll;
    if (filter === "unread")   rows = rows.filter((r) => (r.unread || 0) > 0);
    if (filter === "groups")   rows = rows.filter((r) => r.kind === "group");
    if (filter === "mentions") rows = rows.filter((r) => r.hasMention); // reserved for future flag
    if (!q.trim()) return rows;
    const s = q.toLowerCase();
    return rows.filter((r) => r.title?.toLowerCase().includes(s) || r.sub?.toLowerCase().includes(s));
  }, [rowsAll, filter, q]);

  const FILTERS = [
    { key: "all",      label: "All" },
    { key: "unread",   label: "Unread",   count: unreadTotal || 0 },
    { key: "groups",   label: "Groups",   count: groupCount || 0 },
    { key: "mentions", label: "Mentions" },
  ];

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
        padding: "14px 16px 10px", display: "flex", alignItems: "center", gap: 10,
      }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: t.white, flex: 1, letterSpacing: -0.4 }}>
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

      {/* Filter tabs — All · Unread (n) · Groups (n) · Mentions. The
          counts update live from rowsAll; the Mentions filter is
          reserved for a future `hasMention` flag on conversation rows. */}
      <div style={{
        display: "flex", gap: 4, padding: "0 12px 8px",
        overflowX: "auto",
      }}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 999,
                border: "none",
                background: active ? "var(--accent-dim)" : "transparent",
                color: active ? t.accent : t.textMuted,
                fontSize: 12, fontWeight: 600,
                cursor: "pointer", whiteSpace: "nowrap",
                transition: "background 120ms ease, color 120ms ease",
              }}
            >
              {f.label}
              {f.count > 0 && (
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  minWidth: 16, height: 16, padding: "0 5px",
                  borderRadius: 999,
                  background: active ? t.accent : "var(--bg-input)",
                  color: active ? "#fff" : t.textMuted,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}>{f.count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div style={{ padding: "0 12px 10px", borderBottom: `1px solid ${t.border}` }}>
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
                display: "flex", alignItems: "flex-start", gap: 10,
                padding: "12px 16px", border: "none",
                background: isActive ? "var(--accent-dim)" : "transparent",
                borderLeft: `2px solid ${isActive ? t.accent : "transparent"}`,
                cursor: "pointer",
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-card-hover)"; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
            >
              <div style={{ position: "relative", flexShrink: 0 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: "50%",
                  background: row.pfp
                    ? `url("${row.pfp}") center/cover no-repeat`
                    : `linear-gradient(135deg, ${t.accent}, #a855f7)`,
                  color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 14, fontWeight: 800,
                }}>
                  {!row.pfp && (row.title?.[0]?.toUpperCase() || "?")}
                </div>
                {row.kind === "group" && (
                  <span style={{
                    position: "absolute", bottom: -2, right: -2,
                    width: 16, height: 16, borderRadius: "50%",
                    background: "rgba(59,130,246,0.2)",
                    border: `2px solid ${isActive ? "var(--accent-dim)" : "var(--bg-card)"}`,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="3">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  </span>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                  <span style={{
                    fontSize: 13, fontWeight: 700, color: t.white,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0,
                  }}>
                    {row.title || "anon"}
                  </span>
                  {row.verified && <Check size={11} color="#60a5fa" strokeWidth={3} style={{ flexShrink: 0 }} />}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 11, color: t.textDim, flexShrink: 0 }}>
                    {shortTime(row.ts)}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{
                    flex: 1,
                    fontSize: 12, color: t.textDim,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0,
                  }}>
                    {row.sub}
                  </span>
                  {row.muted && <BellOff size={11} color={t.textDim} style={{ flexShrink: 0 }} />}
                  {row.unread > 0 && (
                    <span style={{
                      minWidth: 18, height: 18, padding: "0 6px", borderRadius: 999,
                      background: "linear-gradient(135deg, #a855f7, #6d28d9)",
                      color: "#fff", fontSize: 10, fontWeight: 800,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                    }}>{row.unread}</span>
                  )}
                </div>
              </div>
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
  // Group-only: the specific message the user is quoting/replying to.
  // Cleared after send. Direct DMs don't support reply_to in the
  // schema yet — groups got it first because threaded discussion in
  // groups is the higher-value ask.
  const [replyingTo, setReplyingTo] = useState(null);
  const scrollRef = useRef(null);
  // Day 8.4: hidden file input that the 📎 button triggers. Drives
  // upload-then-send for image attachments. Direct DMs only — group
  // chats don't go through the encrypted /send path.
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  // v1.1.1 — symmetric key for the active E2E group, base64. Loaded
  // on thread switch from cache → server-fetch+unwrap → null. Null
  // means messages with encrypted_content render the "[no group key]"
  // placeholder; the bubble respects that.
  const [activeGroupKey, setActiveGroupKey] = useState(null);
  useEffect(() => {
    setActiveGroupKey(null);
    if (!conv || conv.kind !== "group" || !conv.e2eEnabled || !wallet || !keypair) return;
    let cancelled = false;
    (async () => {
      const cached = getCachedGroupKey(wallet, conv.id);
      if (cached) { setActiveGroupKey(cached); return; }
      try {
        const r = await api(`/api/dm/groups/${conv.id}/key`, { wallet });
        if (cancelled) return;
        if (!r?.wrappedKey) return;
        const sym = unwrapGroupKey(keypair, r.wrappedKey, r.wrapNonce, r.wrappedByPubkey);
        if (sym) {
          cacheGroupKey(wallet, conv.id, sym);
          setActiveGroupKey(sym);
        }
      } catch { /* leave null — bubbles render the placeholder */ }
    })();
    return () => { cancelled = true; };
  }, [conv?.id, conv?.kind, conv?.e2eEnabled, wallet, keypair]);

  // Composer height — user-resizable via the drag handle that sits on
  // the top border of the composer form. 56px matches the baked-in
  // single-row height the form had before; we clamp to 44–400 so the
  // send button always has room and the thread doesn't disappear
  // behind a giant input. Persist in sessionStorage so switching
  // conversations in the same tab keeps the user's chosen height.
  const [composerH, setComposerH] = useState(() => {
    if (typeof window === "undefined") return 56;
    const saved = Number(sessionStorage.getItem("ironshield:composerH"));
    return Number.isFinite(saved) && saved >= 44 ? Math.min(saved, 400) : 56;
  });
  useEffect(() => {
    try { sessionStorage.setItem("ironshield:composerH", String(composerH)); } catch {}
  }, [composerH]);
  const composerDragRef = useRef(null);
  const onComposerHandleDown = useCallback((e) => {
    // Only primary-button drags; ignore middle/right clicks.
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = composerH;
    let dragging = true;
    const onMove = (ev) => {
      if (!dragging) return;
      // Pointer moves up → deltaY negative → composer grows.
      const delta = startY - ev.clientY;
      const next = Math.max(44, Math.min(400, startH + delta));
      setComposerH(next);
    };
    const onUp = () => {
      dragging = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    // Lock the cursor + block text selection while dragging — without
    // these the pointer flickers between ns-resize and the default
    // arrow any time the user drags past a non-resize region.
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  }, [composerH]);
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
            senderKeyFp: enc.senderKeyFp,
            recipientKeyFp: enc.recipientKeyFp,
            formatVersion: enc.formatVersion,
          },
        });
        onSent?.({
          ...r.message,
          _decrypted: body,
          from_id: r.message.from_id,
        });
      } else if (conv.kind === "group") {
        const replyToId = replyingTo?.id || null;
        // v1.1.1 — E2E groups go through encryptGroup with the cached
        // symmetric key. Plaintext groups keep the existing path. The
        // server enforces the same branching from its side, so a
        // plaintext send to an e2e group fails fast with a clear error.
        let payload;
        if (conv.e2eEnabled) {
          if (!activeGroupKey) {
            throw new Error("Group key not loaded yet. Wait a moment or reopen the thread.");
          }
          const enc = encryptGroup(body, activeGroupKey, keypair);
          payload = {
            encryptedContent: enc.encryptedContent,
            nonce: enc.nonce,
            senderKeyFp: enc.senderKeyFp,
            ...(replyToId ? { replyToId } : {}),
          };
        } else {
          payload = { content: body, ...(replyToId ? { replyToId } : {}) };
        }
        const r = await api(`/api/dm/groups/${conv.id}/send`, {
          method: "POST", wallet,
          body: payload,
        });
        // Synthesize the quoted-preview fields the render path expects
        // so the just-sent bubble shows its quote without waiting for
        // the next refetch. The backend SELECT will populate these
        // naturally on reload.
        const baseMsg = conv.e2eEnabled
          ? { ...r.message, _decrypted: body } // skip re-decrypt on render
          : r.message;
        const hydrated = replyToId ? {
          ...baseMsg,
          reply_to_id:      replyToId,
          reply_to_content: replyingTo.content,
          reply_to_display: replyingTo.from_display,
          reply_to_wallet:  replyingTo.from_wallet,
        } : baseMsg;
        onSent?.(hydrated);
        setReplyingTo(null);
      }
    } catch (e) {
      setErr(e.message || "Send failed");
      throw e;
    } finally {
      setSending(false);
    }
  }, [conv, wallet, keypair, sending, onSent, replyingTo, activeGroupKey]);

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body) return;
    try { await sendRaw(body); setText(""); } catch { /* handled above */ }
  }, [text, sendRaw]);

  // v1.1.5 — image attachment for direct DMs with full byte encryption.
  //
  // Day 8.4 only encrypted the URL — the bytes sat at a public host
  // unencrypted, so anyone with the URL could fetch the image. Now
  // the sender mints a per-message symmetric key + nonce, encrypts
  // the file bytes via nacl.secretbox before upload, and embeds the
  // symmetric key in the dmCrypto-encrypted message body so only the
  // recipient can recover it.
  //
  // Server side: /api/media/upload?encrypted=1 skips the magic-byte
  // MIME check + sharp/EXIF strip (the bytes are opaque ciphertext)
  // but keeps the size cap, daily quota, and host cascade.
  //
  // Recipient flow lives in MessageBubble: detects attachKey on the
  // decrypted body, fetches ciphertext, decrypts to a Blob, renders
  // via blob URL. Backwards compat with Day 8.4: bodies without
  // attachKey still render as a plain <img src={url}>.
  const onAttachImage = useCallback(async (file) => {
    if (!file || conv?.kind !== "direct" || uploading || sending) return;
    setUploading(true);
    setErr(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const { key, nonce } = generateAttachmentKey();
      const ciphertext = encryptAttachmentBytes(buf, key, nonce);
      const blob = new Blob([ciphertext], { type: "application/octet-stream" });
      const fd = new FormData();
      fd.append("file", blob, "ciphertext.bin");
      const resp = await apiFetch(`/api/media/upload?encrypted=1`, { method: "POST", body: fd });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        // 413 (too big), 429 (quota) bubble up the server's `error`
        // string; show inline in the composer.
        throw new Error(data?.error || `upload failed (${resp.status})`);
      }
      const payload = JSON.stringify({
        url: data.url,
        mime: file.type || "image/*",
        attachKey:   attachmentKeyToBase64(key),
        attachNonce: attachmentNonceToBase64(nonce),
      });
      await sendRaw(payload);
    } catch (e) {
      setErr(e.message || "upload failed");
    } finally {
      setUploading(false);
    }
  }, [conv, uploading, sending, sendRaw]);

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
        <div style={{ position: "relative", flexShrink: 0 }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%",
            background: conv.peer?.pfpUrl || conv.pfpUrl
              ? `url("${conv.peer?.pfpUrl || conv.pfpUrl}") center/cover no-repeat`
              : `linear-gradient(135deg, ${t.accent}, #a855f7)`,
            color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, fontWeight: 800,
          }}>
            {!(conv.peer?.pfpUrl || conv.pfpUrl) && (peerName?.[0]?.toUpperCase() || "?")}
          </div>
          {conv.peer?.online && (
            <span style={{
              position: "absolute", bottom: -1, right: -1,
              width: 12, height: 12, borderRadius: "50%",
              background: "#10b981",
              border: `2px solid var(--bg-card)`,
            }} aria-label="Online" />
          )}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 14, fontWeight: 800, color: t.white,
            display: "flex", alignItems: "center", gap: 4,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{peerName}</span>
            {conv.peer?.verified && <Check size={12} color="#60a5fa" strokeWidth={3} />}
          </div>
          <div style={{ fontSize: 11, color: t.textDim, display: "flex", alignItems: "center", gap: 6 }}>
            {conv.peer?.online ? (
              <>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
                Online
              </>
            ) : conv.peer?.lastSeenAt ? (
              <>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.textDim }} />
                Active {shortTime(conv.peer.lastSeenAt)} ago
              </>
            ) : conv.kind === "direct" ? (
              <>
                <Shield size={10} color="#10b981" />
                End-to-end encrypted · {peerSub}
              </>
            ) : (
              peerSub
            )}
          </div>
        </div>

        {/* Header actions — voice + video placeholders, then info / kebab.
            Both call buttons hook into the global callContext when the
            LiveKit room flow is wired up; for now they're disabled
            placeholders so the layout matches the reference. */}
        <button type="button" title="Voice call — coming soon" aria-label="Voice call"
          disabled className="ix-msg-header-voice" style={iconHeaderBtn(t, { disabled: true })}
        >
          <Phone size={15} />
        </button>
        <button type="button" title="Video call — coming soon" aria-label="Video call"
          disabled className="ix-msg-header-video" style={iconHeaderBtn(t, { disabled: true })}
        >
          <Video size={15} />
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
        <button
          type="button"
          title="More actions — coming soon"
          aria-label="More actions"
          disabled
          style={iconHeaderBtn(t, { disabled: true })}
        >
          <MoreHorizontal size={15} />
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

        {/* Render messages interleaved with date dividers and an
            "N unread messages" separator at the first unread boundary.
            Groups use m.from_wallet for ownership; direct DMs rely on
            m.from_id !== peer.id. Both shapes go through the helper
            buildSeparators below to pick the correct flag. */}
        {(() => {
          const segs = buildSeparators(messages, conv, wallet);
          return segs.map((seg) => {
            if (seg.kind === "date-divider") {
              return (
                <div
                  key={`date-${seg.label}-${seg.at}`}
                  style={{
                    textAlign: "center",
                    padding: "12px 0 4px",
                    fontSize: 11, color: t.textDim, letterSpacing: 0.6,
                    textTransform: "uppercase", fontWeight: 600,
                  }}
                >
                  {seg.label}
                </div>
              );
            }
            if (seg.kind === "unread-divider") {
              return (
                <div
                  key={`unread-${seg.count}`}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 0",
                  }}
                >
                  <span style={{ flex: 1, height: 1, background: "rgba(168,85,247,0.25)" }} />
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: "#c084fc",
                    letterSpacing: 0.4,
                  }}>
                    {seg.count} unread message{seg.count > 1 ? "s" : ""}
                  </span>
                  <span style={{ flex: 1, height: 1, background: "rgba(168,85,247,0.25)" }} />
                </div>
              );
            }
            const key = seg.m.id ?? `tmp-${seg.m.created_at || ""}`;
            return (
              <MessageBubble
                key={key} m={seg.m} t={t} wallet={wallet} conv={conv} keypair={keypair}
                groupKey={activeGroupKey}
                fresh={freshIds.has(key)}
                onReply={conv.kind === "group" ? () => setReplyingTo(seg.m) : null}
              />
            );
          });
        })()}
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

      {/* Reply preview bar — only when user tapped Reply on a group
          message. Shows who they're replying to + a truncated preview
          + a dismiss X. Rendered ABOVE the drag handle so it lives
          in the composer zone, not inside the scroll area. */}
      {replyingTo && (
        <div style={{
          flexShrink: 0,
          display: "flex", alignItems: "center", gap: 10,
          padding: "8px 12px",
          borderTop: `1px solid ${t.border}`,
          background: "var(--bg-surface)",
        }}>
          <div style={{
            width: 3, alignSelf: "stretch", borderRadius: 2,
            background: t.accent, flexShrink: 0,
          }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: t.accent, letterSpacing: 0.3 }}>
              Replying to {replyingTo.from_display || shortAddr(replyingTo.from_wallet)}
            </div>
            <div style={{
              fontSize: 12, color: t.textDim,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {(replyingTo.content || "").slice(0, 140).replace(/\s+/g, " ")}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setReplyingTo(null)}
            aria-label="Cancel reply"
            style={{
              width: 24, height: 24, borderRadius: 999, border: "none",
              background: "transparent", color: t.textDim, cursor: "pointer",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <XIcon size={12} />
          </button>
        </div>
      )}

      {/* Draggable divider between the thread scroller and the
          composer. The actual grab area is 10px tall (bigger hit
          target) but only a 1px line is painted; the hairline thickens
          on hover + drag so the affordance is visible without noise
          at rest. touch-action: none keeps finger-drag from hijacking
          the thread scroll on phones. */}
      <div
        ref={composerDragRef}
        className="ix-msg-composer-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize composer"
        title="Drag to resize"
        onPointerDown={onComposerHandleDown}
        style={{
          flexShrink: 0,
          height: 10,
          margin: 0,
          cursor: "ns-resize",
          touchAction: "none",
          position: "relative",
          background: "transparent",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 0, right: 0, top: "50%",
            height: 1,
            transform: "translateY(-0.5px)",
            background: t.border,
            transition: "background 120ms ease, height 120ms ease",
          }}
        />
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        style={{
          flexShrink: 0,
          display: "flex",
          // At the default height we want controls vertically centered
          // like the old layout; once the user enlarges the composer
          // we stretch so the pill + textarea fill the new space.
          alignItems: composerH > 64 ? "stretch" : "center",
          gap: 8,
          padding: 12,
          minHeight: composerH,
          background: "var(--bg-card)",
        }}
      >
        {/* Composer actions — match the reference: round + button that
            expands the smart-action sheet (Send token, Share chart,
            etc.), inline quick-icons for Image / Chart / Emoji that
            call straight into those actions without opening the sheet.
            Input is pill-shaped; send is the gradient circle at the
            right end. */}
        <button
          type="button"
          onClick={() => setActionOpen((v) => !v)}
          aria-label="Smart actions"
          aria-pressed={actionOpen}
          title="Smart actions"
          style={composerIconBtn(t, actionOpen)}
        >
          <Plus
            size={16}
            style={{ transition: "transform 160ms ease", transform: actionOpen ? "rotate(45deg)" : "none" }}
          />
        </button>
        {/* Secondary quick-icons — hidden on phones so the input pill
            gets breathing room. Every action is still reachable via the
            + sheet, and desktop has plenty of horizontal space for all
            four. The .ix-msg-quick class is toggled by the block at
            the bottom of Thread. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            // Reset the value so picking the same file twice in a row
            // still fires onChange. The async upload is fire-and-forget
            // from this handler's perspective.
            e.target.value = "";
            if (f) onAttachImage(f);
          }}
        />
        <button
          type="button"
          onClick={() => {
            if (conv?.kind !== "direct") {
              setErr("Image attachments are direct-DM only for now.");
              return;
            }
            fileInputRef.current?.click();
          }}
          disabled={uploading || sending}
          aria-label="Attach image"
          title={uploading ? "Uploading…" : "Attach image"}
          className="ix-msg-quick"
          style={composerIconBtn(t)}
        >
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImageIcon size={16} />}
        </button>
        <button
          type="button"
          onClick={() => {
            const symbol = window.prompt("Share a chart for which ticker?", "BTC");
            if (!symbol) return;
            insertChip(CHIP_TYPES.CHART, { symbol: symbol.toUpperCase(), price: null, change24h: null });
          }}
          aria-label="Share chart"
          title="Share chart"
          className="ix-msg-quick"
          style={composerIconBtn(t)}
        >
          <BarChart3 size={16} />
        </button>
        <button
          type="button"
          onClick={() => setText((p) => `${p}${p.endsWith(" ") || !p ? "" : " "}🙂 `)}
          aria-label="Emoji"
          title="Emoji — quick insert"
          className="ix-msg-quick"
          style={composerIconBtn(t)}
        >
          <Smile size={16} />
        </button>
        <div style={{
          flex: 1, display: "flex",
          // Pill collapses to center-row at the default height and
          // stretches vertically once the user grows the composer.
          alignItems: composerH > 64 ? "stretch" : "center",
          padding: "6px 14px",
          // Pill corners relax from fully-rounded to a 16px card shape
          // once the composer is tall — a tall pill looks awkward.
          borderRadius: composerH > 80 ? 16 : 999,
          background: "var(--bg-input)", border: `1px solid ${t.border}`,
        }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 4000))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder={conv.kind === "direct" ? "Type a message…" : "Message the group…"}
            rows={1}
            style={{
              flex: 1,
              // Let the textarea breathe: the native CSS resize grip
              // would fight the drag handle, so keep \`resize: none\`
              // and size directly off composerH. Subtracts: 24 form
              // padding + 12 pill padding + 4 slack = 40.
              resize: "none",
              minHeight: 0,
              height: "auto",
              maxHeight: Math.max(24, composerH - 40),
              padding: "6px 0", border: "none", outline: "none",
              background: "transparent",
              color: t.text, fontSize: 14, fontFamily: "inherit",
              lineHeight: 1.5,
              width: "100%",
            }}
          />
        </div>
        <button
          type="submit"
          disabled={sending || !text.trim()}
          aria-label="Send"
          style={{
            width: 40, height: 40, borderRadius: "50%", border: "none",
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
        /* Context pane: docked on desktop, overlay on tablet/mobile.
           !important guards against the inline \`display: flex\` the
           JSX ships — same class of bug as the list/thread split.
           Without the override, the context pane auto-flowed into an
           implicit grid row BELOW the thread on phones, stacking the
           Details subtree under the conversation instead of covering
           it. */
        @media (min-width: 1180px) {
          .ix-msg-context { position: static !important; width: auto !important; transform: none !important; }
        }
        @media (max-width: 1179px) {
          .ix-msg-context {
            position: fixed !important;
            top: 0; right: 0; bottom: 0;
            width: min(92vw, 360px) !important;
            transform: translateX(100%);
            transition: transform 220ms cubic-bezier(0.16, 1, 0.3, 1);
            z-index: 50;
            box-shadow: -14px 0 38px rgba(0,0,0,0.35);
          }
          .ix-msg-context[data-open="true"] { transform: translateX(0); }
          /* When the pane is closed on mobile, also zero its visual
             footprint so it can't leak through in the grid flow under
             any circumstance. Belt-and-suspenders with the transform. */
          .ix-msg-context[data-open="false"] { pointer-events: none; }
        }
        @media (max-width: 640px) {
          /* On true phones go full-width — a 92vw panel with 8vw of
             blurred backdrop looks weirdly tight; just take the
             screen. */
          .ix-msg-context {
            width: 100vw !important;
            max-width: 100vw !important;
          }
        }
        .ix-msg-root { position: relative; }
        .ix-msg-grid { position: relative; }

        @media (max-width: 899px) {
          /* !important is load-bearing — both panes render with inline
             \`display: flex\` in their JSX style prop, and inline styles
             win over external CSS without it. Without the override,
             the thread stacks on top of the list on phones. */
          .ix-msg-list[data-hidden-on-mobile="true"]   { display: none !important; }
          .ix-msg-thread[data-hidden-on-mobile="true"] { display: none !important; }
          .ix-msg-back { display: inline-flex !important; }

          /* Composer: hide the image/chart/emoji shortcut icons on
             phones — the + sheet still carries all of them, and the
             input pill needs the horizontal room. */
          .ix-msg-quick { display: none !important; }

          /* Thread header: collapse the 4-button cluster down to
             info + kebab on phones. Phone/video are still reachable
             via the kebab's menu on a future pass; for now the
             sparser header fits cleanly at 375–393px widths. */
          .ix-msg-header-voice,
          .ix-msg-header-video { display: none !important; }
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

function MessageBubble({ m, t, wallet, conv, keypair, groupKey, fresh, onReply }) {
  const isMine = conv.kind === "group"
    ? (m.from_wallet && wallet && m.from_wallet.toLowerCase() === wallet.toLowerCase())
    : (m._decrypted ? true : (conv.peer?.id != null ? m.from_id !== conv.peer.id : false));

  let body = m._decrypted || "";
  if (!body) {
    if (conv.kind === "direct") {
      if (keypair && conv.peer?.dmPubkey && m.encrypted_payload && m.nonce) {
        // Day 8.3 + DM-decrypt fix: pick the secret half by fingerprint,
        // but pick the RIGHT fingerprint based on direction. For an
        // incoming message I'm the recipient, so my fp is
        // recipient_key_fp; for an outgoing one I'm the sender, so my
        // fp is sender_key_fp. The previous version always looked up
        // recipient_key_fp, which for outgoing messages is the PEER's
        // fingerprint — never in my local key history — and produced a
        // false "rotated key" placeholder for every sent message after
        // a page reload (when the in-memory _decrypted plaintext was
        // gone).
        //
        // NaCl box's shared secret is symmetric: box.open(cipher, nonce,
        // peerPub, mySecret) works for both directions, so once we pick
        // the right "my keypair" the existing decrypt call is fine.
        const myKeyFp   = isMine ? m.sender_key_fp    : m.recipient_key_fp;
        const peerKeyFp = isMine ? m.recipient_key_fp : m.sender_key_fp;

        let kp = keypair;
        if (myKeyFp && myKeyFp !== keypair.fp) {
          kp = getKeypairByFp(wallet, myKeyFp);
        }
        if (!kp) {
          body = "[encrypted with rotated key]";
        } else {
          body = naclDecrypt(m.encrypted_payload, m.nonce, conv.peer.dmPubkey, kp)
            || (peerKeyFp && peerKeyFp !== keyFingerprint(conv.peer.dmPubkey)
                ? "[encrypted with rotated key]"
                : "[unable to decrypt]");
        }
      } else {
        body = "[encrypted]";
      }
    } else if (conv.kind === "group") {
      // v1.1.1 — E2E group rendering. If the message has
      // encrypted_content we expect a cached symmetric group key
      // (loaded by the parent Thread on conv switch). Without the
      // key we render a clear placeholder so the rest of the
      // bubble — reply preview, ticks, timestamp — still draws.
      // Plaintext content path stays for legacy / non-e2e groups.
      if (m.encrypted_content && m.nonce) {
        if (!groupKey) {
          body = "[no group key on this device]";
        } else {
          body = decryptGroup(m.encrypted_content, m.nonce, groupKey)
                 || "[unable to decrypt group message]";
        }
      } else {
        body = m.content || "";
      }
    } else {
      body = m.content || "";
    }
  }

  // Day 8.4: image attachment. Sender encodes `{ url, mime }` as JSON
  // and encrypts; if the decrypted body parses as that shape, we render
  // the image inline instead of running the chip/entity pipeline. Plain
  // text never collides — JSON.parse on free-form text either throws
  // or yields a non-object.
  const attachment = useMemo(() => {
    if (!body || body[0] !== "{") return null;
    try {
      const obj = JSON.parse(body);
      if (obj && typeof obj === "object" && typeof obj.url === "string" && typeof obj.mime === "string") {
        return obj;
      }
    } catch {}
    return null;
  }, [body]);

  // Parse the body into segments so chip tokens render as rich cards
  // and plain URLs/addresses become inline entity pills. A bubble can
  // hold any mix of text + entity + chip segments.
  const segs = useMemo(() => attachment ? [] : splitBody(body), [attachment, body]);
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

  // Quoted reply preview — rendered inside the bubble above the body
  // when the backend flagged this message as a reply. Styled as a
  // muted inset card with a left bar accent, so visually clearly
  // "this message is replying to that one" without being loud.
  const isReply = !!m.reply_to_id;
  const quoteLabel  = m.reply_to_display || (m.reply_to_wallet ? shortAddr(m.reply_to_wallet) : "a message");
  const quotePreview = m.reply_to_content
    ? m.reply_to_content.slice(0, 120).replace(/\s+/g, " ")
    : "(deleted)";

  return (
    <div style={{
      display: "flex",
      justifyContent: isMine ? "flex-end" : "flex-start",
      paddingLeft: isMine ? 40 : 0,
      paddingRight: isMine ? 0 : 40,
      position: "relative",
    }}
    // Group messages get a Reply button on hover. We track hover at
    // the container level so the button slides in/out consistently
    // without flickering when the pointer crosses inner children.
    onMouseEnter={(e) => { if (onReply) e.currentTarget.dataset.hover = "1"; }}
    onMouseLeave={(e) => { if (onReply) delete e.currentTarget.dataset.hover; }}
    >
      {onReply && (
        <button
          type="button"
          onClick={onReply}
          className="ix-msg-reply-btn"
          aria-label="Reply"
          title="Reply"
          style={{
            position: "absolute",
            top: -10, right: isMine ? "auto" : 10, left: isMine ? 10 : "auto",
            padding: "3px 8px", borderRadius: 999,
            border: `1px solid ${t.border}`,
            background: "var(--bg-card)",
            color: t.text, fontSize: 10, fontWeight: 700,
            cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 4,
            zIndex: 2,
          }}
        >
          <CornerUpLeft size={10} /> Reply
        </button>
      )}
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
        {isReply && !hasOnlyChips && (
          <div style={{
            marginBottom: 6,
            paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4,
            borderLeft: `3px solid ${isMine ? "rgba(255,255,255,0.6)" : t.accent}`,
            background: isMine ? "rgba(255,255,255,0.10)" : "rgba(168,85,247,0.10)",
            borderRadius: 6,
            fontSize: 12,
            opacity: 0.85,
          }}>
            <div style={{
              fontWeight: 700, fontSize: 10,
              color: isMine ? "rgba(255,255,255,0.9)" : t.accent,
              marginBottom: 1,
            }}>
              {quoteLabel}
            </div>
            <div style={{
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              color: isMine ? "rgba(255,255,255,0.85)" : t.textDim,
            }}>
              {quotePreview}
            </div>
          </div>
        )}
        {attachment ? (
          <EncryptedAttachment attachment={attachment} t={t} />
        ) : (
          <BodySegments segs={segs} t={t} isMine={isMine} />
        )}
        {!hasOnlyChips && (
          <div style={{
            fontSize: 10, opacity: 0.7, marginTop: 4,
            display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 3,
          }}>
            {formatTime(m.created_at)}
            {/* Day 8.2 ticks (1:1 DMs only — group messages don't have
                per-recipient state). Single-tick = sent, double-tick
                = delivered, filled double-tick = read. */}
            {isMine && conv.kind === "direct" && (
              m.read_at
                ? <CheckCheck size={10} style={{ color: "#22d3ee", opacity: 1 }} />
                : m.delivered_at
                  ? <CheckCheck size={10} />
                  : <Check size={10} />
            )}
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

// Compact button for the composer action strip (+ · image · chart ·
// emoji). Borderless, hover-tinted; active state highlights when the
// attached sheet is open.
function composerIconBtn(t, active = false) {
  return {
    width: 36, height: 36, borderRadius: 10,
    border: "none",
    background: active ? "var(--accent-dim)" : "transparent",
    color: active ? t.accent : t.textMuted,
    cursor: "pointer", flexShrink: 0,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    transition: "background 140ms ease, color 140ms ease",
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

      {/* Stats — Followers / Following / Points to match the reference.
          Posts count isn't surfaced here anymore; it's visible on the
          profile page proper. "Points" pulls from the rewards endpoint
          via the peer user row (accountType + verified + dmPubkey
          already come back; points piggybacks there once backend
          lands). Falls back to 0 so the row never shows NaN. */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
        borderBottom: `1px solid ${t.border}`,
      }}>
        <Stat t={t} n={peer.followers ?? 0} l="Followers" />
        <Stat t={t} n={peer.following ?? 0} l="Following" />
        <Stat t={t} n={peer.points ?? peer.posts ?? 0} l="Points" last />
      </div>

      {/* About — mirrors the reference's "On-chain analyst and trader.
          Breaking down markets so you can build wealth." block. Renders
          the user's actual bio when present; skipped entirely when
          empty so the pane doesn't show an empty section. */}
      {peer.bio && (
        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${t.border}` }}>
          <SectionLabel t={t}>About</SectionLabel>
          <div style={{ fontSize: 13, color: t.text, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
            {peer.bio}
          </div>
        </div>
      )}

      {/* Safety number — out-of-band pubkey verification. Shows the
          peer's current DM key fingerprint, lets the viewer mark it
          as verified after comparing through a side channel, and
          surfaces a warning when the peer rotates their key after
          verification. */}
      <SafetyNumberSection
        t={t}
        peerWallet={peer.walletAddress || conv.peer?.wallet}
        peerPubkey={peer.dmPubkey || conv.peer?.dmPubkey}
      />

      {/* Shared Media — the last few media attachments this peer has
          sent to *any* feed (not just this DM, since DMs are E2E
          encrypted — their bodies aren't readable server-side). Pulls
          from /api/users/:key/posts which we just added. Hidden when
          the peer has no media. */}
      <SharedMediaGrid t={t} wallet={peer.walletAddress || conv.peer?.wallet} />

      {/* Options — mute / pin toggles, block / report / clear chat
          destructive actions, then View full profile CTA. */}
      <div style={{ padding: "14px 16px" }}>
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
        <div style={{ height: 8 }} />
        <PaneButton t={t} Icon={UserX} color="#ef4444" label="Block user" />
        <PaneButton t={t} Icon={Flag}   color="#ef4444" label="Report user" />
        <PaneButton
          t={t} Icon={MessageCircle}
          label="Clear chat"
          onClick={() => {
            if (window.confirm("Clear this conversation locally? The peer's copy is unaffected.")) {
              alert("Local clear coming with the next build.");
            }
          }}
        />
        <div style={{ height: 10 }} />
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

// v1.1.5 — DM image attachment renderer.
//
// Two cases:
//
// • Day 8.4 legacy bodies have only { url, mime } — bytes sit
//   unencrypted at the host. We render the URL directly with an <img>
//   tag (and the click-to-open-in-new-tab anchor wrapper).
//
// • v1.1.5 bodies carry { url, mime, attachKey, attachNonce } — the
//   bytes at the host are nacl.secretbox ciphertext keyed to a
//   per-message random key embedded in the (already E2E-encrypted)
//   message body. We fetch the ciphertext, decrypt to a Uint8Array,
//   wrap in a Blob, and render via blob: URL. On any failure
//   (network, decrypt mismatch, browser CORS) we fall back to a
//   placeholder so the rest of the bubble still renders.
function EncryptedAttachment({ attachment, t }) {
  const { url, mime, attachKey, attachNonce } = attachment || {};
  const isEncrypted = !!(attachKey && attachNonce);
  const [blobUrl, setBlobUrl] = useState(null);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!isEncrypted || !url) return;
    let cancelled = false;
    let createdUrl = null;
    (async () => {
      try {
        const r = await fetch(url, { mode: "cors" });
        if (!r.ok) throw new Error(`fetch ${r.status}`);
        const cipherBytes = new Uint8Array(await r.arrayBuffer());
        const plain = decryptAttachmentBytes(cipherBytes, attachKey, attachNonce);
        if (!plain) throw new Error("decrypt failed");
        if (cancelled) return;
        const blob = new Blob([plain], { type: mime || "application/octet-stream" });
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      } catch (e) {
        if (!cancelled) setError(e.message || "decrypt failed");
      }
    })();
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [isEncrypted, url, attachKey, attachNonce, mime]);

  if (!url) return null;

  // Legacy plaintext path (Day 8.4 bodies) — preserved unchanged.
  if (!isEncrypted) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ display: "block", lineHeight: 0 }}>
        <img
          src={url}
          alt="attachment"
          style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 10, display: "block" }}
        />
      </a>
    );
  }

  if (error) {
    return (
      <div style={{
        padding: "10px 12px",
        borderRadius: 10,
        background: "rgba(239,68,68,0.08)",
        border: "1px solid rgba(239,68,68,0.3)",
        fontSize: 12, color: t.text,
      }}>
        Couldn't decrypt the attached image — {error}.
      </div>
    );
  }
  if (!blobUrl) {
    return (
      <div style={{
        padding: "20px 12px", borderRadius: 10,
        background: "var(--bg-input)",
        fontSize: 12, color: t.textDim, textAlign: "center",
      }}>
        Decrypting image…
      </div>
    );
  }
  return (
    // Local blob: URL — the encrypted-bytes URL on the host would
    // download as gibberish if the user opened it directly.
    <img
      src={blobUrl}
      alt="attachment"
      style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 10, display: "block" }}
    />
  );
}

// v1.1 — Safety number / out-of-band verification.
//
// Renders the peer's current DM pubkey fingerprint and lets the
// viewer mark it as verified after comparing through a side channel
// (text it on Telegram, read it on a call, etc). Stores the
// fingerprint at verify time so a later peer rotation surfaces as a
// "their key changed since you verified" warning rather than
// silently grandfathering the new key.
function SafetyNumberSection({ t, peerWallet, peerPubkey }) {
  const { address: viewerWallet } = useWallet();
  const [state, setState] = useState({ loading: true, verified: false, fpAtVerify: null });
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState("");

  const peerFp = useMemo(() => peerPubkey ? keyFingerprint(peerPubkey) : null, [peerPubkey]);

  const refresh = useCallback(async () => {
    if (!viewerWallet || !peerWallet) {
      setState({ loading: false, verified: false, fpAtVerify: null });
      return;
    }
    try {
      const r = await api(`/api/dm/verifications/${encodeURIComponent(peerWallet)}`, { wallet: viewerWallet });
      setState({ loading: false, verified: !!r.verified, fpAtVerify: r.fpAtVerify || null });
    } catch {
      setState({ loading: false, verified: false, fpAtVerify: null });
    }
  }, [viewerWallet, peerWallet]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!peerWallet || !peerPubkey) return null;

  const verifiedMatches = state.verified && state.fpAtVerify === peerFp;
  const verifiedMismatch = state.verified && state.fpAtVerify && state.fpAtVerify !== peerFp;

  const onVerify = async () => {
    if (!peerFp || pending) return;
    setPending(true); setErr("");
    try {
      await api("/api/dm/verify", {
        method: "POST", wallet: viewerWallet,
        body: { peerWallet, peerPubkeyFp: peerFp },
      });
      await refresh();
    } catch (e) {
      setErr(e.message || "verify failed");
    } finally {
      setPending(false);
    }
  };
  const onUnverify = async () => {
    if (pending) return;
    setPending(true); setErr("");
    try {
      await api(`/api/dm/verify/${encodeURIComponent(peerWallet)}`, {
        method: "DELETE", wallet: viewerWallet,
      });
      await refresh();
    } catch (e) {
      setErr(e.message || "unverify failed");
    } finally {
      setPending(false);
    }
  };

  let badgeColor = t.textDim;
  let badgeLabel = "Not verified";
  if (verifiedMatches) { badgeColor = "#10b981"; badgeLabel = "Verified"; }
  else if (verifiedMismatch) { badgeColor = "#f59e0b"; badgeLabel = "Key changed since verify"; }

  return (
    <div style={{ padding: "14px 16px", borderBottom: `1px solid ${t.border}` }}>
      <SectionLabel t={t}>Safety number</SectionLabel>
      <div style={{ fontSize: 11, color: t.textDim, lineHeight: 1.5, marginBottom: 8 }}>
        Compare this fingerprint with your peer through a side channel (a call, another app). Marking it verified locks the value; if their key rotates later, the change shows up here.
      </div>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
        padding: "8px 10px",
        borderRadius: 8,
        background: "var(--bg-input)",
        fontFamily: "var(--font-jetbrains-mono), monospace",
        fontSize: 12, color: t.text,
        wordBreak: "break-all",
      }}>
        <span style={{ flex: 1 }}>{peerFp || "—"}</span>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
          padding: "2px 7px", borderRadius: 999,
          background: `${badgeColor}1e`, color: badgeColor,
          border: `1px solid ${badgeColor}44`,
        }}>{badgeLabel}</span>
      </div>

      {verifiedMismatch && state.fpAtVerify && (
        <div style={{ fontSize: 11, color: "#f59e0b", marginBottom: 8 }}>
          You verified <code style={{ fontFamily: "var(--font-jetbrains-mono), monospace" }}>{state.fpAtVerify}</code>; the live key is different. Re-verify only after confirming the new fingerprint with the peer.
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        {!verifiedMatches && (
          <button
            type="button"
            onClick={onVerify}
            disabled={pending || !peerFp}
            style={{
              padding: "6px 12px", borderRadius: 6, border: "none",
              background: t.accent, color: "#fff",
              fontSize: 11, fontWeight: 700, cursor: "pointer",
            }}
          >
            {pending ? "…" : (state.verified ? "Re-verify" : "Mark as verified")}
          </button>
        )}
        {state.verified && (
          <button
            type="button"
            onClick={onUnverify}
            disabled={pending}
            style={{
              padding: "6px 12px", borderRadius: 6,
              border: `1px solid ${t.border}`,
              background: "transparent", color: t.text,
              fontSize: 11, cursor: "pointer",
            }}
          >
            Clear verification
          </button>
        )}
      </div>
      {err && <div style={{ marginTop: 6, fontSize: 11, color: "#ef4444" }}>{err}</div>}
    </div>
  );
}

// Pulls the peer's last few posts and renders any media_urls as a 2x2
// thumbnail grid. If none have media, renders nothing. Cached briefly
// to avoid hammering /api/users on every thread switch.
function SharedMediaGrid({ t, wallet }) {
  const [images, setImages] = useState([]);
  useEffect(() => {
    if (!wallet) { setImages([]); return; }
    const ctl = new AbortController();
    fetch(`${API}/api/users/${encodeURIComponent(wallet)}/posts?limit=20`, { signal: ctl.signal })
      .then((r) => r.ok ? r.json() : { posts: [] })
      .then((j) => {
        const urls = [];
        for (const p of (j?.posts || [])) {
          for (const u of (p.mediaUrls || [])) {
            if (typeof u === "string" && /^https?:\/\//.test(u)) urls.push(u);
            if (urls.length >= 4) break;
          }
          if (urls.length >= 4) break;
        }
        setImages(urls);
      })
      .catch(() => setImages([]));
    return () => ctl.abort();
  }, [wallet]);

  if (!images.length) return null;
  return (
    <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <SectionLabel t={t}>Shared Media</SectionLabel>
        </div>
        <a
          href={`/profile?address=${encodeURIComponent(wallet)}`}
          style={{ fontSize: 11, color: t.accent, fontWeight: 700, textDecoration: "none" }}
        >
          View all
        </a>
      </div>
      <div style={{
        display: "grid", gap: 6,
        gridTemplateColumns: "1fr 1fr",
      }}>
        {images.slice(0, 4).map((u, i) => (
          <a
            key={i}
            href={u}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "block",
              aspectRatio: "1 / 1", borderRadius: 10,
              background: `url("${u}") center/cover no-repeat, var(--bg-input)`,
              border: `1px solid ${t.border}`,
              textDecoration: "none",
            }}
            aria-label={`Shared media ${i + 1}`}
          />
        ))}
      </div>
    </div>
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

function Stat({ t, n, l, last }) {
  return (
    <div style={{
      padding: "14px 6px", textAlign: "center",
      borderRight: last ? "none" : `1px solid ${t.border}`,
    }}>
      <div style={{
        fontSize: 17, fontWeight: 800, color: t.white,
        letterSpacing: -0.2,
        fontFamily: "var(--font-jetbrains-mono), monospace",
      }}>
        {typeof n === "number" ? (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : n.toLocaleString()) : n}
      </div>
      <div style={{ fontSize: 10, color: t.textDim, letterSpacing: 0.4, marginTop: 3 }}>{l}</div>
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

function PaneButton({ t, Icon, label, color, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
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

// Walks a chronological message list and emits a mixed list of
// segments: date dividers (Today / Yesterday / Jan 2), an "N unread
// messages" divider at the first unread boundary, and the messages
// themselves. Keeps the thread renderer free of date-grouping logic
// so the map stays readable.
function buildSeparators(messages, conv, wallet) {
  if (!messages || !messages.length) return [];
  const segs = [];
  let lastDay = null;
  let unreadInserted = false;

  // Count unread incoming messages. Ownership logic matches
  // MessageBubble: groups use from_wallet, direct DMs use from_id.
  const peerId = conv?.peer?.id;
  const myWallet = (wallet || "").toLowerCase();
  const isMine = (m) => {
    if (conv?.kind === "group") {
      return m.from_wallet && myWallet && m.from_wallet.toLowerCase() === myWallet;
    }
    if (m._decrypted) return true; // optimistic send
    return peerId != null ? m.from_id !== peerId : false;
  };
  const totalUnread = messages.reduce((n, m) => {
    if (!isMine(m) && m.read_at == null) return n + 1;
    return n;
  }, 0);

  for (const m of messages) {
    const d = new Date(m.created_at || m.createdAt || Date.now());
    const day = d.toDateString();
    if (day !== lastDay) {
      const today = new Date().toDateString();
      const yesterday = new Date(Date.now() - 86_400_000).toDateString();
      let label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      if (day === today) label = "Today";
      else if (day === yesterday) label = "Yesterday";
      segs.push({ kind: "date-divider", label, at: d.getTime() });
      lastDay = day;
    }
    if (!unreadInserted && totalUnread > 0 && !isMine(m) && m.read_at == null) {
      segs.push({ kind: "unread-divider", count: totalUnread });
      unreadInserted = true;
    }
    segs.push({ kind: "message", m });
  }
  return segs;
}

// Compact time label for the conversation-list row ("2m", "1h", "3d").
// Uses the same thresholds as the feed's timeAgo; kept separate here to
// keep the messages page self-contained.
function shortTime(iso) {
  if (!iso) return "";
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) return "";
    const m = Math.floor(ms / 60_000);
    if (m < 1) return "now";
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d`;
    const w = Math.floor(d / 7);
    if (w < 5) return `${w}w`;
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch { return ""; }
}

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
