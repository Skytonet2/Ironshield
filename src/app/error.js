"use client";
// Global Next.js App Router error boundary — wraps every route.
// Without this file, an uncaught render throw in any page leaves the
// user staring at a blank body until they manually reload. With it,
// Next hands the thrown error to this component so we can show a
// recoverable card with "Try again" + "Go home" + raw message.
//
// Scoped overrides (e.g. src/app/profile/error.js) take precedence for
// their subtree; this file is the default.

import { useEffect } from "react";

export default function RootError({ error, reset }) {
  useEffect(() => {
    // One place that logs every render crash. The stack lives on the
    // Error object but Next.js strips it in prod — we still emit the
    // digest the runtime attaches so server-side traces can be matched.
    console.error("[RootError]", error?.message, error?.digest);
  }, [error]);

  const msg = error?.message || "Something went wrong.";

  return (
    <html>
      <body style={{ margin: 0, background: "#080b12", color: "#e6ecf7", fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <div style={{
          minHeight: "100vh",
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 24,
        }}>
          <div style={{
            maxWidth: 520, width: "100%",
            padding: 28, borderRadius: 16,
            background: "rgba(17, 22, 36, 0.95)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          }}>
            <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: "#f59e0b", marginBottom: 8, fontWeight: 700 }}>
              Render error
            </div>
            <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 10 }}>
              This page hit a snag.
            </div>
            <div style={{
              fontSize: 13, color: "rgba(230,236,247,0.7)",
              marginBottom: 20, lineHeight: 1.55,
              fontFamily: "ui-monospace, SFMono-Regular, monospace",
              padding: 12, borderRadius: 8,
              background: "rgba(0,0,0,0.3)",
              border: "1px solid rgba(255,255,255,0.05)",
              wordBreak: "break-word",
            }}>
              {msg}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={() => reset()}
                style={{
                  padding: "10px 18px", borderRadius: 10, border: "none",
                  background: "linear-gradient(135deg, #a855f7, #3b82f6)",
                  color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
                }}
              >
                Try again
              </button>
              <a
                href="/"
                style={{
                  padding: "10px 18px", borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.04)",
                  color: "#e6ecf7", fontSize: 13, fontWeight: 600,
                  textDecoration: "none", display: "inline-flex", alignItems: "center",
                }}
              >
                Go home
              </a>
              <button
                onClick={() => { try { location.reload(); } catch {} }}
                style={{
                  padding: "10px 18px", borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "transparent",
                  color: "rgba(230,236,247,0.7)", fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}
              >
                Full reload
              </button>
            </div>
            {error?.digest && (
              <div style={{ marginTop: 18, fontSize: 10, color: "rgba(230,236,247,0.35)", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                digest: {error.digest}
              </div>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
