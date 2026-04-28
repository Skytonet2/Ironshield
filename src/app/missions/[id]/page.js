"use client";
// /missions/[id] — Mission detail + audit timeline + escalations.
//
// Subscribes to /api/missions/:id/stream for live updates (Tier 1 was
// supposed to ship the SSE indexer; until then the backend implements
// /stream as a 3-second poll-and-diff). If EventSource fails on the
// browser, we fall through to a plain interval poll.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Activity, ArrowLeft, Check, X as XIcon, Clock, Loader2, ShieldAlert,
  ChevronRight, ExternalLink, AlertTriangle,
} from "lucide-react";
import { useWallet } from "@/lib/contexts";
import { API_BASE } from "@/lib/apiBase";

const STATUS_PALETTE = {
  open:      { tone: "var(--accent)",     label: "Open" },
  claimed:   { tone: "var(--amber)",      label: "Claimed" },
  submitted: { tone: "var(--purple)",     label: "Submitted" },
  approved:  { tone: "var(--green)",      label: "Approved" },
  rejected:  { tone: "var(--red)",        label: "Rejected" },
  expired:   { tone: "var(--text-3)",     label: "Expired" },
  aborted:   { tone: "var(--text-3)",     label: "Aborted" },
};

export default function MissionDetailPage() {
  const params = useParams();
  const id = Number(params?.id);

  const { address: wallet } = useWallet?.() || {};
  const [mission, setMission]     = useState(null);
  const [audit, setAudit]         = useState([]);
  const [escalations, setEsc]     = useState([]);
  const [error, setError]         = useState(null);
  const [loading, setLoading]     = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [resolving, setResolving] = useState({}); // id → bool

  // GET /:id returns { mission, audit, escalations } in one shot — used
  // for the initial render and for the polling fallback when SSE isn't
  // available. Tier 1's stream sends `snapshot` once on connect plus
  // incremental `audit.appended / escalation.created / escalation.resolved`
  // events, so the SSE path applies state diffs instead of replacing.
  const fetchOnce = useCallback(async () => {
    const r = await fetch(`${API_BASE}/api/missions/${id}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Mission not found");
    if (j.mission) setMission(j.mission);
    if (Array.isArray(j.audit)) setAudit(j.audit);
    if (Array.isArray(j.escalations)) setEsc(j.escalations);
  }, [id]);

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    let cancelled = false;
    let es = null;
    let pollTimer = null;

    async function bootstrap() {
      try {
        await fetchOnce();
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }

      if (cancelled) return;

      if (typeof window !== "undefined" && typeof window.EventSource === "function") {
        try {
          es = new window.EventSource(`${API_BASE}/api/missions/${id}/stream`);
          setStreaming(true);

          // Initial snapshot — Tier 1 sends just { audit, escalations }
          // (the mission object came from the GET above).
          es.addEventListener("snapshot", (ev) => {
            try {
              const snap = JSON.parse(ev.data);
              if (Array.isArray(snap.audit)) setAudit(snap.audit);
              if (Array.isArray(snap.escalations)) setEsc(snap.escalations);
            } catch { /* ignore */ }
          });

          // Append a new audit row, dedup by step_seq so a re-emitted
          // event from a brief reconnect doesn't double-render.
          es.addEventListener("audit.appended", (ev) => {
            try {
              const row = JSON.parse(ev.data);
              setAudit((prev) => {
                if (prev.some((r) => r.step_seq === row.step_seq)) return prev;
                return [...prev, row].sort((a, b) => a.step_seq - b.step_seq);
              });
            } catch { /* ignore */ }
          });

          // New escalation lands at the top of the list (most-recent first).
          es.addEventListener("escalation.created", (ev) => {
            try {
              const row = JSON.parse(ev.data);
              setEsc((prev) => {
                if (prev.some((e) => e.id === row.id)) return prev;
                return [row, ...prev];
              });
            } catch { /* ignore */ }
          });

          // Resolved → patch in place. Server returns the same id with
          // the new status / decided_at / decided_by_wallet.
          es.addEventListener("escalation.resolved", (ev) => {
            try {
              const row = JSON.parse(ev.data);
              setEsc((prev) => prev.map((e) => e.id === row.id ? { ...e, ...row } : e));
            } catch { /* ignore */ }
          });

          es.onerror = () => {
            setStreaming(false);
            es?.close();
            // Fall back to polling. The diff handlers stop firing once
            // the EventSource is closed, so the poll catches anything
            // that lands during the gap.
            if (!pollTimer) pollTimer = setInterval(() => fetchOnce().catch(() => {}), 4000);
          };
          return;
        } catch { /* fall through */ }
      }

      pollTimer = setInterval(() => fetchOnce().catch(() => {}), 4000);
    }

    bootstrap();
    return () => {
      cancelled = true;
      es?.close?.();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [id, fetchOnce]);

  const isPoster = useMemo(() => {
    if (!wallet || !mission?.poster_wallet) return false;
    return String(wallet).toLowerCase() === String(mission.poster_wallet).toLowerCase();
  }, [wallet, mission]);

  const resolveEscalation = useCallback(async (escId, decision) => {
    if (!wallet) return;
    setResolving((r) => ({ ...r, [escId]: true }));
    try {
      const r = await fetch(`${API_BASE}/api/escalations/${escId}/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet":     String(wallet).toLowerCase(),
        },
        body: JSON.stringify({ decision, source: "in_app" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not resolve");
      // Optimistic local update; SSE/poll will reconcile.
      setEsc((es) => es.map((e) => e.id === escId ? { ...e, ...j.escalation } : e));
    } catch (e) {
      setError(e.message);
    } finally {
      setResolving((r) => ({ ...r, [escId]: false }));
    }
  }, [wallet]);

  if (loading) {
    return (
      <div style={pageStyle}>
        <div style={containerStyle}>
          <div style={emptyStyle}><Loader2 size={18} style={{ animation: "ms-spin 0.9s linear infinite" }} /> Loading mission…</div>
        </div>
      </div>
    );
  }

  if (error && !mission) {
    return (
      <div style={pageStyle}>
        <div style={containerStyle}>
          <Link href="/missions" style={ghostBtn}><ArrowLeft size={13} /> Missions</Link>
          <div style={errorStyle}>{error}</div>
        </div>
      </div>
    );
  }

  const palette = STATUS_PALETTE[mission?.status] || { tone: "var(--text-3)", label: mission?.status };
  const pendingEsc = escalations.filter((e) => e.status === "pending");

  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        <Link href="/missions" style={{ ...ghostBtn, alignSelf: "flex-start" }}>
          <ArrowLeft size={13} /> Missions
        </Link>

        <header style={headerStyle}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.8 }}>
              Mission #{mission.on_chain_id}
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--text-1)", margin: "4px 0" }}>
              {mission.template_slug || "Mission"}
            </h1>
            <div style={{ fontSize: 12, color: "var(--text-2)" }}>
              Posted by <code style={codeStyle}>{shortWallet(mission.poster_wallet)}</code>
              {mission.claimant_wallet && <> · Claimed by <code style={codeStyle}>{shortWallet(mission.claimant_wallet)}</code></>}
              {mission.kit_slug && <> · Kit <Link href={`/marketplace/kits`} style={linkStyle}>{mission.kit_slug}</Link></>}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
            <span style={{
              padding: "5px 10px",
              borderRadius: 99,
              background: "var(--bg-card)",
              border: `1px solid ${palette.tone}`,
              color: palette.tone,
              fontSize: 11.5,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: 0.6,
            }}>
              {palette.label}
            </span>
            <span style={{ fontSize: 10.5, color: streaming ? "var(--green)" : "var(--text-3)" }}>
              {streaming ? "● live" : "○ polling"}
            </span>
          </div>
        </header>

        {pendingEsc.length > 0 && (
          <section style={{ ...cardStyle, borderColor: "rgba(255, 184, 0, 0.4)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <ShieldAlert size={16} style={{ color: "var(--amber)" }} />
              <h2 style={{ ...cardTitleStyle, margin: 0 }}>Pending escalations</h2>
              <span style={{ fontSize: 11, color: "var(--text-2)" }}>({pendingEsc.length})</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {pendingEsc.map((e) => (
                <EscalationRow
                  key={e.id}
                  esc={e}
                  isPoster={isPoster}
                  busy={resolving[e.id]}
                  onResolve={resolveEscalation}
                />
              ))}
            </div>
            {!isPoster && (
              <div style={{ ...muted, marginTop: 10 }}>
                <AlertTriangle size={12} /> Only the mission poster can approve or reject escalations. Connect that wallet to act.
              </div>
            )}
          </section>
        )}

        <section style={cardStyle}>
          <h2 style={cardTitleStyle}>Audit timeline</h2>
          {audit.length === 0 ? (
            <div style={muted}>No steps logged yet.</div>
          ) : (
            <ol style={timelineStyle}>
              {audit.map((step) => (
                <TimelineRow key={step.id} step={step} />
              ))}
            </ol>
          )}
        </section>

        {escalations.length > pendingEsc.length && (
          <section style={cardStyle}>
            <h2 style={cardTitleStyle}>Resolved escalations</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {escalations.filter((e) => e.status !== "pending").map((e) => (
                <EscalationRow key={e.id} esc={e} readOnly />
              ))}
            </div>
          </section>
        )}

        <section style={cardStyle}>
          <h2 style={cardTitleStyle}>Inputs</h2>
          <pre style={{
            background: "var(--bg-input)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: 12,
            fontSize: 11.5,
            color: "var(--text-1)",
            overflow: "auto",
            maxHeight: 280,
          }}>
{JSON.stringify(mission.inputs_json || {}, null, 2)}
          </pre>
          <div style={{ ...muted, marginTop: 10 }}>
            <span>Audit root:</span>
            <code style={codeStyle}>{mission.audit_root || "—"}</code>
          </div>
        </section>

        {error && <div style={errorStyle}>{error}</div>}
      </div>

      <style jsx global>{`
        @keyframes ms-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function TimelineRow({ step }) {
  return (
    <li style={{
      position: "relative",
      paddingLeft: 22,
      paddingBottom: 14,
      borderLeft: "1px dashed var(--border)",
      marginLeft: 8,
    }}>
      <span style={{
        position: "absolute",
        left: -7,
        top: 2,
        width: 14, height: 14, borderRadius: 99,
        background: "var(--bg-card)",
        border: "1px solid var(--accent-border)",
        boxShadow: "var(--accent-glow)",
      }} />
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-jetbrains-mono, monospace)" }}>
          #{step.step_seq}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>{step.action_type}</span>
        {step.role && <span style={{ fontSize: 11, color: "var(--text-2)" }}>· {step.role}</span>}
        <span style={{ fontSize: 11, color: "var(--text-3)", marginLeft: "auto" }}>{formatTime(step.created_at)}</span>
      </div>
      {step.agent_wallet && (
        <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 3 }}>
          Agent <code style={codeStyle}>{shortWallet(step.agent_wallet)}</code>
        </div>
      )}
      <details style={{ marginTop: 4 }}>
        <summary style={{ cursor: "pointer", fontSize: 11.5, color: "var(--text-2)" }}>Payload</summary>
        <pre style={{
          marginTop: 6,
          padding: 8,
          background: "var(--bg-input)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          fontSize: 11,
          color: "var(--text-1)",
          overflow: "auto",
          maxHeight: 200,
        }}>{JSON.stringify(step.payload_json || {}, null, 2)}</pre>
      </details>
    </li>
  );
}

function EscalationRow({ esc, isPoster, busy, readOnly, onResolve }) {
  const decided = esc.status !== "pending";
  return (
    <div style={{
      display: "flex",
      gap: 10,
      alignItems: "center",
      flexWrap: "wrap",
      padding: 10,
      borderRadius: 9,
      border: "1px solid var(--border)",
      background: "var(--bg-card)",
    }}>
      <span style={{
        width: 28, height: 28, borderRadius: 8,
        background: decided ? "var(--bg-input)" : "rgba(255, 184, 0, 0.12)",
        border: `1px solid ${decided ? "var(--border)" : "rgba(255, 184, 0, 0.4)"}`,
        color: decided ? "var(--text-2)" : "var(--amber)",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}><Clock size={14} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: "var(--text-1)", fontWeight: 700 }}>
          {esc.action_type} <span style={{ color: "var(--text-3)", fontWeight: 500 }}>(step #{esc.step_seq ?? "—"})</span>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-2)" }}>
          via {esc.channel} · {formatTime(esc.created_at)}
          {decided && (
            <> · <span style={{ color: "var(--text-1)", fontWeight: 600 }}>{esc.status}</span>
              {esc.decided_by_wallet && <> by <code style={codeStyle}>{shortWallet(esc.decided_by_wallet)}</code></>}
            </>
          )}
        </div>
      </div>
      {!readOnly && !decided && isPoster && (
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={() => onResolve(esc.id, "approved")}
            disabled={busy}
            style={{ ...primaryBtn, padding: "6px 10px" }}
          >
            <Check size={12} /> <span>Approve</span>
          </button>
          <button
            type="button"
            onClick={() => onResolve(esc.id, "rejected")}
            disabled={busy}
            style={{ ...ghostBtn, padding: "6px 10px", color: "var(--red)", borderColor: "rgba(255,77,77,0.4)" }}
          >
            <XIcon size={12} /> <span>Reject</span>
          </button>
        </div>
      )}
    </div>
  );
}

function shortWallet(w) {
  if (!w) return "—";
  if (w.length <= 16) return w;
  return `${w.slice(0, 6)}…${w.slice(-6)}`;
}

function formatTime(s) {
  if (!s) return "—";
  try {
    const d = new Date(s);
    return d.toLocaleString();
  } catch {
    return String(s);
  }
}

const pageStyle = { minHeight: "100vh", background: "var(--bg-app)" };
const containerStyle = { maxWidth: 920, margin: "0 auto", padding: "32px 20px 64px", display: "flex", flexDirection: "column", gap: 14 };
const headerStyle = {
  display: "flex",
  alignItems: "flex-start",
  gap: 14,
  flexWrap: "wrap",
};
const cardStyle = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 18,
};
const cardTitleStyle = { fontSize: 13, fontWeight: 800, color: "var(--text-1)", margin: "0 0 10px" };
const muted = { fontSize: 12, color: "var(--text-2)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
const timelineStyle = {
  listStyle: "none",
  padding: 0,
  margin: 0,
};
const codeStyle = {
  fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
  fontSize: 11,
  background: "var(--bg-input)",
  border: "1px solid var(--border)",
  padding: "1px 5px",
  borderRadius: 5,
  color: "var(--text-1)",
};
const linkStyle = { color: "var(--accent)", textDecoration: "none", fontWeight: 700 };
const primaryBtn = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "9px 14px",
  borderRadius: 9,
  background: "linear-gradient(135deg, #a855f7, #60a5fa)",
  color: "#fff",
  fontSize: 12, fontWeight: 700,
  border: "1px solid var(--accent-border)",
  cursor: "pointer",
};
const ghostBtn = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "9px 12px",
  borderRadius: 9,
  background: "var(--bg-card)",
  color: "var(--text-1)",
  fontSize: 12, fontWeight: 600,
  border: "1px solid var(--border)",
  cursor: "pointer",
  textDecoration: "none",
};
const emptyStyle = {
  padding: 40, textAlign: "center",
  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
  color: "var(--text-2)", fontSize: 13,
};
const errorStyle = {
  padding: 12, borderRadius: 9,
  background: "rgba(255, 77, 77, 0.08)",
  border: "1px solid rgba(255, 77, 77, 0.3)",
  color: "var(--red)",
  fontSize: 12,
};
