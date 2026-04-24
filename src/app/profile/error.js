"use client";
// Profile-specific Next.js error boundary. Takes precedence over
// src/app/error.js for any render throw inside /profile. Matches the
// global shell's dark theme but keeps the sidebar reachable so the
// user can navigate away instead of getting stuck.

import { useEffect } from "react";

export default function ProfileError({ error, reset }) {
  useEffect(() => {
    console.error("[ProfileError]", error?.message, error?.digest);
  }, [error]);

  const msg = error?.message || "Profile failed to render.";

  return (
    <div style={{
      maxWidth: 560, margin: "80px auto", padding: 28,
      borderRadius: 14,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(17, 22, 36, 0.85)",
      color: "#e6ecf7",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: "#f59e0b", marginBottom: 8, fontWeight: 700 }}>
        Profile error
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 10 }}>
        We couldn't load this profile.
      </div>
      <div style={{ fontSize: 13, color: "rgba(230,236,247,0.7)", marginBottom: 16, lineHeight: 1.55 }}>
        Usually a stale session or a flaky backend fetch. Retrying fixes
        most cases; switch profiles via the sidebar if it doesn't.
      </div>
      <div style={{
        fontSize: 12, color: "rgba(230,236,247,0.55)",
        padding: 10, borderRadius: 8,
        background: "rgba(0,0,0,0.3)",
        border: "1px solid rgba(255,255,255,0.05)",
        fontFamily: "ui-monospace, SFMono-Regular, monospace",
        wordBreak: "break-word", marginBottom: 18,
      }}>
        {msg}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          onClick={() => reset()}
          style={{
            padding: "9px 16px", borderRadius: 10, border: "none",
            background: "linear-gradient(135deg, #a855f7, #3b82f6)",
            color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}
        >
          Retry
        </button>
        <a
          href="/feed"
          style={{
            padding: "9px 16px", borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
            color: "#e6ecf7", fontSize: 13, fontWeight: 600,
            textDecoration: "none", display: "inline-flex", alignItems: "center",
          }}
        >
          Back to feed
        </a>
      </div>
    </div>
  );
}
