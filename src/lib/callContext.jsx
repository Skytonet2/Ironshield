"use client";
// Global call state — one LiveKit room lives above the page router so
// you can walk from Feed → Dashboard → Governance (and anywhere else in
// the SPA) without dropping the call. If there is an active call and you
// click an EXTERNAL route (e.g. /rooms/), the router opens it in a new
// tab so this tab keeps the connection alive.
//
// This file also hosts the inbound-ring layer. Web push on mobile tends
// to render call invites as regular-looking banners, so when a push with
// kind="call" arrives we also postMessage the foreground page; the
// overlay below takes over with a full-screen "Answer / Decline" UI and
// a synthesized ringback tone so the user can't miss the call.

import { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef } from "react";
import { Phone, PhoneOff } from "lucide-react";

const CallCtx = createContext(null);

export function CallProvider({ children }) {
  const [call, setCall] = useState({
    open: false,
    minimized: false,
    kind: null,           // 'dm' for now; room calls are on /rooms/ and self-manage
    conversationId: null,
    peer: null,
  });

  // Inbound, un-answered ring state. Populated by the SW push relay
  // (and the ?call=incoming deep link from a notification tap), cleared
  // on Answer or Decline.
  const [incoming, setIncoming] = useState(null); // { conversationId, peer, url }

  const openCall = useCallback(({ kind = "dm", conversationId, peer }) => {
    setCall({ open: true, minimized: false, kind, conversationId, peer });
  }, []);

  const minimize = useCallback(() => {
    setCall(c => c.open ? { ...c, minimized: true } : c);
  }, []);

  const restore = useCallback(() => {
    setCall(c => c.open ? { ...c, minimized: false } : c);
  }, []);

  const endCall = useCallback(() => {
    setCall({ open: false, minimized: false, kind: null, conversationId: null, peer: null });
  }, []);

  const ringIncoming = useCallback((payload) => {
    if (!payload?.conversationId) return;
    setIncoming(payload);
  }, []);

  const acceptIncoming = useCallback(() => {
    setIncoming((inc) => {
      if (inc) {
        openCall({ kind: "dm", conversationId: inc.conversationId, peer: inc.peer });
        // Deep-link into the DM thread so the DMCallPanel has peer context.
        try {
          window.location.hash = `#/Feed?dm=${encodeURIComponent(inc.conversationId)}`;
          window.dispatchEvent(new CustomEvent("ix-open-dm", { detail: { peer: inc.peer, convId: inc.conversationId } }));
        } catch {}
      }
      return null;
    });
  }, [openCall]);

  const declineIncoming = useCallback(() => {
    setIncoming(null);
  }, []);

  // Listen for SW push relays and notification-click deep links.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onSwMessage = (e) => {
      const msg = e?.data || {};
      if (msg.type !== "ix-push" || msg.kind !== "call") return;
      const d = msg.data || {};
      if (!d.conversationId) return;
      ringIncoming({
        conversationId: d.conversationId,
        peer: d.peer || null,
        url: d.url || "",
      });
    };
    const parseHashForIncoming = () => {
      const hash = window.location.hash || "";
      const q = hash.includes("?") ? hash.split("?")[1] : "";
      const params = new URLSearchParams(q);
      if (params.get("call") !== "incoming") return;
      const dm = params.get("dm");
      if (!dm) return;
      ringIncoming({ conversationId: dm, peer: null, url: hash });
    };
    navigator.serviceWorker?.addEventListener?.("message", onSwMessage);
    window.addEventListener("hashchange", parseHashForIncoming);
    parseHashForIncoming();
    return () => {
      navigator.serviceWorker?.removeEventListener?.("message", onSwMessage);
      window.removeEventListener("hashchange", parseHashForIncoming);
    };
  }, [ringIncoming]);

  // Suppress the ring if the user already opened (answered) this call via
  // another path (e.g. clicked Call in the DM panel manually).
  useEffect(() => {
    if (!incoming || !call.open) return;
    if (call.conversationId === incoming.conversationId) setIncoming(null);
  }, [incoming, call.open, call.conversationId]);

  const value = useMemo(() => ({
    call, openCall, minimize, restore, endCall,
    incoming, ringIncoming, acceptIncoming, declineIncoming,
  }), [call, openCall, minimize, restore, endCall, incoming, ringIncoming, acceptIncoming, declineIncoming]);

  return (
    <CallCtx.Provider value={value}>
      {children}
      {incoming && <IncomingCallOverlay incoming={incoming} onAnswer={acceptIncoming} onDecline={declineIncoming} />}
    </CallCtx.Provider>
  );
}

export function useCall() {
  const v = useContext(CallCtx);
  if (v) return v;
  return {
    call: { open: false, minimized: false, kind: null, conversationId: null, peer: null },
    openCall: () => {},
    minimize: () => {},
    restore: () => {},
    endCall: () => {},
    incoming: null,
    ringIncoming: () => {},
    acceptIncoming: () => {},
    declineIncoming: () => {},
  };
}

// ── In-app ringing UI ─────────────────────────────────────────────────
// Full-screen overlay with synthesized ringback tone. We synthesize via
// Web Audio so we don't have to ship an mp3 asset — the tone follows the
// standard North-American ringback cadence (440+480Hz, 2s on / 4s off).
function IncomingCallOverlay({ incoming, onAnswer, onDecline }) {
  const peer = incoming.peer || {};
  const label = peer.displayName || peer.username || peer.wallet || "Someone";
  const initial = (label[0] || "?").toUpperCase();
  const ringRef = useRef(null);

  useEffect(() => {
    let ctx = null;
    let stopped = false;
    let timer = null;
    const start = async () => {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        // Autoplay policy: if the tab hasn't had a gesture yet, resume()
        // will be blocked. The overlay itself receives the user's tap on
        // Answer/Decline, which will then resume a fresh tone if needed.
        if (ctx.state === "suspended") {
          try { await ctx.resume(); } catch {}
        }
        ringRef.current = ctx;
        const beep = () => {
          if (stopped || !ctx) return;
          const now = ctx.currentTime;
          const osc1 = ctx.createOscillator(); osc1.frequency.value = 440;
          const osc2 = ctx.createOscillator(); osc2.frequency.value = 480;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, now);
          g.gain.exponentialRampToValueAtTime(0.25, now + 0.05);
          g.gain.setValueAtTime(0.25, now + 1.9);
          g.gain.exponentialRampToValueAtTime(0.0001, now + 2.0);
          osc1.connect(g); osc2.connect(g); g.connect(ctx.destination);
          osc1.start(now); osc2.start(now);
          osc1.stop(now + 2.05); osc2.stop(now + 2.05);
        };
        beep();
        timer = setInterval(beep, 6000);
        // Vibrate cadence for Android Chrome that otherwise goes silent.
        if (navigator.vibrate) {
          const vibeLoop = setInterval(() => { try { navigator.vibrate([400, 200, 400, 200, 400]); } catch {} }, 3000);
          const prevTimer = timer;
          timer = { a: prevTimer, b: vibeLoop, clear() { clearInterval(this.a); clearInterval(this.b); } };
        }
      } catch {}
    };
    start();
    return () => {
      stopped = true;
      if (timer?.clear) timer.clear(); else if (timer) clearInterval(timer);
      try { ringRef.current?.close?.(); } catch {}
    };
  }, []);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 10000,
      background: "radial-gradient(circle at 50% 30%, #1e3a8a 0%, #0b1020 55%, #04060d 100%)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: 32, color: "#fff", textAlign: "center",
    }}>
      <div style={{ fontSize: 14, letterSpacing: 2, textTransform: "uppercase", opacity: 0.75, marginBottom: 16 }}>
        Incoming AZUKA call
      </div>
      <div style={{
        width: 128, height: 128, borderRadius: "50%",
        background: peer.pfpUrl ? `url(${peer.pfpUrl}) center/cover` : "linear-gradient(135deg,#3b82f6,#0ea5e9)",
        display: "grid", placeItems: "center", fontSize: 44, fontWeight: 800,
        boxShadow: "0 0 0 8px rgba(59,130,246,.25), 0 0 60px rgba(59,130,246,.55)",
        animation: "ixRingPulse 1.4s ease-in-out infinite",
      }}>
        {!peer.pfpUrl && initial}
      </div>
      <div style={{ marginTop: 24, fontSize: 26, fontWeight: 700 }}>{label}</div>
      <div style={{ marginTop: 6, fontSize: 14, opacity: 0.7 }}>is calling you…</div>

      <div style={{ marginTop: 56, display: "flex", gap: 56 }}>
        <button onClick={onDecline} aria-label="Decline" style={btn("#dc2626")}>
          <PhoneOff size={28} color="#fff" />
        </button>
        <button onClick={onAnswer} aria-label="Answer" style={btn("#16a34a")}>
          <Phone size={28} color="#fff" />
        </button>
      </div>
      <div style={{ marginTop: 22, fontSize: 12, opacity: 0.55, display: "flex", gap: 28 }}>
        <span>Decline</span><span>Answer</span>
      </div>
      <style>{`
        @keyframes ixRingPulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 8px rgba(59,130,246,.25), 0 0 60px rgba(59,130,246,.55); }
          50% { transform: scale(1.06); box-shadow: 0 0 0 14px rgba(59,130,246,.15), 0 0 80px rgba(59,130,246,.8); }
        }
      `}</style>
    </div>
  );
}

function btn(bg) {
  return {
    width: 72, height: 72, borderRadius: "50%", border: "none",
    background: bg, cursor: "pointer", display: "grid", placeItems: "center",
    boxShadow: "0 12px 30px rgba(0,0,0,.55)",
  };
}
