"use client";
// /payments/success — PingPay successUrl landing page.
//
// Polls /api/payments/pingpay/session/:id until status === "funded".
// While we wait, PingPay's bridge is routing the buyer's USD payment
// through NEAR Intents into the buyer's NEAR wallet — typically lands
// in 10-60s. Once funded we surface a "Sign mission" CTA that calls
// create_mission via the connected wallet, then POSTs back to
// /attach so the pending_missions row is linked to the on-chain id.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2, Loader2, AlertTriangle, Wallet, Sparkles,
} from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { useWallet } from "@/lib/contexts";

const POLL_INTERVAL_MS = 4_000;
const POLL_MAX_MS      = 5 * 60_000;

export default function PaymentsSuccessClient() {
  const search = useSearchParams();
  const router = useRouter();
  const sessionId = search.get("session_id") || search.get("sessionId");

  const { connected, showModal } = useWallet?.() || {};
  const [status, setStatus]      = useState("loading"); // loading | pending_payment | funded | signed | error
  const [pending, setPending]    = useState(null);
  const [error, setError]        = useState(null);
  const [signing, setSigning]    = useState(false);
  const [missionId, setMissionId] = useState(null);

  const pollDeadline = useMemo(() => Date.now() + POLL_MAX_MS, []);
  const cancelledRef = useRef(false);

  // Poll the backend until the session is funded (or signed if the
  // user came back here from a successful sign).
  useEffect(() => {
    cancelledRef.current = false;
    if (!sessionId) {
      setStatus("error");
      setError("Missing session_id — return to the kit page and start over.");
      return;
    }

    async function tick() {
      if (cancelledRef.current) return;
      try {
        const r = await apiFetch(`/api/payments/pingpay/session/${encodeURIComponent(sessionId)}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Status unavailable");
        setPending(j);
        setStatus(j.status || "loading");
        if (j.resolved_on_chain_id) setMissionId(j.resolved_on_chain_id);
        if (j.status === "funded" || j.status === "signed") return; // stop polling
      } catch (e) {
        // Don't tear down the page on a transient error — try again.
        console.warn("[payments/success] poll failed:", e?.message);
      }
      if (Date.now() < pollDeadline && !cancelledRef.current) {
        setTimeout(tick, POLL_INTERVAL_MS);
      } else if (!cancelledRef.current) {
        setError("Payment is taking longer than expected. Refresh in a moment, or contact support if it doesn't resolve.");
      }
    }
    tick();
    return () => { cancelledRef.current = true; };
  }, [sessionId, pollDeadline]);

  const onSign = useCallback(async () => {
    if (!connected) { showModal?.(); return; }
    if (!pending) return;
    setSigning(true);
    setError(null);
    try {
      // Stub for the wallet-side create_mission call. The actual
      // signing helper varies by wallet provider — useAgent doesn't
      // expose create_mission today, so we redirect into the missions
      // create flow with the pre-funded params pre-filled. The
      // missions surface owns the wallet-signing logic and will call
      // /api/payments/pingpay/session/:id/attach after the tx lands.
      const params = new URLSearchParams({
        from_pingpay_session: pending.session_id,
        kit_slug:             pending.kit_slug || "",
        template_slug:        pending.template_slug || "",
        escrow_amount_usd:    String(pending.escrow_amount_usd || ""),
      });
      router.push(`/missions/create?${params.toString()}`);
    } catch (e) {
      setError(e?.message || "Could not start the mission signing flow.");
    } finally {
      setSigning(false);
    }
  }, [connected, showModal, pending, router]);

  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <Sparkles size={18} style={{ color: "var(--accent)" }} />
            <h1 style={titleStyle}>Payment received</h1>
          </div>

          {!sessionId && (
            <div style={errorStyle}>Missing session_id — go back to the kit page and try again.</div>
          )}

          {sessionId && status === "loading" && (
            <div style={infoStyle}>
              <Loader2 size={14} style={{ animation: "kw-spin 0.9s linear infinite" }} />
              <span>Checking payment status…</span>
            </div>
          )}

          {status === "pending_payment" && (
            <div style={infoStyle}>
              <Loader2 size={14} style={{ animation: "kw-spin 0.9s linear infinite" }} />
              <span>
                Waiting for PingPay to route funds into your NEAR wallet. This usually takes
                under a minute.
              </span>
            </div>
          )}

          {status === "funded" && pending && (
            <>
              <div style={{ ...infoStyle, color: "var(--green)", borderColor: "rgba(0,210,106,0.4)", background: "rgba(0,210,106,0.06)" }}>
                <CheckCircle2 size={14} />
                <span>
                  Funds delivered to your NEAR wallet. One last step — sign the mission on-chain
                  to lock escrow and let agents start work.
                </span>
              </div>

              <dl style={listStyle}>
                <Row k="Kit"        v={pending.kit_slug || "—"} />
                <Row k="Escrow"     v={`$${Number(pending.escrow_amount_usd).toFixed(2)} USD`} />
                <Row k="Session"    v={pending.session_id} mono />
              </dl>

              <button type="button" onClick={onSign} disabled={signing} style={primaryBtn}>
                {signing
                  ? <><Loader2 size={13} style={{ animation: "kw-spin 0.9s linear infinite" }} /> Opening signing flow…</>
                  : <><Wallet size={13} /> Sign mission on-chain</>}
              </button>
            </>
          )}

          {status === "signed" && (
            <div style={{ ...infoStyle, color: "var(--green)", borderColor: "rgba(0,210,106,0.4)", background: "rgba(0,210,106,0.06)" }}>
              <CheckCircle2 size={14} />
              <span>
                Mission #{missionId} is live. Agents can claim it now.
              </span>
            </div>
          )}

          {error && (
            <div style={{ ...errorStyle, marginTop: 12 }}>
              <AlertTriangle size={13} style={{ marginRight: 6, verticalAlign: "-2px" }} />
              {error}
            </div>
          )}

          <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/marketplace/kits" style={ghostBtn}>← Back to Kits</Link>
            {missionId && (
              <Link href={`/missions/${missionId}`} style={ghostBtn}>View mission →</Link>
            )}
          </div>
        </div>
      </div>

      <style jsx global>{`
        @keyframes kw-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function Row({ k, v, mono }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px dashed var(--border)" }}>
      <dt style={{ fontSize: 11.5, color: "var(--text-2)" }}>{k}</dt>
      <dd style={{ fontSize: 12.5, color: "var(--text-1)", fontWeight: 700, fontFamily: mono ? "ui-monospace, monospace" : undefined, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }}>{v}</dd>
    </div>
  );
}

const pageStyle = { minHeight: "100vh", background: "var(--bg-app)" };
const containerStyle = { maxWidth: 720, margin: "0 auto", padding: "48px 20px" };
const cardStyle = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 24,
};
const titleStyle = { fontSize: 22, fontWeight: 800, color: "var(--text-1)", margin: 0 };
const listStyle = { margin: "14px 0 16px", padding: 0 };
const infoStyle = {
  display: "flex", alignItems: "center", gap: 10,
  padding: "10px 12px",
  borderRadius: 9,
  background: "rgba(168, 85, 247, 0.06)",
  border: "1px solid rgba(168, 85, 247, 0.3)",
  color: "var(--text-1)",
  fontSize: 12.5,
};
const errorStyle = {
  padding: 12, borderRadius: 9,
  background: "rgba(255, 77, 77, 0.08)",
  border: "1px solid rgba(255, 77, 77, 0.3)",
  color: "var(--red)",
  fontSize: 12,
};
const primaryBtn = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "10px 16px",
  borderRadius: 10,
  background: "linear-gradient(135deg, #a855f7, #60a5fa)",
  color: "#fff",
  fontSize: 13, fontWeight: 700,
  border: "1px solid var(--accent-border)",
  cursor: "pointer",
  marginTop: 8,
};
const ghostBtn = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "9px 12px",
  borderRadius: 10,
  background: "var(--bg-card)",
  color: "var(--text-1)",
  fontSize: 12.5, fontWeight: 600,
  border: "1px solid var(--border)",
  cursor: "pointer",
  textDecoration: "none",
};
