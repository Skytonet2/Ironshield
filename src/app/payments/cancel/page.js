// /payments/cancel — landing page PingPay redirects buyers to when they
// abandon the hosted checkout. No backend call required: the pending
// row in pending_missions stays in 'pending_payment' and is reaped by
// a future janitor; nothing has been escrowed yet, so no recovery is
// needed beyond a friendly hand-off.

"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { XCircle, ArrowLeft } from "lucide-react";

function Inner() {
  const search = useSearchParams();
  const sessionId = search.get("session_id") || search.get("sessionId");

  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <XCircle size={18} style={{ color: "var(--text-2)" }} />
            <h1 style={titleStyle}>Payment cancelled</h1>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.55 }}>
            Nothing was charged. You can return to the kit page and try again,
            or pay later — your kit deployment is unaffected.
          </p>
          {sessionId && (
            <p style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 8, fontFamily: "ui-monospace, monospace" }}>
              Session: {sessionId}
            </p>
          )}
          <div style={{ marginTop: 18 }}>
            <Link href="/marketplace/kits" style={ghostBtn}>
              <ArrowLeft size={13} /> Back to Kits
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
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
