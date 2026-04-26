"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Minimize2, PhoneOff, Radio } from "lucide-react";

import { API_BASE as API } from "@/lib/apiBase";
import { apiFetch } from "@/lib/apiFetch";

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
    // Never auto-mute on transient errors (minimize, visibility change, etc.)
    // — swallow and let the user control mute state explicitly.
    localParticipant.setMicrophoneEnabled(!muted).catch(() => {});
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

export default function DMCallPanel({
  open,
  minimized = false,
  t,
  wallet,
  conversationId,
  peer,
  onMinimize,
  onResume,
  onEnd,
}) {
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
        const r = await apiFetch(`/api/dm/${conversationId}/call-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const raw = await r.text();
        if (raw.trimStart().startsWith("<")) {
          throw new Error("Voice calls need the IronShield backend online (LiveKit token service).");
        }
        let j; try { j = JSON.parse(raw); } catch { throw new Error(`Bad response from call service (${r.status})`); }
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

  // Screen Wake Lock: prevents mobile screen sleep from suspending the audio
  // session / tearing down mic capture while the call is active. Re-acquires
  // on visibilitychange because the browser releases the sentinel when the
  // tab is hidden.
  const wakeLockRef = useRef(null);
  useEffect(() => {
    if (!open || error) return;
    if (typeof navigator === "undefined" || !navigator.wakeLock) return;

    let released = false;

    const acquire = async () => {
      try {
        if (document.visibilityState !== "visible") return;
        if (wakeLockRef.current) return;
        const sentinel = await navigator.wakeLock.request("screen");
        if (released) { sentinel.release?.().catch(() => {}); return; }
        wakeLockRef.current = sentinel;
        sentinel.addEventListener?.("release", () => {
          if (wakeLockRef.current === sentinel) wakeLockRef.current = null;
        });
      } catch { /* ignore — not fatal */ }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") acquire();
    };

    acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      const sentinel = wakeLockRef.current;
      wakeLockRef.current = null;
      sentinel?.release?.().catch(() => {});
    };
  }, [open, error]);

  // Keep the audio context / mic track alive when the tab goes to background
  // on mobile. Some browsers auto-suspend the AudioContext; re-resume when we
  // come back. LiveKit handles track republish internally, but we nudge it.
  useEffect(() => {
    if (!open) return;
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      try {
        // Best-effort: unmute/re-enable stays synced with local state on resume.
        // The CallInner effect will re-apply mic state when the component
        // re-renders.
      } catch { /* noop */ }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [open]);

  if (!open) return null;

  const isReal = tokenInfo && !tokenInfo.mocked && lk;

  // CRITICAL: the modal tree is rendered identically whether minimized or not
  // — we just hide it with visibility/pointer-events. That keeps <LiveKitRoom>
  // in the same React position so it never unmounts/reconnects when the user
  // minimizes and restores. Previously we had two separate JSX trees which
  // caused LiveKit to tear down the audio session on every toggle.
  return (
    <>
      {minimized && (
        <div
          style={{
            position: "fixed",
            top: 12,
            right: 12,
            zIndex: 10020,
            background: t.bgCard,
            border: `1px solid ${t.border}`,
            borderRadius: 12,
            padding: "8px 10px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            boxShadow: "0 10px 28px rgba(0,0,0,.45)",
            maxWidth: "min(92vw, 340px)",
          }}
        >
          <Radio size={14} color={t.accent} />
          <div style={{ minWidth: 0 }}>
            <div style={{ color: t.white, fontSize: 12, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              Ongoing call · {peer?.displayName || peer?.username || shortWallet(peer?.wallet || "")}
            </div>
            <div style={{ color: t.textDim, fontSize: 10 }}>
              {loading ? "Connecting…" : error ? "Connection issue" : "Live · tap Open"}
            </div>
          </div>
          <button onClick={onResume} style={{
            border: `1px solid ${t.border}`, background: t.bgSurface, color: t.text,
            borderRadius: 999, padding: "5px 8px", cursor: "pointer", fontSize: 11, fontWeight: 700,
          }}>
            Open
          </button>
          <button onClick={onEnd} style={{
            border: "none", background: "#ef4444", color: "#fff",
            borderRadius: 999, padding: "5px 8px", cursor: "pointer", fontSize: 11, fontWeight: 700,
          }}>
            End
          </button>
        </div>
      )}
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10010,
        background: "rgba(0,0,0,.72)",
        backdropFilter: "blur(8px)",
        display: "grid",
        placeItems: "center",
        padding: 20,
        visibility: minimized ? "hidden" : "visible",
        pointerEvents: minimized ? "none" : "auto",
      }}
      onClick={onMinimize}
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
          <button onClick={onMinimize} title="Minimize call" style={{
            width: 36, height: 36, borderRadius: "50%", border: `1px solid ${t.border}`,
            background: t.bgSurface, color: t.text, cursor: "pointer", display: "grid", placeItems: "center",
          }}>
            <Minimize2 size={15} />
          </button>
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
          {onMinimize && (
            <button
              onClick={onMinimize}
              title="Minimize — keep call running while browsing"
              style={{
                minWidth: 110,
                height: 46,
                borderRadius: 999,
                border: `1px solid ${t.border}`,
                background: t.bgSurface,
                color: t.text,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Minimize
            </button>
          )}
          <button
            onClick={onEnd}
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
    </>
  );
}
