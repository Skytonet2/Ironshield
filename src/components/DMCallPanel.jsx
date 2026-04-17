"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Mic, MicOff, PhoneOff, Radio } from "lucide-react";

const API = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

let LK = null;
let LK_FAILED = false;

async function loadLiveKit() {
  if (LK) return LK;
  if (LK_FAILED) return null;
  try {
    const [client, react] = await Promise.all([
      import("livekit-client"),
      import("@livekit/components-react"),
    ]);
    LK = { client, react };
    return LK;
  } catch (e) {
    console.warn("[DMCallPanel] LiveKit deps unavailable:", e?.message);
    LK_FAILED = true;
    return null;
  }
}

function initials(peer) {
  return (peer?.displayName || peer?.username || peer?.wallet || "?")[0]?.toUpperCase();
}

function Avatar({ peer, size = 88, border }) {
  if (peer?.pfpUrl) {
    return (
      <img
        src={peer.pfpUrl}
        alt=""
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(135deg, #3b82f6, #0ea5e9)",
        color: "#fff",
        fontWeight: 800,
        fontSize: Math.floor(size * 0.34),
        border,
      }}
    >
      {initials(peer)}
    </div>
  );
}

function shortWallet(wallet = "") {
  return wallet.length > 18 ? `${wallet.slice(0, 8)}…${wallet.slice(-6)}` : wallet;
}

function CallStage({ lk, tokenInfo, t, wallet, peer, muted, setMuted }) {
  const { LiveKitRoom, RoomAudioRenderer, useParticipants, useLocalParticipant } = lk.react;
  return (
    <LiveKitRoom token={tokenInfo.token} serverUrl={tokenInfo.url} audio={true} video={false} connect={true}>
      <RoomAudioRenderer />
      <CallInner
        useParticipants={useParticipants}
        useLocalParticipant={useLocalParticipant}
        t={t}
        wallet={wallet}
        peer={peer}
        muted={muted}
        setMuted={setMuted}
      />
    </LiveKitRoom>
  );
}

function CallInner({ useParticipants, useLocalParticipant, t, wallet, peer, muted, setMuted }) {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();

  useEffect(() => {
    if (!localParticipant) return;
    localParticipant.setMicrophoneEnabled(!muted).catch(() => setMuted(true));
  }, [localParticipant, muted, setMuted]);

  const byIdentity = useMemo(() => {
    const map = new Map();
    for (const participant of participants) {
      map.set(String(participant.identity).toLowerCase(), participant);
    }
    return map;
  }, [participants]);

  const me = byIdentity.get(String(wallet || "").toLowerCase());
  const remote = byIdentity.get(String(peer?.wallet || "").toLowerCase());

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
        {[{
          label: "You",
          peer: { displayName: "You", wallet },
          active: !!me,
          speaking: !!me?.isSpeaking,
          muted: !me?.isMicrophoneEnabled,
        }, {
          label: peer?.displayName || peer?.username || "Peer",
          peer,
          active: !!remote,
          speaking: !!remote?.isSpeaking,
          muted: remote ? !remote.isMicrophoneEnabled : false,
        }].map((item) => {
          const border = `2px solid ${item.speaking ? t.green : item.active ? t.accent : t.border}`;
          return (
            <div
              key={item.label}
              style={{
                border: `1px solid ${t.border}`,
                borderRadius: 18,
                padding: 18,
                background: item.active ? `${t.accent}10` : t.bgSurface,
                textAlign: "center",
              }}
            >
              <Avatar peer={item.peer} border={border} />
              <div style={{ marginTop: 12, color: t.white, fontWeight: 800, fontSize: 16 }}>{item.label}</div>
              <div style={{ marginTop: 4, color: t.textDim, fontSize: 12 }}>
                {item.active ? (item.speaking ? "Speaking" : "Connected") : "Waiting to join"}
              </div>
              <div style={{ marginTop: 8, color: item.muted ? t.red : t.textMuted, fontSize: 11 }}>
                {item.muted ? "Mic muted" : shortWallet(item.peer?.wallet || "")}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ color: t.textDim, fontSize: 12, textAlign: "center" }}>
        Voice is routed through LiveKit while IronClaw keeps the DM workflow on-site.
      </div>
    </div>
  );
}

export default function DMCallPanel({ open, t, wallet, conversationId, peer, onClose }) {
  const [tokenInfo, setTokenInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [lk, setLk] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!open || !wallet || !conversationId) return;
    setLoading(true);
    setError("");
    setTokenInfo(null);
    setMuted(false);

    (async () => {
      try {
        const r = await fetch(`${API}/api/dm/${conversationId}/call-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-wallet": wallet },
          body: JSON.stringify({}),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `token ${r.status}`);
        if (cancelled) return;
        setTokenInfo(j);
        if (!j.mocked) {
          const mod = await loadLiveKit();
          if (!cancelled) setLk(mod);
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || "Could not start call");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [conversationId, open, wallet]);

  if (!open) return null;

  const isReal = tokenInfo && !tokenInfo.mocked && lk;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 120,
        background: "rgba(0,0,0,.72)",
        backdropFilter: "blur(8px)",
        display: "grid",
        placeItems: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 720,
          background: t.bgCard,
          border: `1px solid ${t.border}`,
          borderRadius: 24,
          padding: 22,
          boxShadow: "0 24px 80px rgba(0,0,0,.55)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              background: `${t.accent}22`,
              color: t.accent,
            }}
          >
            <Radio size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ color: t.white, fontSize: 18, fontWeight: 800 }}>
              Call with {peer?.displayName || peer?.username || shortWallet(peer?.wallet || "")}
            </div>
            <div style={{ color: t.textDim, fontSize: 12 }}>
              {loading ? "Starting secure voice room…" : isReal ? "Live voice connected" : "Call room ready"}
            </div>
          </div>
        </div>

        {loading && (
          <div style={{ padding: "34px 0", textAlign: "center", color: t.textMuted }}>
            <Loader2 size={22} className="ix-spin" />
          </div>
        )}

        {!loading && error && (
          <div
            style={{
              padding: 14,
              borderRadius: 14,
              border: `1px solid ${t.red}66`,
              background: `${t.red}12`,
              color: "#fca5a5",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && tokenInfo?.mocked && (
          <div
            style={{
              borderRadius: 18,
              border: `1px solid ${t.border}`,
              background: t.bgSurface,
              padding: 22,
              display: "grid",
              gap: 14,
              justifyItems: "center",
            }}
          >
            <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
              <Avatar peer={{ displayName: "You", wallet }} border={`2px solid ${t.accent}`} />
              <div style={{ color: t.textDim, fontSize: 12 }}>Calling</div>
              <Avatar peer={peer} border={`2px solid ${t.border}`} />
            </div>
            <div style={{ color: t.white, fontWeight: 700 }}>LiveKit preview mode</div>
            <div style={{ color: t.textMuted, fontSize: 13, textAlign: "center", maxWidth: 460 }}>
              The DM call UI is wired up, but this environment still needs `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and
              `LIVEKIT_API_SECRET` for real audio.
            </div>
          </div>
        )}

        {!loading && !error && isReal && (
          <CallStage lk={lk} tokenInfo={tokenInfo} t={t} wallet={wallet} peer={peer} muted={muted} setMuted={setMuted} />
        )}

        <div style={{ display: "flex", justifyContent: "center", gap: 10, marginTop: 22 }}>
          <button
            onClick={() => setMuted((m) => !m)}
            disabled={!isReal}
            style={{
              width: 46,
              height: 46,
              borderRadius: "50%",
              border: `1px solid ${muted ? `${t.red}66` : t.border}`,
              background: muted ? `${t.red}16` : t.bgSurface,
              color: muted ? t.red : t.text,
              cursor: isReal ? "pointer" : "not-allowed",
              opacity: isReal ? 1 : 0.55,
              display: "grid",
              placeItems: "center",
            }}
          >
            {muted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
          <button
            onClick={onClose}
            style={{
              minWidth: 140,
              height: 46,
              borderRadius: 999,
              border: "none",
              background: "#ef4444",
              color: "#fff",
              fontWeight: 800,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <PhoneOff size={16} /> End call
          </button>
        </div>
        <style>{`.ix-spin { animation: ixSpin 1s linear infinite; } @keyframes ixSpin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
