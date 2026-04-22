"use client";
// AmbientBackground — pure-CSS radial blobs, positioned behind the app.
//
// Three low-opacity blobs in --accent color, each with its own long,
// offset translate animation. Felt, not seen — opacity is tuned so it
// reads as depth rather than decoration.
//
// We deliberately don't use canvas or WebGL. A fixed-position pair of
// divs with `will-change: transform` composites cheaply on the GPU and
// respects `prefers-reduced-motion` via the `@media` in tokens.css
// without needing a JS branch.

import { useTheme } from "@/lib/contexts";

export default function AmbientBackground() {
  // We read theme.accent (the legacy inline-style token) so the blobs
  // retint when the user changes preset — radial-gradient CSS doesn't
  // re-parse when a custom property updates, so we template the color
  // into the style string directly.
  const t = useTheme();
  const accent = t.accent;

  const blobBase = {
    position: "absolute",
    width: "60vw",
    height: "60vw",
    maxWidth: 900,
    maxHeight: 900,
    borderRadius: "50%",
    filter: "blur(80px)",
    willChange: "transform",
    pointerEvents: "none",
  };

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: -1,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          ...blobBase,
          top: "-20vh",
          left: "-10vw",
          background: `radial-gradient(circle, ${accent} 0%, transparent 65%)`,
          opacity: 0.05,
          animation: "ambientDrift1 38s var(--ease-in-out) infinite alternate",
        }}
      />
      <div
        style={{
          ...blobBase,
          bottom: "-25vh",
          right: "-15vw",
          background: `radial-gradient(circle, ${accent} 0%, transparent 65%)`,
          opacity: 0.045,
          animation: "ambientDrift2 44s var(--ease-in-out) infinite alternate",
        }}
      />
      <div
        style={{
          ...blobBase,
          top: "35vh",
          left: "30vw",
          width: "40vw",
          height: "40vw",
          background: `radial-gradient(circle, ${accent} 0%, transparent 65%)`,
          opacity: 0.04,
          animation: "ambientDrift3 30s var(--ease-in-out) infinite alternate",
        }}
      />
      <style jsx>{`
        @keyframes ambientDrift1 {
          from { transform: translate3d(0, 0, 0) scale(1); }
          to   { transform: translate3d(12vw, 8vh, 0) scale(1.15); }
        }
        @keyframes ambientDrift2 {
          from { transform: translate3d(0, 0, 0) scale(1.05); }
          to   { transform: translate3d(-10vw, -6vh, 0) scale(0.95); }
        }
        @keyframes ambientDrift3 {
          from { transform: translate3d(0, 0, 0) scale(1); }
          to   { transform: translate3d(6vw, -10vh, 0) scale(1.1); }
        }
        @media (prefers-reduced-motion: reduce) {
          div { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
