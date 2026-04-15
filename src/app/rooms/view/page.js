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
} from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import LiveStage from "@/components/LiveStage";

const API = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

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
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center",
      background: "#080b12", color: "#94a3b8" }}>Loading room…</div>
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
  const [muted, setMuted]               = useState(true);
  const [handRaised, setHandRaised]     = useState(false);
  const [draftMsg, setDraftMsg]         = useState("");
  const [sending, setSending]           = useState(false);
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
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs.length]);

  const join = async (role = "listener") => {
    if (!wallet) { openWallet(); return; }
    try {
      const r = await fetch(`${API}/api/rooms/${roomId}/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": wallet },
        body: JSON.stringify({ role }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `join ${r.status}`);
      setMyRole(j.role);
      setJoined(true);
      loadRoom();
    } catch (e) { alert(e?.message || "Couldn't join"); }
  };

  const leave = async () => {
    if (!wallet) return;
    try {
      await fetch(`${API}/api/rooms/${roomId}/leave`, {
        method: "POST", headers: { "x-wallet": wallet },
      });
    } catch {}
    if (typeof window !== "undefined") window.location.href = "/rooms/";
  };

  const toggleHand = async () => {
    if (!wallet || !joined) return;
    const next = !handRaised;
    setHandRaised(next);
    try {
      await fetch(`${API}/api/rooms/${roomId}/raise`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-wallet": wallet },
        body: JSON.stringify({ raised: next }),
      });
    } catch {}
  };

  const send = async (isAlphaCall = false) => {
    if (!wallet || !joined || !draftMsg.trim() || sending) return;
    setSending(true);
    try {
      const r = await fetch(`${API}/api/rooms/${roomId}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-wallet": wallet },
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
      await fetch(`${API}/api/rooms/${roomId}/messages/${msgId}/vote`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-wallet": wallet },
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
      await fetch(`${API}/api/rooms/${roomId}/promote`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-wallet": wallet },
        body: JSON.stringify({ userId, role }),
      });
      loadRoom();
    } catch {}
  };

  const kick = async (userId) => {
    if (!wallet || !isHost) return;
    if (!confirm("Remove this participant?")) return;
    try {
      await fetch(`${API}/api/rooms/${roomId}/kick`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-wallet": wallet },
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
      const r = await fetch(`${API}/api/rooms/${roomId}/close`, {
        method: "POST", headers: { "x-wallet": wallet },
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "close failed");
      setClosedSummary({ ...j.summary, refundTx: j.refundTx });
    } catch (e) { alert(e?.message || "Couldn't close"); }
    finally { setClosing(false); }
  };

  if (loading) return <Loading />;
  if (error || !room) {
    return (
      <div style={{ minHeight: "100vh", background: t.bg, color: t.text,
        display: "grid", placeItems: "center", padding: 24 }}>
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
    <div style={{ minHeight: "100vh", background: t.bg, color: t.text }}>
      <nav aria-hidden style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 }} />

      {/* Top bar */}
      <div style={{
        padding: "12px 18px", borderBottom: `1px solid ${t.border}`, background: t.bgCard,
        position: "sticky", top: 0, zIndex: 10,
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <a href="/rooms/" style={{ color: t.text, display: "inline-flex", alignItems: "center", gap: 4, textDecoration: "none" }}>
          <ArrowLeft size={18} /> <span style={{ fontSize: 14 }}>Rooms</span>
        </a>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 800,
          color: "#ef4444", padding: "2px 6px", borderRadius: 6,
          background: "#ef444418", border: "1px solid #ef444444",
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444",
            boxShadow: "0 0 6px #ef4444", animation: "ixPulse 1.2s ease-in-out infinite" }} /> LIVE
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: t.white, fontSize: 14, fontWeight: 700,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {room.title}
          </div>
          <div style={{ color: t.textMuted, fontSize: 11 }}>
            {room.topic || "—"} · ends in {timeLeft(room.endsAt)}
          </div>
        </div>
        <span title={`Bot threat ${room.counts.botThreat}/100`} style={{
          display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700,
          color: botColor(room.counts.botThreat),
        }}>
          <ShieldAlert size={13} /> {room.counts.botThreat}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4,
          color: t.amber, fontSize: 11, fontWeight: 700 }}>
          <Coins size={11} /> ${Math.round(room.stake.amountUsd)}
        </span>
        {!connected ? (
          <button onClick={openWallet} style={btnPrimary(t)}>Connect</button>
        ) : !joined ? (
          <button onClick={() => join("listener")} style={btnPrimary(t)}>Join</button>
        ) : (
          <button onClick={leave} style={btnGhost(t)}>
            <DoorOpen size={14} /> Leave
          </button>
        )}
        {isHost && (
          <button onClick={closeRoom} disabled={closing} style={btnDanger(t)}>
            {closing ? <Loader2 size={14} className="ix-spin" /> : <X size={14} />} End room
          </button>
        )}
      </div>

      {/* Layout: stage+chat | participants */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16,
        padding: 16, maxWidth: 1280, margin: "0 auto",
        '@media (maxWidth: 800px)': { gridTemplateColumns: "1fr" } }}>
        {/* Main column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          {/* Voice stage */}
          <LiveStage
            t={t} room={room} roomId={roomId} wallet={wallet}
            joined={joined} myRole={myRole}
            speakers={speakers}
            voiceEnabled={room.voiceEnabled}
            muted={muted} setMuted={setMuted}
            handRaised={handRaised} onToggleHand={toggleHand}
          />

          {/* Chat */}
          <section style={{
            background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
            padding: 14, display: "flex", flexDirection: "column", minHeight: 360,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Sparkles size={14} color={t.amber} />
              <span style={{ color: t.white, fontWeight: 700, fontSize: 13 }}>Chat</span>
              <span style={{ color: t.textDim, fontSize: 11 }}>· alpha calls earn revenue-share points</span>
            </div>
            <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column",
              gap: 8, paddingRight: 4, maxHeight: 460 }}>
              {msgs.map(m => (
                <ChatMessage key={m.id} t={t} m={m} onVote={voteAlpha} />
              ))}
              {msgs.length === 0 && (
                <div style={{ padding: 24, textAlign: "center", color: t.textMuted, fontSize: 12 }}>
                  No messages yet. Be the first to drop alpha.
                </div>
              )}
              <div ref={chatEnd} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input
                value={draftMsg}
                onChange={e => setDraftMsg(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(false); } }}
                disabled={!joined || sending}
                placeholder={joined ? "Say something… or call alpha 🪙" : "Join the room to chat"}
                maxLength={500}
                style={{ flex: 1, padding: "10px 12px", borderRadius: 10,
                  background: t.bgSurface, border: `1px solid ${t.border}`,
                  color: t.text, fontSize: 13, outline: "none" }}
              />
              <button onClick={() => send(true)} disabled={!joined || sending || !draftMsg.trim()}
                title="Mark as alpha call"
                style={{ ...btnGhost(t), color: t.amber, borderColor: `${t.amber}66` }}>
                <Sparkles size={14} /> Alpha
              </button>
              <button onClick={() => send(false)} disabled={!joined || sending || !draftMsg.trim()}
                style={btnPrimary(t)}>
                {sending ? <Loader2 size={14} className="ix-spin" /> : <Send size={14} />}
              </button>
            </div>
          </section>
        </div>

        {/* Participants sidebar */}
        <aside style={{
          background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
          padding: 14, height: "fit-content", position: "sticky", top: 80,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <Users size={14} color={t.amber} />
            <span style={{ color: t.white, fontWeight: 700, fontSize: 13 }}>Participants</span>
            <span style={{ color: t.textDim, fontSize: 11 }}>· {parts.length}</span>
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
              <div style={{ padding: 8, color: t.textDim, fontSize: 11, textAlign: "center" }}>
                No listeners yet.
              </div>
            )}
          </Section>
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
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", backdropFilter: "blur(6px)",
      display: "grid", placeItems: "center", zIndex: 100, padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 420, background: t.bgCard, borderRadius: 16,
        border: `1px solid ${t.border}`, padding: 20, textAlign: "center" }}>
        <Radio size={32} color={t.amber} style={{ marginBottom: 8 }} />
        <h2 style={{ color: t.white, margin: "0 0 4px", fontSize: 20 }}>Room ended</h2>
        <p style={{ color: t.textMuted, fontSize: 13, margin: "0 0 16px" }}>
          Thanks for hosting <strong>{room.title}</strong>.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 16 }}>
          <SummaryStat t={t} label="Participants" value={summary.totalParticipants} />
          <SummaryStat t={t} label="Speakers" value={summary.totalSpeakers} />
          <SummaryStat t={t} label="Alpha calls" value={summary.alphaCalls} />
        </div>
        {summary.refundTx ? (
          <div style={{ padding: "10px 12px", borderRadius: 10, background: "#22c55e18",
            border: "1px solid #22c55e44", color: "#86efac", fontSize: 12, marginBottom: 12 }}>
            ✅ Stake refunded ({summary.refundTx.slice(0, 14)}…)
          </div>
        ) : (
          <div style={{ padding: "10px 12px", borderRadius: 10, background: "#ef444418",
            border: "1px solid #ef444444", color: "#fca5a5", fontSize: 12, marginBottom: 12 }}>
            ⚠ Stake withheld (room flagged for violations).
          </div>
        )}
        <button onClick={onClose} style={{ ...btnPrimary(t), width: "100%" }}>Back to rooms</button>
      </div>
    </div>
  );
}

function SummaryStat({ t, label, value }) {
  return (
    <div style={{ padding: 10, background: t.bgSurface, borderRadius: 10, border: `1px solid ${t.border}` }}>
      <div style={{ color: t.white, fontSize: 18, fontWeight: 800 }}>{value}</div>
      <div style={{ color: t.textMuted, fontSize: 10 }}>{label}</div>
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
function btnTiny(t) {
  return {
    padding: "3px 6px", background: "transparent", color: t.text,
    border: `1px solid ${t.border}`, borderRadius: 6, cursor: "pointer",
    fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 2,
  };
}
