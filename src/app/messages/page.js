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
  Phone, Plus, X as XIcon, CheckCheck,
} from "lucide-react";
import {
  getOrCreateKeypair, exportPublicKey,
  encrypt as naclEncrypt, decrypt as naclDecrypt,
} from "@/lib/dmCrypto";

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
  const [newConvOpen, setNewConvOpen] = useState(false);

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
    if (!active) return;
    loadThread(active);
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
        <div className="ix-msg-grid">
          <MessageList
            t={t}
            loading={loadingList}
            convs={convs}
            groups={groups}
            activeKey={activeKey}
            onOpen={(conv) => { setActive(conv); setShowThread(true); }}
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
          />
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
          grid-template-columns: 320px minmax(0, 1fr);
          height: 100%;
          border: 1px solid var(--border, #1d2540);
          border-radius: 14px;
          overflow: hidden;
          background: var(--bg-card, #0e1324);
        }
        @media (max-width: 899px) {
          .ix-msg-root { height: calc(100vh - 120px); min-height: 480px; }
          .ix-msg-grid { grid-template-columns: 1fr; }
          /* Single-pane switching is driven by data-hidden-on-mobile
             attributes on .ix-msg-list and .ix-msg-thread — those rules
             live in Thread's styled-jsx block so they can read the
             component's local state. */
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

function Thread({ t, wallet, keypair, conv, messages, loading, onBack, onSent, showThread }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState(null);
  const scrollRef = useRef(null);

  // Auto-scroll to newest message whenever the list grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages?.length, conv?.id]);

  const send = useCallback(async () => {
    if (!text.trim() || !conv || !wallet || sending) return;
    setSending(true);
    setErr(null);
    const body = text.trim();
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
        // Show optimistically with local plaintext so the sender sees
        // their own message immediately.
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
      setText("");
    } catch (e) {
      setErr(e.message || "Send failed");
    } finally {
      setSending(false);
    }
  }, [text, conv, wallet, keypair, sending, onSent]);

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

        {messages.map((m) => (
          <MessageBubble key={m.id} m={m} t={t} wallet={wallet} conv={conv} keypair={keypair} />
        ))}
      </div>

      {err && (
        <div style={{
          padding: "8px 14px", background: "rgba(239,68,68,0.08)",
          color: "var(--red)", fontSize: 12, borderTop: "1px solid var(--red)",
        }}>
          {err}
        </div>
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

function MessageBubble({ m, t, wallet, conv, keypair }) {
  // Ownership detection:
  //   · Group rows have from_wallet; compare directly.
  //   · Direct rows come back with from_id (server user PK). Any row
  //     where from_id != peer.id came from us. Optimistic rows we
  //     inserted locally also mark _decrypted, which is a reliable
  //     fallback if the server hasn't roundtripped yet.
  const isMine = conv.kind === "group"
    ? (m.from_wallet && wallet && m.from_wallet.toLowerCase() === wallet.toLowerCase())
    : (m._decrypted ? true : (conv.peer?.id != null ? m.from_id !== conv.peer.id : false));

  // Resolve body text. Group messages are plaintext. Direct messages
  // are encrypted — decrypt with the peer's public key + our secret.
  // Optimistic rows already carry _decrypted so the sender sees their
  // own text before the server roundtrip.
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

  return (
    <div style={{
      display: "flex",
      justifyContent: isMine ? "flex-end" : "flex-start",
      paddingLeft: isMine ? 40 : 0,
      paddingRight: isMine ? 0 : 40,
    }}>
      <div style={{
        maxWidth: "100%",
        padding: "9px 12px",
        borderRadius: 14,
        background: isMine
          ? `linear-gradient(135deg, ${t.accent}, #a855f7)`
          : "var(--bg-card)",
        color: isMine ? "#fff" : t.text,
        border: isMine ? "none" : `1px solid ${t.border}`,
        boxShadow: isMine ? "0 4px 10px rgba(168,85,247,0.25)" : "none",
        fontSize: 14, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word",
      }}>
        {conv.kind === "group" && !isMine && (
          <div style={{
            fontSize: 10, fontWeight: 800, letterSpacing: 0.3,
            color: t.accent, marginBottom: 3, opacity: 0.8,
          }}>
            {m.from_display || shortAddr(m.from_wallet)}
          </div>
        )}
        {body}
        <div style={{
          fontSize: 10, opacity: 0.7, marginTop: 4,
          display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 3,
        }}>
          {formatTime(m.created_at)}
          {isMine && m.read_at && <CheckCheck size={10} />}
        </div>
      </div>
    </div>
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
