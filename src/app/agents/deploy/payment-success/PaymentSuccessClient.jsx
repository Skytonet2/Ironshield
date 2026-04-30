"use client";
// PaymentSuccessClient — polls /api/payments/psp/session/:reference for
// up to ~60s after Paystack redirects the buyer back. On settlement we
// show the on_chain_id and link out to the mission page.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, Check, AlertTriangle } from "lucide-react";
import { API_BASE } from "@/lib/apiBase";

const POLL_INTERVAL_MS = 2500;
const POLL_MAX_TICKS   = 24;

export default function PaymentSuccessClient() {
  const search = useSearchParams();
  // Paystack appends ?reference=… AND we also pass ?ref=… ourselves; accept both.
  const reference = search.get("reference") || search.get("ref") || "";
  const [session, setSession] = useState(null);
  const [error, setError]     = useState(null);
  const [done, setDone]       = useState(false);

  useEffect(() => {
    if (!reference) {
      setError("No payment reference in URL.");
      return;
    }
    let cancelled = false;
    let ticks = 0;
    async function poll() {
      try {
        const r = await fetch(`${API_BASE}/api/payments/psp/session/${encodeURIComponent(reference)}`);
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok) throw new Error(j.error || "Could not fetch payment status");
        setSession(j);
        // Done when settlement landed (mission_id set) or hard-failed.
        if (j.mission_id || j.pending_status === "failed" || j.pending_status === "settle_failed") {
          setDone(true);
          return;
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
      ticks += 1;
      if (ticks < POLL_MAX_TICKS && !cancelled) {
        setTimeout(poll, POLL_INTERVAL_MS);
      } else if (!cancelled) {
        setDone(true);
      }
    }
    poll();
    return () => { cancelled = true; };
  }, [reference]);

  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        <h1 style={titleStyle}>Payment received — funding your mission</h1>
        <p style={subtitleStyle}>
          Reference <code style={refStyle}>{reference || "—"}</code>
        </p>

        {!done && !error && (
          <div style={cardStyle}>
            <div style={lineStyle}>
              <Loader2 size={16} style={{ animation: "ps-spin 0.9s linear infinite" }} />
              <span>Confirming payment with Paystack and signing your mission on-chain…</span>
            </div>
          </div>
        )}

        {error && (
          <div style={{ ...cardStyle, borderColor: "rgba(255,77,77,0.3)" }}>
            <div style={{ ...lineStyle, color: "var(--red)" }}>
              <AlertTriangle size={16} /> {error}
            </div>
          </div>
        )}

        {session && session.mission_id && (
          <div style={{ ...cardStyle, borderColor: "rgba(0,210,106,0.3)" }}>
            <div style={{ ...lineStyle, color: "var(--green, #10B981)" }}>
              <Check size={16} /> Mission live on-chain — id #{session.mission_id}
            </div>
            <div style={{ marginTop: 12 }}>
              <Link href={`/missions/${session.mission_id}`} style={primaryBtn}>Open mission →</Link>
            </div>
          </div>
        )}

        {session && !session.mission_id && done && (
          <div style={{ ...cardStyle, borderColor: "rgba(245,158,11,0.3)" }}>
            <div style={{ ...lineStyle, color: "var(--amber, #f59e0b)" }}>
              <AlertTriangle size={16} />
              <span>
                {session.pending_status === "failed"
                  ? "Payment failed. No charge was made."
                  : session.pending_status === "settle_failed"
                  ? "Payment received but on-chain funding hit a snag — our team is following up."
                  : "Still processing — this sometimes takes a minute. You can close this tab; we'll email you."}
              </span>
            </div>
          </div>
        )}

        <Link href="/marketplace/kits" style={ghostBtn}>← Back to Kits</Link>
      </div>

      <style jsx global>{`
        @keyframes ps-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

const pageStyle = { minHeight: "100vh", background: "var(--bg-app)" };
const containerStyle = { maxWidth: 720, margin: "0 auto", padding: "48px 20px" };
const titleStyle = { fontSize: 22, fontWeight: 800, color: "var(--text-1)", margin: "0 0 6px" };
const subtitleStyle = { fontSize: 13, color: "var(--text-2)", margin: "0 0 18px" };
const refStyle = {
  background: "var(--bg-card)", border: "1px solid var(--border)",
  borderRadius: 6, padding: "2px 6px", fontSize: 12,
};
const cardStyle = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: 18,
  marginBottom: 14,
};
const lineStyle = {
  display: "flex", alignItems: "center", gap: 10,
  fontSize: 13, color: "var(--text-1)",
};
const primaryBtn = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "9px 14px",
  borderRadius: 10,
  background: "linear-gradient(135deg, #a855f7, #60a5fa)",
  color: "#fff", fontSize: 12.5, fontWeight: 700,
  border: "1px solid var(--accent-border)",
  cursor: "pointer", textDecoration: "none",
};
const ghostBtn = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "9px 12px",
  borderRadius: 10,
  background: "var(--bg-card)",
  color: "var(--text-1)",
  fontSize: 12.5, fontWeight: 600,
  border: "1px solid var(--border)",
  cursor: "pointer", textDecoration: "none",
};
