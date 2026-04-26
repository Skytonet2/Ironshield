"use client";
// Room interior — /rooms/view/?id=<roomId>
//
// Voice stage (top), text chat (center), participants sidebar (right).
// Voice is mocked here — Deliverable 7 swaps in a real LiveKit @livekit/components-react
// stage and a server-side token mint endpoint. Text chat polls /api/rooms/:id/messages.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft, Mic, MicOff, Hand, ShieldAlert, Radio, Send, Sparkles, X,
  Crown, UserPlus, UserMinus, ChevronUp, ChevronDown, Loader2, DoorOpen, Pin, Lock, Coins, Users,
  Phone, MessageCircle, ShieldCheck, Award, TrendingUp, CheckCircle2,
} from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import LiveStage from "@/components/LiveStage";

import { API_BASE as API } from "@/lib/apiBase";
import { apiFetch } from "@/lib/apiFetch";
import { addListener, send as wsSend } from "@/lib/ws/wsClient";

function shortWallet(w = "") { return w?.length > 18 ? `${w.slice(0, 8)}…${w.slice(-6)}` : (w || ""); }
function timeLeft(endsAt) {
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return "ending";
  const m = Math.floor(ms / 60_000);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m`;
}
function botColor(s) { return s >= 70 ? "#ef4444" : s >= 40 ? "#f59e0b" : "#22c55e"; }
function initials(p) { return (p.displayName || p.username || p.wallet || "?")[0]?.toUpperCase(); }

export default function RoomViewPage() {
  return (
    <Suspense fallback={<Loading />}>
      <RoomViewInner />
    </Suspense>
  );
}

function Loading() {
  // Mark the outer wrapper as app-shell-ready so the inline pre-loader
  // script (see src/app/layout.js) dismisses the crest. The room view
  // is intentionally standalone (no AppShell chrome — spaces-style
  // focused surface), so it has to signal readiness explicitly.
  return (
    <div data-app-shell="ready" style={{
      minHeight: "100vh", display: "grid", placeItems: "center",
      background: "#080b12", color: "#94a3b8",
    }}>
      Loading room…
    </div>
  );
}

function RoomViewInner() {
  const t = useTheme();
  const { connected, address: wallet, selector, showModal: openWallet } = useWallet();
  const sp = useSearchParams();
  const roomId = sp.get("id");

  const [room, setRoom]                 = useState(null);
  const [parts, setParts]               = useState([]);
  const [msgs, setMsgs]                 = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState("");
  const [joined, setJoined]             = useState(false);
  const [myRole, setMyRole]             = useState(null);
  const [muted, setMuted]               = useState(false);
  const [handRaised, setHandRaised]     = useState(false);
  const [draftMsg, setDraftMsg]         = useState("");
  const [sending, setSending]           = useState(false);
  const [inviting, setInviting]         = useState(false);
  const [closing, setClosing]           = useState(false);
  const [closedSummary, setClosedSummary] = useState(null);
  const lastMsgTs = useRef(null);
  const chatEnd = useRef(null);

  const isHost = useMemo(
    () => !!(room?.host?.wallet && wallet && room.host.wallet.toLowerCase() === wallet.toLowerCase()),
    [room, wallet]
  );

  // Initial load + every 5s refresh of room/participants.
  const loadRoom = async () => {
    if (!roomId) return;
    try {
      const r = await fetch(`${API}/api/rooms/${roomId}`);
      if (!r.ok) throw new Error(`room ${r.status}`);
      const j = await r.json();
      setRoom(j.room);
      setParts(j.participants || []);
      if (wallet) {
        const me = (j.participants || []).find(p => p.wallet?.toLowerCase() === wallet.toLowerCase());
        setMyRole(me?.role || null);
        setJoined(!!me);
        setHandRaised(!!me?.handRaised);
      }
    } catch (e) {
      setError(e?.message || "Couldn't load room");
    } finally {
      setLoading(false);
    }
  };

  // Poll messages incrementally.
  const pollMessages = async () => {
    if (!roomId) return;
    const url = lastMsgTs.current
      ? `${API}/api/rooms/${roomId}/messages?since=${encodeURIComponent(lastMsgTs.current)}`
      : `${API}/api/rooms/${roomId}/messages`;
    try {
      const r = await fetch(url);
      if (!r.ok) return;
      const j = await r.json();
      if (!j.messages?.length) return;
      setMsgs(prev => {
        const next = lastMsgTs.current ? [...prev, ...j.messages] : j.messages;
        return next.slice(-300);
      });
      lastMsgTs.current = j.messages[j.messages.length - 1].createdAt;
    } catch {}
  };

  useEffect(() => { loadRoom(); /* eslint-disable-next-line */ }, [roomId, wallet]);
  useEffect(() => { pollMessages(); /* eslint-disable-next-line */ }, [roomId]);
  useEffect(() => {
    if (!roomId) return;
    const a = setInterval(loadRoom, 8000);
    const b = setInterval(pollMessages, 3000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [roomId, wallet]); // eslint-disable-line

  // WS chat fanout. The 3s poll is the safety net; this cuts live
  // latency to ~the network round trip. Empty trackers = "send me
  // everything" — server-side feedHub filters only when subs is
  // non-empty. Dedup on the id since poll + WS can both deliver.
  useEffect(() => {
    if (!roomId) return;
    wsSend({ type: "subscribe", trackers: [] });
    const off = [
      addListener("room:msg", (e) => {
        if (Number(e.roomId) !== Number(roomId) || !e.message) return;
        setMsgs((prev) => {
          if (prev.some((m) => m.id === e.message.id)) return prev;
          const next = [...prev, e.message];
          return next.slice(-300);
        });
        if (e.message.createdAt) lastMsgTs.current = e.message.createdAt;
      }),
      addListener("room:participant_kicked", (e) => {
        if (Number(e.roomId) !== Number(roomId)) return;
        // If the local user is the one being kicked, leave the page.
        // Otherwise just refresh participants.
        loadRoom();
      }),
      addListener("room:recording", (e) => {
        if (Number(e.roomId) !== Number(roomId)) return;
        loadRoom();
      }),
    ];
    return () => { off.forEach((u) => u && u()); };
  }, [roomId]); // eslint-disable-line
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs.length]);

  const join = async (role = "listener") => {
    if (!wallet) { openWallet(); return; }
    try {
      const r = await apiFetch(`/api/rooms/${roomId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `join ${r.status}`);
      setMyRole(j.role);
      setJoined(true);
      loadRoom();
    } catch (e) { alert(e?.message || "Couldn't join"); }
  };

  // Listener asks for the mic. In open rooms the request is auto-granted via
  // /join with role=speaker. In gated rooms we raise the hand and let the host
  // promote from the participants sidebar.
  const requestMic = async () => {
    if (!wallet || !joined) return;
    const isOpen = room?.accessType === "open";
    if (isOpen) {
      try {
        const r = await apiFetch(`/api/rooms/${roomId}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "speaker" }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `mic ${r.status}`);
        setMyRole(j.role || "speaker");
        setMuted(false);
        loadRoom();
      } catch (e) { alert(e?.message || "Couldn't grab mic"); }
    } else {
      toggleHand();
    }
  };

  const leave = async () => {
    if (!wallet) return;
    try {
      await apiFetch(`/api/rooms/${roomId}/leave`, {
        method: "POST",
      });
    } catch {}
    if (typeof window !== "undefined") window.location.href = "/rooms/";
  };

  const toggleHand = async () => {
    if (!wallet || !joined) return;
    const next = !handRaised;
    setHandRaised(next);
    try {
      await apiFetch(`/api/rooms/${roomId}/raise`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raised: next }),
      });
    } catch {}
  };

  const send = async (isAlphaCall = false) => {
    if (!wallet || !joined || !draftMsg.trim() || sending) return;
    setSending(true);
    try {
      const r = await apiFetch(`/api/rooms/${roomId}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draftMsg.trim(), isAlphaCall }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `send ${r.status}`);
      }
      setDraftMsg("");
      pollMessages();
    } catch (e) { alert(e?.message || "Couldn't send"); }
    finally { setSending(false); }
  };

  const voteAlpha = async (msgId, dir) => {
    if (!wallet) { openWallet(); return; }
    try {
      await apiFetch(`/api/rooms/${roomId}/messages/${msgId}/vote`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir }),
      });
      // Optimistic bump
      setMsgs(prev => prev.map(m => m.id === msgId
        ? { ...m, [dir === "up" ? "alphaUpvotes" : "alphaDownvotes"]: (dir === "up" ? m.alphaUpvotes : m.alphaDownvotes) + 1 }
        : m));
    } catch {}
  };

  const promote = async (userId, role) => {
    if (!wallet || !isHost) return;
    try {
      await apiFetch(`/api/rooms/${roomId}/promote`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role }),
      });
      loadRoom();
    } catch {}
  };

  const kick = async (userId) => {
    if (!wallet || !isHost) return;
    if (!confirm("Remove this participant?")) return;
    try {
      await apiFetch(`/api/rooms/${roomId}/kick`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      loadRoom();
    } catch {}
  };

  const closeRoom = async () => {
    if (!isHost || closing) return;
    if (!confirm("End the room? Stake refunds if no rules were broken.")) return;
    setClosing(true);
    try {
      const r = await apiFetch(`/api/rooms/${roomId}/close`, {
        method: "POST",
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "close failed");
      // Day 5.2 backend swap: response now carries refundStatus
      // ("pending" | "forfeited") + refundTx (null until Day 13 wires
      // the on-chain refund). Forward both so the modal can render an
      // honest state — "Refund pending" beats faking a tx hash.
      setClosedSummary({ ...j.summary, refundTx: j.refundTx, refundStatus: j.refundStatus });
    } catch (e) { alert(e?.message || "Couldn't close"); }
    finally { setClosing(false); }
  };

  const inviteToCall = async () => {
    if (!wallet) { openWallet(); return; }
    if (!joined) return;
    const target = window.prompt("Invite wallet/handle (optional)");
    const url = `${window.location.origin}/rooms/view/?id=${encodeURIComponent(roomId)}`;
    const msg = target && target.trim()
      ? `Join my live call in room "${room?.title || "Live Room"}": ${url} (for ${target.trim()})`
      : `Join my live call in room "${room?.title || "Live Room"}": ${url}`;
    setInviting(true);
    try {
      if (navigator.share) {
        await navigator.share({ title: "Join my call", text: msg, url });
      } else {
        await navigator.clipboard.writeText(msg);
        alert("Invite copied to clipboard.");
      }
    } catch {}
    finally { setInviting(false); }
  };

  if (loading) return <Loading />;
  if (error || !room) {
    return (
      <div data-app-shell="ready" style={{
        minHeight: "100vh", background: t.bg, color: t.text,
        display: "grid", placeItems: "center", padding: 24,
      }}>
        <div style={{ textAlign: "center" }}>
          <Radio size={36} color={t.amber} />
          <h2 style={{ color: t.white, margin: "10px 0 6px" }}>Room not found</h2>
          <p style={{ color: t.textMuted, fontSize: 13 }}>{error || "This room may have ended."}</p>
          <a href="/rooms/" style={{ color: t.accent, fontSize: 13 }}>← Back to rooms</a>
        </div>
      </div>
    );
  }

  const speakers  = parts.filter(p => p.role === "host" || p.role === "speaker");
  const listeners = parts.filter(p => p.role === "listener");
  const handsUp   = parts.filter(p => p.handRaised && p.role === "listener");

  return (
    <div data-app-shell="ready" style={{ minHeight: "100vh", background: t.bg, color: t.text }}>
      <nav aria-hidden style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 }} />

      {/* Top bar */}
      <div className="ix-room-topbar" style={{
        padding: "14px 22px", borderBottom: `1px solid ${t.border}`,
        background: `linear-gradient(180deg, ${t.bgCard}, rgba(8,11,18,0.95))`,
        position: "sticky", top: 0, zIndex: 10,
        display: "flex", alignItems: "center", gap: 14,
      }}>
        <a href="/rooms/" style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          color: t.text, textDecoration: "none",
          padding: "6px 8px", borderRadius: 8, fontWeight: 700, fontSize: 14,
        }}>
          <ArrowLeft size={16} /> Rooms
        </a>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800,
          color: "#fca5a5", padding: "4px 10px", borderRadius: 999,
          background: "rgba(239,68,68,0.14)", border: "1px solid rgba(239,68,68,0.36)",
          letterSpacing: 0.6,
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: "50%", background: "#ef4444",
            boxShadow: "0 0 8px #ef4444", animation: "ixPulse 1.2s ease-in-out infinite",
          }} /> LIVE
        </span>
        {room.recording?.live && (
          <span title="This room is being recorded" style={{
            display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800,
            color: "#fbbf24", padding: "4px 10px", borderRadius: 999,
            background: "rgba(245,158,11,0.14)", border: "1px solid rgba(245,158,11,0.36)",
            letterSpacing: 0.6,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%", background: "#fbbf24",
              boxShadow: "0 0 8px #fbbf24", animation: "ixPulse 1.2s ease-in-out infinite",
            }} /> REC
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ix-room-title" style={{
            color: t.white, fontSize: 15, fontWeight: 800, lineHeight: 1.2,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {room.host?.username || room.host?.displayName || room.title}
          </div>
          <div className="ix-room-subtitle" style={{ color: t.textMuted, fontSize: 11.5, marginTop: 2 }}>
            {room.topic ? `#${room.topic}` : "—"} · ends in {timeLeft(room.endsAt)}
          </div>
        </div>
        <span className="ix-room-bot-chip" title={`Bot threat ${room.counts.botThreat}/100`} style={{
          display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 800,
          color: "#fbbf24",
          padding: "6px 12px", borderRadius: 999,
          background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.36)",
        }}>
          <ShieldAlert size={13} /> {room.counts.botThreat}
        </span>
        <span className="ix-room-stake-chip" style={{
          display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 800,
          color: "#fbbf24",
          padding: "6px 12px", borderRadius: 999,
          background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.36)",
        }}>
          <Coins size={13} /> ${Math.round(room.stake.amountUsd)}
        </span>
        {!connected ? (
          <button onClick={openWallet} style={btnPrimary(t)}>Connect</button>
        ) : !joined ? (
          <button onClick={() => join("listener")} style={btnPrimary(t)}>Join</button>
        ) : (
          <>
            <button onClick={inviteToCall} disabled={inviting} style={btnPill(t)}>
              {inviting ? <Loader2 size={14} className="ix-spin" /> : <UserPlus size={14} />} Invite
            </button>
            <button onClick={leave} style={btnPill(t)}>
              <DoorOpen size={14} /> Leave
            </button>
          </>
        )}
        {isHost && (
          <button onClick={closeRoom} disabled={closing} style={btnEndRoom(t)}>
            {closing ? <Loader2 size={14} className="ix-spin" /> : <X size={14} />} End room
          </button>
        )}
      </div>

      {/* Layout: stage+chat | participants */}
      <div className="ix-room-grid" style={{
        display: "grid", gridTemplateColumns: "1fr 280px", gap: 16,
        padding: 16, maxWidth: 1280, margin: "0 auto",
      }}>
        {/* Main column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {/* Voice stage */}
          <LiveStage
            t={t} room={room} roomId={roomId} wallet={wallet}
            joined={joined} myRole={myRole}
            speakers={speakers}
            voiceEnabled={room.voiceEnabled}
            accessType={room.accessType}
            muted={muted} setMuted={setMuted}
            handRaised={handRaised} onToggleHand={toggleHand}
            onRequestMic={requestMic}
          />

          {/* Chat */}
          <section style={{
            background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
            padding: 18, display: "flex", flexDirection: "column", minHeight: 360,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <span style={{
                width: 26, height: 26, borderRadius: 8,
                background: "rgba(168,85,247,0.16)", color: "#c4b8ff",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}>
                <MessageCircle size={14} />
              </span>
              <span style={{ color: t.white, fontWeight: 800, fontSize: 14, letterSpacing: 0.4, textTransform: "uppercase" }}>Chat</span>
              <span style={{ color: t.textDim, fontSize: 11.5, marginLeft: 4 }}>Alpha calls earn revenue-share points</span>
            </div>
            <div style={{
              flex: 1, overflow: "auto", display: "flex", flexDirection: "column",
              gap: 8, paddingRight: 4, maxHeight: 460,
              position: "relative",
            }}>
              {msgs.length === 0 && (
                <div style={{
                  position: "absolute", inset: 0,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  gap: 14, padding: 24,
                }}>
                  {/* Decorative starfield speckle behind the bubble */}
                  <div aria-hidden style={{
                    position: "absolute", inset: 0, opacity: 0.5, pointerEvents: "none",
                    backgroundImage: "radial-gradient(circle at 22% 30%, rgba(168,85,247,0.30) 1.2px, transparent 1.5px), radial-gradient(circle at 70% 60%, rgba(96,165,250,0.30) 1.2px, transparent 1.5px), radial-gradient(circle at 80% 22%, rgba(168,85,247,0.20) 1.2px, transparent 1.5px), radial-gradient(circle at 36% 80%, rgba(168,85,247,0.20) 1.2px, transparent 1.5px)",
                  }} />
                  <span style={{
                    width: 64, height: 64, borderRadius: "50%",
                    background: "rgba(168,85,247,0.10)",
                    border: "1px solid rgba(168,85,247,0.30)",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    color: "#c4b8ff",
                    boxShadow: "0 0 30px rgba(168,85,247,0.18)",
                  }}>
                    <MessageCircle size={26} />
                  </span>
                  <div style={{ textAlign: "center", position: "relative", zIndex: 1 }}>
                    <div style={{ color: t.text, fontSize: 14, fontWeight: 700, marginBottom: 4 }}>No messages yet.</div>
                    <div style={{ color: t.textMuted, fontSize: 12.5 }}>Be the first to drop alpha.</div>
                  </div>
                </div>
              )}
              {msgs.map(m => (
                <ChatMessage key={m.id} t={t} m={m} onVote={voteAlpha} />
              ))}
              <div ref={chatEnd} />
            </div>
            <div className="ix-chat-input-row" style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <input
                value={draftMsg}
                onChange={e => setDraftMsg(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(false); } }}
                disabled={!joined || sending}
                placeholder={joined ? "Say something… or call alpha 🪙" : "Join the room to chat"}
                maxLength={500}
                style={{
                  flex: 1, padding: "12px 14px", borderRadius: 999,
                  background: t.bgSurface, border: `1px solid ${t.border}`,
                  color: t.text, fontSize: 13, outline: "none",
                }}
              />
              <button onClick={() => send(true)} disabled={!joined || sending || !draftMsg.trim()}
                title="Mark as alpha call"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "10px 16px", borderRadius: 999,
                  background: "transparent", color: "#fbbf24",
                  border: "1.5px solid rgba(245,158,11,0.55)",
                  cursor: !joined || sending || !draftMsg.trim() ? "not-allowed" : "pointer",
                  fontSize: 13, fontWeight: 800,
                  opacity: !joined || sending || !draftMsg.trim() ? 0.5 : 1,
                }}>
                <Sparkles size={14} /> Alpha
              </button>
              <button onClick={() => send(false)} disabled={!joined || sending || !draftMsg.trim()}
                style={{
                  width: 44, height: 44, borderRadius: "50%",
                  background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
                  color: "#1a0f00", border: "none",
                  cursor: !joined || sending || !draftMsg.trim() ? "not-allowed" : "pointer",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                  opacity: !joined || sending || !draftMsg.trim() ? 0.5 : 1,
                  boxShadow: "0 8px 22px rgba(245,158,11,0.36)",
                }}>
                {sending ? <Loader2 size={16} className="ix-spin" /> : <Send size={16} />}
              </button>
            </div>
          </section>
        </div>

        {/* Participants sidebar */}
        <aside className="ix-room-aside" style={{
          display: "flex", flexDirection: "column", gap: 14,
          minWidth: 0, position: "sticky", top: 80, alignSelf: "flex-start",
        }}>
        <div style={{
          background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14, padding: 16,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span style={{
              width: 26, height: 26, borderRadius: 8,
              background: "rgba(245,158,11,0.14)", color: "#fbbf24",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}>
              <Users size={14} />
            </span>
            <span style={{ color: t.white, fontWeight: 800, fontSize: 14, letterSpacing: 0.4, textTransform: "uppercase" }}>Participants</span>
            <span style={{ color: t.textDim, fontSize: 12.5, marginLeft: 2 }}>· {parts.length}</span>
          </div>

          {isHost && handsUp.length > 0 && (
            <div style={{ marginBottom: 12, padding: 8, borderRadius: 10,
              background: `${t.amber}14`, border: `1px solid ${t.amber}44` }}>
              <div style={{ color: t.amber, fontSize: 11, fontWeight: 800, marginBottom: 6,
                display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Hand size={11} /> {handsUp.length} hand{handsUp.length === 1 ? "" : "s"} up
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {handsUp.map(p => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <PartAvatar t={t} p={p} size={22} />
                    <span style={{ flex: 1, fontSize: 12, color: t.text,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.displayName || p.username || shortWallet(p.wallet)}
                    </span>
                    <button onClick={() => promote(p.id, "speaker")} title="Promote to speaker"
                      style={{ ...btnTiny(t), color: "#22c55e", borderColor: "#22c55e66" }}>
                      <UserPlus size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Section t={t} title="Speakers" count={speakers.length}>
            {speakers.map(p => (
              <PartRow key={p.id} t={t} p={p} isHost={p.role === "host"}
                actions={isHost && p.role !== "host" ? (
                  <>
                    <button onClick={() => promote(p.id, "listener")} title="Move to listener"
                      style={{ ...btnTiny(t), color: t.textMuted }}>
                      <UserMinus size={11} />
                    </button>
                    <button onClick={() => kick(p.id)} title="Remove"
                      style={{ ...btnTiny(t), color: "#ef4444", borderColor: "#ef444466" }}>
                      <X size={11} />
                    </button>
                  </>
                ) : null} />
            ))}
          </Section>

          <Section t={t} title="Listeners" count={listeners.length}>
            {listeners.map(p => (
              <PartRow key={p.id} t={t} p={p}
                actions={isHost ? (
                  <>
                    <button onClick={() => promote(p.id, "speaker")} title="Promote"
                      style={{ ...btnTiny(t), color: "#22c55e", borderColor: "#22c55e66" }}>
                      <UserPlus size={11} />
                    </button>
                    <button onClick={() => kick(p.id)} title="Remove"
                      style={{ ...btnTiny(t), color: "#ef4444", borderColor: "#ef444466" }}>
                      <X size={11} />
                    </button>
                  </>
                ) : null} />
            ))}
            {listeners.length === 0 && (
              <div style={{
                padding: "20px 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                color: t.textMuted, fontSize: 12, textAlign: "center",
              }}>
                <span style={{
                  width: 44, height: 44, borderRadius: "50%",
                  background: "rgba(168,85,247,0.10)",
                  border: `1px solid rgba(168,85,247,0.30)`,
                  color: "#c4b8ff",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Users size={18} />
                </span>
                <div>
                  <div style={{ color: t.text, fontSize: 13, fontWeight: 700, marginBottom: 2 }}>No listeners yet.</div>
                  <div style={{ color: t.textMuted, fontSize: 11.5 }}>Be the first to drop alpha.</div>
                </div>
              </div>
            )}
          </Section>
        </div>

        {/* Share Alpha rail panel — community/incentives messaging */}
        <ShareAlphaPanel t={t} />
        </aside>
      </div>

      {closedSummary && (
        <ClosedSummaryModal t={t} summary={closedSummary} room={room}
          onClose={() => { if (typeof window !== "undefined") window.location.href = "/rooms/"; }} />
      )}

      <style>{`
        .ix-spin { animation: ixSpin 1s linear infinite; }
        @keyframes ixSpin { to { transform: rotate(360deg); } }
        @keyframes ixPulse { 0%,100% { opacity: 1 } 50% { opacity: .4 } }
        @keyframes ixRing { 0% { box-shadow: 0 0 0 0 #f5b30166 } 70% { box-shadow: 0 0 0 8px transparent } 100% { box-shadow: 0 0 0 0 transparent } }
        @media (max-width: 820px) {
          .ix-room-grid { grid-template-columns: 1fr !important; padding: 10px !important; }
          .ix-room-aside { position: static !important; top: auto !important; }
        }
        @media (max-width: 560px) {
          .ix-room-topbar { padding: 8px 10px !important; gap: 6px !important; flex-wrap: wrap !important; }
          .ix-room-topbar .ix-room-title { font-size: 13px !important; }
          .ix-room-topbar .ix-room-subtitle { font-size: 10px !important; }
          .ix-room-topbar .ix-room-stake-chip { display: none !important; }
          .ix-room-topbar .ix-room-bot-chip { font-size: 10px !important; }
          .ix-chat-input-row { flex-wrap: wrap !important; }
          .ix-chat-input-row input { flex: 1 1 100% !important; }
        }
      `}</style>
    </div>
  );
}

function SpeakerTile({ t, p, isMe, muted }) {
  // Mock "speaking" indicator: per-participant-stable random pulse interval.
  const isHost = p.role === "host";
  const fakeSpeaking = !isMe || !muted; // host/others appear active; me reflects mute state
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 0 }}>
      <div style={{ position: "relative" }}>
        {p.pfpUrl ? (
          <img src={p.pfpUrl} alt="" style={{ width: 64, height: 64, borderRadius: "50%",
            objectFit: "cover", border: `2px solid ${isHost ? t.amber : t.border}`,
            animation: fakeSpeaking ? "ixRing 1.6s ease-out infinite" : "none" }} />
        ) : (
          <div style={{ width: 64, height: 64, borderRadius: "50%",
            background: `linear-gradient(135deg, ${t.accent}, #0ea5e9)`,
            display: "grid", placeItems: "center", color: "#fff", fontWeight: 800, fontSize: 22,
            border: `2px solid ${isHost ? t.amber : t.border}`,
            animation: fakeSpeaking ? "ixRing 1.6s ease-out infinite" : "none" }}>
            {initials(p)}
          </div>
        )}
        {isHost && (
          <Crown size={14} color={t.amber} style={{ position: "absolute", top: -4, right: -4 }} fill={t.amber} />
        )}
        {!fakeSpeaking && (
          <div style={{ position: "absolute", bottom: -2, right: -2,
            background: t.bgCard, borderRadius: "50%", padding: 2, border: `1px solid ${t.border}` }}>
            <MicOff size={11} color="#ef4444" />
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: t.text, fontWeight: 600, maxWidth: 100,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {p.displayName || p.username || shortWallet(p.wallet)}
      </div>
      {p.botProbability != null && (
        <span style={{ fontSize: 9, fontWeight: 700, color: botColor(p.botProbability),
          display: "inline-flex", alignItems: "center", gap: 2 }}>
          <ShieldAlert size={9} /> {p.botProbability}
        </span>
      )}
    </div>
  );
}

function ChatMessage({ t, m, onVote }) {
  const accent = m.isAlphaCall ? t.amber : null;
  return (
    <div style={{
      padding: "8px 10px", borderRadius: 10,
      background: m.isAlphaCall ? `${t.amber}10` : t.bgSurface,
      border: `1px solid ${m.isAlphaCall ? `${t.amber}55` : t.border}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <PartAvatar t={t} p={m.author} size={18} />
        <span style={{ fontSize: 11, fontWeight: 700, color: t.text }}>
          {m.author.displayName || m.author.username || shortWallet(m.author.wallet)}
        </span>
        {m.isAlphaCall && (
          <span style={{ fontSize: 9, fontWeight: 800, color: accent, padding: "1px 6px",
            borderRadius: 999, background: `${accent}22`, border: `1px solid ${accent}55`,
            display: "inline-flex", alignItems: "center", gap: 3 }}>
            <Sparkles size={9} /> ALPHA
          </span>
        )}
        {m.pinned && <Pin size={10} color={t.textMuted} />}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: t.textDim }}>
          {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      <div style={{ fontSize: 13, color: t.text, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {m.content}
      </div>
      {m.isAlphaCall && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button onClick={() => onVote(m.id, "up")}
            style={{ ...btnTiny(t), color: "#22c55e", borderColor: "#22c55e66" }}>
            <ChevronUp size={11} /> {m.alphaUpvotes || 0}
          </button>
          <button onClick={() => onVote(m.id, "down")}
            style={{ ...btnTiny(t), color: "#ef4444", borderColor: "#ef444466" }}>
            <ChevronDown size={11} /> {m.alphaDownvotes || 0}
          </button>
        </div>
      )}
    </div>
  );
}

function PartAvatar({ t, p, size = 24 }) {
  if (p.pfpUrl) {
    return <img src={p.pfpUrl} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover" }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: "50%",
      background: `linear-gradient(135deg, ${t.accent}, #0ea5e9)`,
      display: "grid", placeItems: "center", color: "#fff", fontWeight: 800,
      fontSize: Math.max(9, Math.floor(size * 0.45)) }}>
      {initials(p)}
    </div>
  );
}

function PartRow({ t, p, isHost, actions }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 4px",
      borderRadius: 8 }}>
      <PartAvatar t={t} p={p} size={26} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: t.text, fontWeight: 600,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {p.displayName || p.username || shortWallet(p.wallet)}
          {isHost && <Crown size={10} color={t.amber} style={{ marginLeft: 4, verticalAlign: "middle" }} />}
        </div>
        <div style={{ fontSize: 10, color: botColor(p.botProbability),
          display: "inline-flex", alignItems: "center", gap: 3 }}>
          <ShieldAlert size={9} /> {p.botProbability}
        </div>
      </div>
      {actions}
    </div>
  );
}

function Section({ t, title, count, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ color: t.textMuted, fontSize: 10, fontWeight: 800,
        textTransform: "uppercase", letterSpacing: .5, marginBottom: 4, padding: "0 4px" }}>
        {title} · {count}
      </div>
      <div>{children}</div>
    </div>
  );
}

function ClosedSummaryModal({ t, summary, room, onClose }) {
  // Three states post Day 5.2:
  //   - refundStatus="pending"  + refundTx=null → "Refund pending" (Day 13
  //                                                wires the chain call)
  //   - refundStatus="pending"  + refundTx=<hash> → "Stake refunded"
  //   - refundStatus="forfeited"                  → "Stake withheld"
  // Older builds may still return only refundTx; treat truthy as success.
  const refundStatus = summary.refundStatus
    || (summary.refundTx ? "pending" : "forfeited");
  const refunded = refundStatus !== "forfeited";
  const refundOnChain = !!summary.refundTx;
  const stakeAmt = room?.stake?.amountHuman ?? room?.stake?.amount ?? "";
  const stakeUsd = room?.stake?.amountUsd ?? 0;

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "radial-gradient(circle at center, rgba(0,0,0,0.88), rgba(0,0,0,0.94))",
      backdropFilter: "blur(8px)",
      display: "grid", placeItems: "center", zIndex: 100, padding: 16,
    }}>
      <div style={{
        position: "relative", overflow: "hidden",
        width: "100%", maxWidth: 480,
        background: `linear-gradient(180deg, rgba(168,85,247,0.08), ${t.bgCard} 60%)`,
        borderRadius: 22,
        border: "1px solid rgba(168,85,247,0.32)",
        padding: "32px 28px 26px",
        textAlign: "center",
        boxShadow: "0 0 0 1px rgba(168,85,247,0.18) inset, 0 30px 80px rgba(0,0,0,0.55)",
      }}>
        {/* Confetti specks */}
        <Confetti />

        {/* Close X */}
        <button onClick={onClose} aria-label="Close" style={{
          position: "absolute", top: 14, right: 14,
          width: 32, height: 32, borderRadius: 10,
          background: t.bgSurface, border: `1px solid ${t.border}`,
          color: t.textMuted, cursor: "pointer", zIndex: 2,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}>
          <X size={15} />
        </button>

        {/* Hero icon */}
        <div style={{ position: "relative", zIndex: 1, marginBottom: 18 }}>
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 72, height: 72, borderRadius: "50%",
            background: "rgba(245,158,11,0.14)",
            border: "1px solid rgba(245,158,11,0.45)",
            color: "#fbbf24",
            boxShadow: "0 0 0 6px rgba(245,158,11,0.06), 0 0 40px rgba(245,158,11,0.35)",
          }}>
            <Radio size={32} strokeWidth={2.4} />
          </span>
        </div>

        <h2 style={{ color: t.white, margin: "0 0 6px", fontSize: 28, fontWeight: 800, letterSpacing: -0.4, position: "relative", zIndex: 1 }}>
          Room ended
        </h2>
        <p style={{ color: t.textMuted, fontSize: 14, margin: "0 0 22px", position: "relative", zIndex: 1 }}>
          Thanks for hosting{" "}
          <strong style={{ color: "#fbbf24", fontWeight: 800 }}>
            {room.host?.username || room.host?.displayName || (room.host?.wallet ? `${room.host.wallet.slice(0,8)}…` : "this room")}
          </strong>.
        </p>

        {/* Stat tiles */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10,
          position: "relative", zIndex: 1, marginBottom: 18,
        }}>
          <SummaryStat t={t} label="Participants" value={summary.totalParticipants} Icon={Users} />
          <SummaryStat t={t} label="Speakers"     value={summary.totalSpeakers}     Icon={Mic} />
          <SummaryStat t={t} label="Alpha calls"  value={summary.alphaCalls}        Icon={Phone} />
        </div>

        {/* Stake refund / withheld panel */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "14px 16px", borderRadius: 14,
          background: refunded ? "rgba(16,185,129,0.10)" : "rgba(239,68,68,0.10)",
          border: `1px solid ${refunded ? "rgba(16,185,129,0.40)" : "rgba(239,68,68,0.40)"}`,
          marginBottom: 18, position: "relative", zIndex: 1,
        }}>
          <span style={{
            width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
            background: refunded ? "rgba(16,185,129,0.20)" : "rgba(239,68,68,0.20)",
            color: refunded ? "#34d399" : "#fca5a5",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>
            {refunded ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}
          </span>
          <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
            <div style={{ color: t.white, fontSize: 14, fontWeight: 800 }}>
              {refunded
                ? (refundOnChain ? "Stake refunded" : "Refund pending")
                : "Stake withheld"}
            </div>
            <div style={{
              fontSize: 11, color: t.textMuted, marginTop: 2,
              fontFamily: "var(--font-jetbrains-mono), monospace",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {refunded
                ? (refundOnChain
                    ? `${summary.refundTx.slice(0, 14)}…`
                    : "Settling on-chain shortly")
                : "Room flagged for violations"}
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: refunded ? "#34d399" : "#fca5a5",
                           fontFamily: "var(--font-jetbrains-mono), monospace" }}>
              {stakeAmt || "—"}
            </div>
            <div style={{ fontSize: 11, color: t.textMuted }}>${Number(stakeUsd || 0).toFixed(2)}</div>
          </div>
          <span style={{
            width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
            background: "linear-gradient(135deg, #a855f7, #60a5fa)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 800, fontSize: 14,
          }}>N</span>
        </div>

        {/* Recording replay (Day 19). The egress webhook lands the URL
            asynchronously, so on first render after /close it's typically
            still null — we show "processing" until the host reloads. */}
        {(room?.recording?.enabled || room?.recording?.startedAt) && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 14px", borderRadius: 12,
            background: "rgba(168,85,247,0.10)",
            border: "1px solid rgba(168,85,247,0.34)",
            marginBottom: 14, position: "relative", zIndex: 1,
            textAlign: "left",
          }}>
            <Radio size={16} color="#c084fc" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: t.white, fontSize: 13, fontWeight: 700 }}>
                {room?.recording?.url ? "Replay ready" : "Replay processing"}
              </div>
              <div style={{ color: t.textMuted, fontSize: 11, marginTop: 1 }}>
                {room?.recording?.url
                  ? "Audio recording stored — link below."
                  : "Egress finalizing; refresh in a minute."}
              </div>
            </div>
            {room?.recording?.url && (
              <a href={room.recording.url} target="_blank" rel="noreferrer" style={{
                fontSize: 12, fontWeight: 800,
                padding: "6px 10px", borderRadius: 999,
                background: "rgba(168,85,247,0.20)",
                border: "1px solid rgba(168,85,247,0.45)",
                color: "#e9d5ff", textDecoration: "none",
              }}>Listen</a>
            )}
          </div>
        )}

        {/* Back to rooms */}
        <button onClick={onClose} style={{
          width: "100%", padding: "14px 18px", borderRadius: 14,
          background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
          color: "#1a0f00", border: "none",
          fontSize: 15, fontWeight: 800,
          cursor: "pointer", letterSpacing: 0.2,
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 10,
          boxShadow: "0 14px 36px rgba(245,158,11,0.45)",
          position: "relative", zIndex: 1,
        }}>
          <ArrowLeft size={16} /> Back to rooms
        </button>
      </div>
    </div>
  );
}

function Confetti() {
  // 14 colored specks scattered around the modal — purely decorative.
  const pieces = [
    { l: "8%",  t: "12%", r: 12, c: "#a855f7" },
    { l: "18%", t: "32%", r: -8, c: "#fbbf24" },
    { l: "12%", t: "60%", r: 4,  c: "#ec4899" },
    { l: "22%", t: "78%", r: 0,  c: "#a855f7" },
    { l: "32%", t: "10%", r: 18, c: "#fbbf24" },
    { l: "44%", t: "82%", r: -4, c: "#60a5fa" },
    { l: "58%", t: "8%",  r: -10,c: "#ec4899" },
    { l: "62%", t: "30%", r: 8,  c: "#fbbf24" },
    { l: "70%", t: "55%", r: 14, c: "#a855f7" },
    { l: "82%", t: "78%", r: -6, c: "#f59e0b" },
    { l: "88%", t: "20%", r: 0,  c: "#a855f7" },
    { l: "92%", t: "48%", r: 22, c: "#fbbf24" },
    { l: "76%", t: "12%", r: -16,c: "#60a5fa" },
    { l: "5%",  t: "82%", r: 30, c: "#ec4899" },
  ];
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0 }}>
      {pieces.map((p, i) => (
        <span key={i} style={{
          position: "absolute", left: p.l, top: p.t,
          width: 7, height: 11, background: p.c,
          borderRadius: 2, transform: `rotate(${p.r}deg)`,
          opacity: 0.85,
        }} />
      ))}
    </div>
  );
}

function SummaryStat({ t, label, value, Icon }) {
  return (
    <div style={{
      padding: "16px 12px", borderRadius: 14,
      background: t.bgSurface, border: `1px solid ${t.border}`,
      display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
    }}>
      <span style={{
        width: 36, height: 36, borderRadius: "50%",
        background: "rgba(168,85,247,0.16)", color: "#c4b8ff",
        border: "1px solid rgba(168,85,247,0.36)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}>
        {Icon ? <Icon size={16} /> : null}
      </span>
      <div style={{ color: t.white, fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{value}</div>
      <div style={{ color: t.textMuted, fontSize: 11.5 }}>{label}</div>
    </div>
  );
}

function btnPrimary(t) {
  return {
    padding: "8px 14px", background: t.amber, color: "#000", border: "none",
    borderRadius: 999, cursor: "pointer", fontSize: 12, fontWeight: 800,
    display: "inline-flex", alignItems: "center", gap: 6,
  };
}
function btnGhost(t) {
  return {
    padding: "6px 10px", background: "transparent", color: t.text,
    border: `1px solid ${t.border}`, borderRadius: 999, cursor: "pointer",
    fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4,
  };
}
function btnDanger(t) {
  return {
    padding: "6px 10px", background: "#ef444418", color: "#fca5a5",
    border: "1px solid #ef444466", borderRadius: 999, cursor: "pointer",
    fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4,
  };
}
function ShareAlphaPanel({ t }) {
  return (
    <div style={{
      position: "relative", overflow: "hidden",
      background: `linear-gradient(180deg, rgba(168,85,247,0.10), ${t.bgCard})`,
      border: "1px solid rgba(168,85,247,0.32)",
      borderRadius: 14, padding: "20px 16px",
      textAlign: "center",
    }}>
      <div aria-hidden style={{
        position: "absolute", inset: 0, opacity: 0.6, pointerEvents: "none",
        backgroundImage: "radial-gradient(circle at 22% 30%, rgba(168,85,247,0.20) 1.2px, transparent 1.6px), radial-gradient(circle at 70% 70%, rgba(96,165,250,0.20) 1.2px, transparent 1.6px), radial-gradient(circle at 80% 22%, rgba(168,85,247,0.18) 1.2px, transparent 1.6px)",
      }} />
      <div style={{ position: "relative", zIndex: 1 }}>
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 56, height: 56, borderRadius: 14, marginBottom: 10,
          background: "linear-gradient(135deg, rgba(168,85,247,0.30), rgba(168,85,247,0.10))",
          border: "1px solid rgba(168,85,247,0.45)",
          color: "#c4b8ff",
          boxShadow: "0 0 30px rgba(168,85,247,0.30)",
        }}>
          <Sparkles size={26} strokeWidth={2.4} />
        </span>
        <div style={{ color: t.white, fontSize: 17, fontWeight: 800, margin: "4px 0 6px" }}>
          Share Alpha. Earn Together.
        </div>
        <div style={{ color: t.textMuted, fontSize: 12, lineHeight: 1.5, marginBottom: 14 }}>
          Alpha calls can earn <span style={{ color: "#c4b8ff", fontWeight: 700 }}>revenue-share</span><br />
          points for all active speakers.
        </div>
        <SAItem t={t} Icon={ShieldCheck} title="Speak to earn"   body="Get rewarded for sharing valuable alpha." />
        <SAItem t={t} Icon={UserPlus}    title="Invite & grow"   body="More speakers, more rewards for everyone." />
        <SAItem t={t} Icon={ShieldCheck} title="Built on NEAR"   body="Secure, decentralized and community owned." />
      </div>
    </div>
  );
}

function SAItem({ t, Icon, title, body }) {
  return (
    <div style={{
      display: "flex", gap: 10, alignItems: "flex-start",
      padding: "8px 10px", borderRadius: 10,
      background: "rgba(255,255,255,0.02)",
      border: `1px solid rgba(168,85,247,0.18)`,
      marginBottom: 8, textAlign: "left",
    }}>
      <span style={{
        width: 30, height: 30, borderRadius: 9, flexShrink: 0,
        background: "rgba(168,85,247,0.16)", color: "#c4b8ff",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon size={14} />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ color: t.white, fontSize: 12.5, fontWeight: 700 }}>{title}</div>
        <div style={{ color: t.textMuted, fontSize: 11, marginTop: 2, lineHeight: 1.4 }}>{body}</div>
      </div>
    </div>
  );
}

function btnPill(t) {
  return {
    padding: "8px 14px", background: t.bgSurface, color: t.white,
    border: `1px solid ${t.border}`, borderRadius: 999, cursor: "pointer",
    fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6,
  };
}
function btnEndRoom(t) {
  return {
    padding: "8px 14px", background: "transparent", color: "#fca5a5",
    border: "1px solid rgba(239,68,68,0.5)", borderRadius: 999, cursor: "pointer",
    fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6,
  };
}
function btnTiny(t) {
  return {
    padding: "3px 6px", background: "transparent", color: t.text,
    border: `1px solid ${t.border}`, borderRadius: 6, cursor: "pointer",
    fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 2,
  };
}
