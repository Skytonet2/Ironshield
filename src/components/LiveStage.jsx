"use client";
// LiveStage — real LiveKit voice stage with graceful mocked fallback.
//
// When the backend's /api/livekit/token returns `mocked: true` (i.e. LIVEKIT_API_KEY
// isn't set in the deploy), this renders the visual-only stage already used in
// the room interior. When real LiveKit creds are present, it wraps the stage in
// a <LiveKitRoom> that connects via livekit-client, subscribes to remote audio
// tracks, and surfaces real `isSpeaking` state per participant.
//
// Participant identity = wallet address (set in livekit.route.js). We cross-
// reference DB participants by wallet → LK participant for speaking + mic state.

import { useEffect, useMemo, useState } from "react";
import { Mic, MicOff, Crown, ShieldAlert, Hand, Loader2 } from "lucide-react";

import { API_BASE as API } from "@/lib/apiBase";
import { apiFetch } from "@/lib/apiFetch";

// Lazy-loaded so static export doesn't pull livekit-client into every bundle.
// Wrapped in try/catch so deploys without livekit-client installed still build —
// the stage falls through to the visual-only mock in that case.
let LK = null;
let LK_FAILED = false;
async function loadLiveKit() {
  if (LK) return LK;
  if (LK_FAILED) return null;
  try {
    // Normal dynamic imports — packages are in package.json. Turbopack
    // creates separate chunks so they don't bloat the main bundle.
    const [client, react] = await Promise.all([
      import("livekit-client"),
      import("@livekit/components-react"),
    ]);
    LK = { client, react };
    return LK;
  } catch (e) {
    console.warn("[LiveStage] LiveKit deps not available — falling back to mock stage:", e?.message);
    LK_FAILED = true;
    return null;
  }
}

function shortWallet(w = "") { return w?.length > 18 ? `${w.slice(0, 8)}…${w.slice(-6)}` : (w || ""); }
function botColor(s) { return s >= 70 ? "#ef4444" : s >= 40 ? "#f59e0b" : "#22c55e"; }
function initials(p) { return (p.displayName || p.username || p.wallet || "?")[0]?.toUpperCase(); }

export default function LiveStage({
  t, room, roomId, wallet, joined, myRole, speakers, voiceEnabled, accessType,
  muted, setMuted, handRaised, onToggleHand, onRequestMic,
}) {
  const [tokenInfo, setTokenInfo] = useState(null);
  const [tokenErr, setTokenErr]   = useState(null);
  const [lk, setLk]               = useState(null);

  // Mint a LiveKit token whenever we're an active participant in a voice room.
  useEffect(() => {
    let cancelled = false;
    setTokenInfo(null); setTokenErr(null);
    if (!joined || !wallet || !voiceEnabled) return;
    (async () => {
      try {
        const r = await apiFetch(`/api/livekit/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId }),
        });
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok) { setTokenErr(j.error || `token ${r.status}`); return; }
        setTokenInfo(j);
        if (!j.mocked) {
          const mod = await loadLiveKit();
          if (!cancelled) setLk(mod);   // null → silently fall back to mock grid
        }
      } catch (e) {
        if (!cancelled) setTokenErr(e?.message || "token fetch failed");
      }
    })();
    return () => { cancelled = true; };
  }, [roomId, wallet, joined, voiceEnabled, myRole]);

  const real = tokenInfo && !tokenInfo.mocked && lk;

  return (
    <section style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14, padding: 16,
    }}>
      <Header
        t={t} speakersCount={speakers.length} voiceEnabled={voiceEnabled}
        joined={joined} myRole={myRole} accessType={accessType}
        muted={muted} setMuted={setMuted}
        handRaised={handRaised} onToggleHand={onToggleHand}
        onRequestMic={onRequestMic}
        connecting={joined && voiceEnabled && !tokenInfo && !tokenErr}
        mocked={tokenInfo?.mocked}
        error={tokenErr}
      />

      {real ? (
        <RealStage
          lk={lk}
          tokenInfo={tokenInfo}
          t={t} speakers={speakers} wallet={wallet}
          muted={muted} setMuted={setMuted}
        />
      ) : (
        <Grid t={t} speakers={speakers}>
          {speakers.map(p => (
            <Tile key={p.id} t={t} p={p}
              isMe={wallet?.toLowerCase() === p.wallet?.toLowerCase()}
              speaking={false}
              micOff={wallet?.toLowerCase() === p.wallet?.toLowerCase() ? muted : false}
            />
          ))}
        </Grid>
      )}
    </section>
  );
}

// ─── Header (controls + status) ────────────────────────────────────────
function Header({ t, speakersCount, voiceEnabled, joined, myRole, accessType, muted, setMuted,
                  handRaised, onToggleHand, onRequestMic, connecting, mocked, error }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
      <Mic size={14} color={t.amber} />
      <span style={{ color: t.white, fontWeight: 700, fontSize: 13 }}>Voice stage</span>
      <span style={{ color: t.textDim, fontSize: 11 }}>· {speakersCount} speaker{speakersCount === 1 ? "" : "s"}</span>
      {!voiceEnabled && (<span style={{ color: t.textMuted, fontSize: 11 }}>· text-only room</span>)}
      {voiceEnabled && connecting && (
        <span style={{ color: t.textMuted, fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Loader2 size={11} className="ix-spin" /> connecting voice…
        </span>
      )}
      {mocked && (<span style={{ color: t.textDim, fontSize: 10, fontStyle: "italic" }}>· voice mock (LiveKit not configured)</span>)}
      {error && (<span style={{ color: "#fca5a5", fontSize: 11 }}>· {error}</span>)}
      <div style={{ flex: 1 }} />
      {joined && voiceEnabled && (myRole === "host" || myRole === "speaker") && (
        <button onClick={() => setMuted(m => !m)} style={{
          padding: "6px 10px", background: "transparent",
          border: `1px solid ${muted ? "#ef444466" : "#22c55e66"}`,
          borderRadius: 999, cursor: "pointer", fontSize: 12, fontWeight: 700,
          color: muted ? "#ef4444" : "#22c55e",
          display: "inline-flex", alignItems: "center", gap: 4,
        }}>
          {muted ? <MicOff size={13} /> : <Mic size={13} />}
          {muted ? "Muted" : "Live"}
        </button>
      )}
      {joined && myRole === "listener" && voiceEnabled && (
        accessType === "open" ? (
          <button onClick={onRequestMic} style={{
            padding: "6px 10px", background: "#22c55e22",
            border: `1px solid #22c55e66`,
            borderRadius: 999, cursor: "pointer", fontSize: 12, fontWeight: 700,
            color: "#22c55e",
            display: "inline-flex", alignItems: "center", gap: 4,
          }}>
            <Mic size={13} /> Request mic
          </button>
        ) : (
          <button onClick={onToggleHand} style={{
            padding: "6px 10px", background: "transparent",
            border: `1px solid ${handRaised ? `${t.amber}88` : t.border}`,
            borderRadius: 999, cursor: "pointer", fontSize: 12, fontWeight: 700,
            color: handRaised ? t.amber : t.text,
            display: "inline-flex", alignItems: "center", gap: 4,
          }}>
            <Hand size={13} /> {handRaised ? "Hand raised" : "Raise hand"}
          </button>
        )
      )}
    </div>
  );
}

// ─── Real LiveKit stage ────────────────────────────────────────────────
function RealStage({ lk, tokenInfo, t, speakers, wallet, muted, setMuted }) {
  const { LiveKitRoom, RoomAudioRenderer, useParticipants, useLocalParticipant }
    = lk.react;
  const canPublish = tokenInfo.role === "host" || tokenInfo.role === "speaker";

  return (
    <LiveKitRoom
      token={tokenInfo.token}
      serverUrl={tokenInfo.url}
      audio={canPublish}
      video={false}
      connect={true}
      style={{ height: "auto" }}
    >
      <RoomAudioRenderer />
      <StageInner
        useParticipants={useParticipants}
        useLocalParticipant={useLocalParticipant}
        canPublish={canPublish}
        t={t} speakers={speakers} wallet={wallet} muted={muted} setMuted={setMuted}
      />
    </LiveKitRoom>
  );
}

function StageInner({ useParticipants, useLocalParticipant, canPublish, t, speakers, wallet, muted, setMuted }) {
  const lkParts  = useParticipants();
  const { localParticipant } = useLocalParticipant();

  // Sync local mic state with parent muted toggle — only if we can publish.
  useEffect(() => {
    if (!localParticipant || !canPublish) return;
    localParticipant.setMicrophoneEnabled(!muted).catch(() => {
      setMuted(true);
    });
  }, [muted, localParticipant, setMuted, canPublish]);

  // Map identity (wallet) → LiveKit participant for speaking-state lookup.
  const byIdentity = useMemo(() => {
    const m = new Map();
    for (const p of lkParts) m.set(String(p.identity).toLowerCase(), p);
    return m;
  }, [lkParts]);

  return (
    <Grid t={t} speakers={speakers}>
      {speakers.map(p => {
        const lkp = byIdentity.get(String(p.wallet || "").toLowerCase());
        const speaking = !!lkp?.isSpeaking;
        const micOff = lkp ? !lkp.isMicrophoneEnabled : false;
        return (
          <Tile key={p.id} t={t} p={p}
            isMe={wallet?.toLowerCase() === p.wallet?.toLowerCase()}
            speaking={speaking} micOff={micOff} />
        );
      })}
    </Grid>
  );
}

// ─── Shared visuals ────────────────────────────────────────────────────
function Grid({ t, speakers, children }) {
  return (
    <div style={{ display: "grid", gap: 14,
      gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}>
      {children}
      {speakers.length === 0 && (
        <div style={{ gridColumn: "1/-1", padding: 24, textAlign: "center",
          color: t.textMuted, fontSize: 12 }}>
          No one on the stage yet.
        </div>
      )}
    </div>
  );
}

function Tile({ t, p, isMe, speaking, micOff }) {
  const isHost = p.role === "host";
  const ringColor = speaking ? "#22c55e" : (isHost ? t.amber : t.border);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 0 }}>
      <div style={{ position: "relative" }}>
        {p.pfpUrl ? (
          <img src={p.pfpUrl} alt="" style={{
            width: 64, height: 64, borderRadius: "50%", objectFit: "cover",
            border: `2px solid ${ringColor}`,
            boxShadow: speaking ? `0 0 0 4px ${ringColor}33` : "none",
            transition: "box-shadow .15s, border-color .15s",
          }} />
        ) : (
          <div style={{
            width: 64, height: 64, borderRadius: "50%",
            background: `linear-gradient(135deg, ${t.accent}, #0ea5e9)`,
            display: "grid", placeItems: "center", color: "#fff", fontWeight: 800, fontSize: 22,
            border: `2px solid ${ringColor}`,
            boxShadow: speaking ? `0 0 0 4px ${ringColor}33` : "none",
            transition: "box-shadow .15s, border-color .15s",
          }}>
            {initials(p)}
          </div>
        )}
        {isHost && (
          <Crown size={14} color={t.amber} style={{ position: "absolute", top: -4, right: -4 }} fill={t.amber} />
        )}
        {micOff && (
          <div style={{ position: "absolute", bottom: -2, right: -2,
            background: t.bgCard, borderRadius: "50%", padding: 2, border: `1px solid ${t.border}` }}>
            <MicOff size={11} color="#ef4444" />
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: t.text, fontWeight: 600, maxWidth: 100,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {p.displayName || p.username || shortWallet(p.wallet)}{isMe ? " (you)" : ""}
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
