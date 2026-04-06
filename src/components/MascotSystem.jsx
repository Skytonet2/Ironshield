"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { useTheme } from "@/lib/contexts";

const MASCOT_IMG = "/mascot.png";

/* ══════════════════════════════════════════════════════════════
   CONFIG — tweak all behavior values here
   ══════════════════════════════════════════════════════════════ */
const CFG = {
  // Small mascot
  size: 90,
  cursorEasing: 0.06,          // lower = more lag
  cursorInfluence: 0.15,       // how far it follows (0-1)
  proximityRadius: 120,        // px to trigger proximity-alert
  sleepTimeout: 6000,          // ms of inactivity before sleep
  attackDuration: 400,         // ms
  enterDuration: 800,          // ms

  // Large mascot (peeker)
  peekerDelay: 1500,           // ms after load to appear
  peekerStayDuration: 8000,    // ms visible before exit
  peekerSlideSpeed: 600,       // ms slide animation

  // Sound hooks (placeholders)
  sounds: {
    attack: () => { /* AudioContext beep placeholder */ },
    enter:  () => {},
    sleep:  () => {},
    wake:   () => {},
  },
};

/* ══════════════════════════════════════════════════════════════
   KEYFRAMES (injected once)
   ══════════════════════════════════════════════════════════════ */
const STYLES = `
@keyframes mascot-breathe {
  0%, 100% { transform: translateY(0px) scale(1); }
  50% { transform: translateY(-4px) scale(1.02); }
}
@keyframes mascot-enter-drop {
  0% { transform: translateY(-120vh) rotate(-30deg) scale(0.6); opacity: 0; }
  60% { transform: translateY(10px) rotate(5deg) scale(1.05); opacity: 1; }
  80% { transform: translateY(-5px) rotate(-2deg) scale(0.98); }
  100% { transform: translateY(0) rotate(0deg) scale(1); opacity: 1; }
}
@keyframes mascot-attack {
  0% { transform: rotate(0deg) scale(1); }
  20% { transform: rotate(-25deg) scale(1.15); }
  40% { transform: rotate(15deg) scale(1.2); filter: brightness(1.8); }
  60% { transform: rotate(-5deg) scale(1.1); }
  100% { transform: rotate(0deg) scale(1); filter: brightness(1); }
}
@keyframes mascot-flash {
  0% { box-shadow: 0 0 0px rgba(59,130,246,0); }
  30% { box-shadow: 0 0 30px rgba(59,130,246,0.8), 0 0 60px rgba(59,130,246,0.4); }
  100% { box-shadow: 0 0 0px rgba(59,130,246,0); }
}
@keyframes mascot-proximity-pulse {
  0%, 100% { transform: scale(1); filter: drop-shadow(0 0 8px rgba(59,130,246,0.4)); }
  50% { transform: scale(1.08); filter: drop-shadow(0 0 20px rgba(59,130,246,0.8)); }
}
@keyframes peeker-blink {
  0%, 42%, 48%, 90%, 96%, 100% { clip-path: inset(0 0 0 0); }
  45%, 93% { clip-path: inset(0 0 55% 0); }
}
@keyframes peeker-float {
  0%, 100% { transform: rotate(180deg) translateY(0px); }
  50% { transform: rotate(180deg) translateY(3px); }
}
@keyframes peeker-text-glow {
  0%, 100% { text-shadow: 0 0 10px rgba(59,130,246,0.3); }
  50% { text-shadow: 0 0 20px rgba(59,130,246,0.7), 0 0 40px rgba(59,130,246,0.3); }
}
`;

/* ══════════════════════════════════════════════════════════════
   SMALL MASCOT — bottom-right interactive character
   ══════════════════════════════════════════════════════════════ */
function SmallMascot({ onAction, onSecretFound }) {
  const t = useTheme();
  const [state, setState] = useState("enter");  // idle | enter | attack | proximity-alert | sleep
  const [visible, setVisible] = useState(true);

  const elRef = useRef(null);
  const imgRef = useRef(null);
  const posRef = useRef({ x: 0, y: 0 });         // current smooth position
  const targetRef = useRef({ x: 0, y: 0 });       // target from cursor
  const mouseRef = useRef({ x: 0, y: 0 });        // raw mouse position
  const rafRef = useRef(null);
  const sleepTimerRef = useRef(null);
  const stateRef = useRef("enter");
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef(null);

  // Keep stateRef in sync
  useEffect(() => { stateRef.current = state; }, [state]);

  // Inject keyframes
  useEffect(() => {
    if (document.getElementById("mascot-styles")) return;
    const style = document.createElement("style");
    style.id = "mascot-styles";
    style.textContent = STYLES;
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, []);

  // Enter animation → idle
  useEffect(() => {
    CFG.sounds.enter();
    const timer = setTimeout(() => setState("idle"), CFG.enterDuration);
    return () => clearTimeout(timer);
  }, []);

  // Inactivity → sleep
  const resetSleepTimer = useCallback(() => {
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    if (stateRef.current === "sleep") {
      CFG.sounds.wake();
      setState("idle");
    }
    sleepTimerRef.current = setTimeout(() => {
      if (stateRef.current === "idle" || stateRef.current === "proximity-alert") {
        CFG.sounds.sleep();
        setState("sleep");
      }
    }, CFG.sleepTimeout);
  }, []);

  // RAF loop for smooth cursor follow
  useEffect(() => {
    const loop = () => {
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      // Calculate target offset from center-bottom-right anchor
      const anchorX = window.innerWidth - CFG.size / 2 - 16;
      const anchorY = window.innerHeight - CFG.size / 2 - 16;
      const dx = (mx - anchorX) * CFG.cursorInfluence;
      const dy = (my - anchorY) * CFG.cursorInfluence;

      targetRef.current.x = dx;
      targetRef.current.y = dy;

      // Ease toward target
      posRef.current.x += (targetRef.current.x - posRef.current.x) * CFG.cursorEasing;
      posRef.current.y += (targetRef.current.y - posRef.current.y) * CFG.cursorEasing;

      if (elRef.current && stateRef.current !== "enter") {
        elRef.current.style.transform = `translate(${posRef.current.x}px, ${posRef.current.y}px)`;
      }

      // Proximity detection
      const dist = Math.hypot(mx - anchorX, my - anchorY);
      if (stateRef.current === "idle" && dist < CFG.proximityRadius) {
        setState("proximity-alert");
      } else if (stateRef.current === "proximity-alert" && dist >= CFG.proximityRadius) {
        setState("idle");
      }

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  // Global mousemove
  useEffect(() => {
    const handler = (e) => {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
      resetSleepTimer();
    };
    window.addEventListener("mousemove", handler, { passive: true });
    return () => window.removeEventListener("mousemove", handler);
  }, [resetSleepTimer]);

  // Click → attack
  const handleClick = useCallback(() => {
    if (stateRef.current === "enter") return;
    CFG.sounds.attack();
    setState("attack");
    setTimeout(() => setState("idle"), CFG.attackDuration);
    resetSleepTimer();

    // Triple-click secret
    clickCountRef.current++;
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    if (clickCountRef.current >= 3) {
      clickCountRef.current = 0;
      onSecretFound?.();
    }
    clickTimerRef.current = setTimeout(() => { clickCountRef.current = 0; }, 800);

    // Action hook
    onAction?.("attack");
  }, [onAction, onSecretFound, resetSleepTimer]);

  if (!visible) return null;

  // State-driven styles for the image
  const imgStyle = (() => {
    const base = {
      width: "100%", height: "100%", objectFit: "contain",
      willChange: "transform, filter",
      transition: "filter 0.3s ease",
      filter: `drop-shadow(0 4px 16px rgba(59,130,246,0.4))`,
    };
    switch (state) {
      case "enter":
        return { ...base, animation: `mascot-enter-drop ${CFG.enterDuration}ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards` };
      case "attack":
        return { ...base, animation: `mascot-attack ${CFG.attackDuration}ms ease-out forwards` };
      case "proximity-alert":
        return { ...base, animation: "mascot-proximity-pulse 0.8s ease-in-out infinite" };
      case "sleep":
        return { ...base, animation: "mascot-breathe 4s ease-in-out infinite", filter: "drop-shadow(0 2px 8px rgba(59,130,246,0.15)) brightness(0.6)", transform: "rotate(8deg)" };
      case "idle":
      default:
        return { ...base, animation: "mascot-breathe 2.5s ease-in-out infinite" };
    }
  })();

  // Flash ring on attack
  const ringStyle = state === "attack" ? {
    position: "absolute", inset: -8, borderRadius: "50%",
    animation: `mascot-flash ${CFG.attackDuration}ms ease-out forwards`,
    pointerEvents: "none",
  } : null;

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setVisible(false)}
        style={{
          position: "fixed", bottom: CFG.size + 24, right: 8, zIndex: 91,
          background: "rgba(0,0,0,0.4)", border: "none", borderRadius: 6,
          color: "#64748b", fontSize: 10, padding: "3px 8px", cursor: "pointer",
          opacity: 0.5, transition: "opacity 0.2s",
        }}
        onMouseEnter={e => e.currentTarget.style.opacity = 1}
        onMouseLeave={e => e.currentTarget.style.opacity = 0.5}
      >
        hide mascot
      </button>

      {/* Mascot container */}
      <div
        ref={elRef}
        onClick={handleClick}
        style={{
          position: "fixed", bottom: 16, right: 16, zIndex: 90,
          width: CFG.size, height: CFG.size,
          cursor: state === "attack" ? "crosshair" : "pointer",
          willChange: "transform",
          touchAction: "none",
        }}
      >
        {ringStyle && <div style={ringStyle} />}
        <img ref={imgRef} src={MASCOT_IMG} alt="IronClaw" draggable="false" style={imgStyle} />

        {/* Sleep indicator */}
        {state === "sleep" && (
          <div style={{
            position: "absolute", top: -8, right: -4, fontSize: 16,
            animation: "mascot-breathe 2s ease-in-out infinite",
            opacity: 0.7, pointerEvents: "none",
          }}>
            💤
          </div>
        )}
      </div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   LARGE PEEKER MASCOT — upside-down head from top
   ══════════════════════════════════════════════════════════════ */
function PeekerMascot() {
  const t = useTheme();
  const [phase, setPhase] = useState("hidden"); // hidden | entering | visible | exiting | gone

  useEffect(() => {
    const enterTimer = setTimeout(() => setPhase("entering"), CFG.peekerDelay);
    return () => clearTimeout(enterTimer);
  }, []);

  useEffect(() => {
    if (phase === "entering") {
      const timer = setTimeout(() => setPhase("visible"), CFG.peekerSlideSpeed);
      return () => clearTimeout(timer);
    }
    if (phase === "visible") {
      const timer = setTimeout(() => setPhase("exiting"), CFG.peekerStayDuration);
      return () => clearTimeout(timer);
    }
    if (phase === "exiting") {
      const timer = setTimeout(() => setPhase("gone"), CFG.peekerSlideSpeed);
      return () => clearTimeout(timer);
    }
  }, [phase]);

  // Scroll exit
  useEffect(() => {
    if (phase !== "visible" && phase !== "entering") return;
    const handler = () => {
      if (window.scrollY > 80) setPhase("exiting");
    };
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, [phase]);

  if (phase === "hidden" || phase === "gone") return null;

  const isIn = phase === "entering" || phase === "visible";
  const slideY = isIn ? 0 : -120;

  return (
    <div style={{
      position: "fixed", top: 0, left: "50%", zIndex: 95,
      transform: `translateX(-50%) translateY(${slideY}px)`,
      transition: `transform ${CFG.peekerSlideSpeed}ms cubic-bezier(0.34, 1.56, 0.64, 1)`,
      display: "flex", flexDirection: "column", alignItems: "center",
      pointerEvents: "none",
      willChange: "transform",
    }}>
      {/* Upside-down mascot head — clipped to show only head */}
      <div style={{
        width: 100, height: 70, overflow: "hidden",
        animation: "peeker-float 3s ease-in-out infinite",
      }}>
        <img
          src={MASCOT_IMG}
          alt=""
          draggable="false"
          style={{
            width: 100, height: 100, objectFit: "contain",
            transform: "rotate(180deg)",
            animation: "peeker-blink 4s ease-in-out infinite",
            filter: "drop-shadow(0 4px 20px rgba(59,130,246,0.5))",
          }}
        />
      </div>

      {/* Caption */}
      <div style={{
        marginTop: 4, padding: "4px 16px",
        background: "rgba(8,11,18,0.85)", backdropFilter: "blur(8px)",
        borderRadius: 8, border: `1px solid ${t.accent}33`,
        opacity: phase === "visible" ? 1 : 0,
        transition: "opacity 0.6s ease 0.3s",
      }}>
        <span style={{
          fontSize: 12, fontWeight: 700, letterSpacing: "0.5px",
          color: t.accent,
          animation: "peeker-text-glow 2s ease-in-out infinite",
        }}>
          NEAR is the future of AI
        </span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN EXPORT — combines both mascots
   ══════════════════════════════════════════════════════════════ */
export default function MascotSystem({ onAction, onSecretFound }) {
  return (
    <>
      <SmallMascot onAction={onAction} onSecretFound={onSecretFound} />
      <PeekerMascot />
    </>
  );
}
