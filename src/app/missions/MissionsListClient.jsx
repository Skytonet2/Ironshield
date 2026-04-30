"use client";
// /missions list — every mission the wallet posted or is claimed by.
//
// Reads from `/api/missions?mine=1` (the existing missions.route.js
// list endpoint). Renders cards with status / Kit / created date /
// short claimant handle. Each row links to `/missions/[id]` for the
// full timeline + audit log + escalations panel.
//
// Empty-state nudges the user back to `/marketplace/kits` so they
// can deploy something — a missions list with no missions and no
// CTA reads as "the platform is broken" even when it isn't.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Target, ArrowRight, Package } from "lucide-react";
import { useWallet } from "@/lib/contexts";
import { API_BASE } from "@/lib/apiBase";

const STATUS_STYLE = {
  open:      { bg: "rgba(96, 165, 250, 0.18)", color: "#60a5fa", label: "Open" },
  claimed:   { bg: "rgba(168, 85, 247, 0.18)", color: "#a855f7", label: "Working" },
  submitted: { bg: "rgba(245, 158, 11, 0.18)", color: "#f59e0b", label: "Awaiting review" },
  approved:  { bg: "rgba(16, 185, 129, 0.20)", color: "#10b981", label: "Approved" },
  rejected:  { bg: "rgba(239, 68, 68, 0.20)",  color: "#ef4444", label: "Rejected" },
  expired:   { bg: "rgba(156, 163, 175, 0.18)", color: "#9ca3af", label: "Expired" },
  aborted:   { bg: "rgba(156, 163, 175, 0.18)", color: "#9ca3af", label: "Aborted" },
  pending_payment: { bg: "rgba(245, 158, 11, 0.18)", color: "#f59e0b", label: "Awaiting payment" },
};

function fmtDate(s) {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function shortAccount(a) {
  if (!a) return "—";
  if (a.length <= 22) return a;
  return `${a.slice(0, 10)}…${a.slice(-8)}`;
}

export default function MissionsListClient() {
  const { address: wallet } = useWallet?.() || {};
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);

  const headers = useMemo(() => {
    const h = { "Content-Type": "application/json" };
    if (wallet) h["x-wallet"] = String(wallet).toLowerCase();
    return h;
  }, [wallet]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!wallet) {
        // No wallet linked yet — show the unauthenticated empty state.
        setRows([]);
        setStatus("no-wallet");
        return;
      }
      setStatus("loading");
      try {
        const r = await fetch(`${API_BASE}/api/missions?mine=1&limit=100`, { headers });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        if (cancelled) return;
        setRows(Array.isArray(j.missions) ? j.missions : []);
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setError(e.message);
        setStatus("error");
      }
    }
    load();
    return () => { cancelled = true; };
  }, [wallet, headers]);

  return (
    // data-app-shell="ready" unmounts the boot PreLoader. Without it
    // the splash hangs at 65% on standalone pages.
    <div data-app-shell="ready" style={page}>
      <div style={shell}>
        <header style={head}>
          <div>
            <div style={eyebrow}>Your missions</div>
            <h1 style={title}>What your agent's working on</h1>
            <div style={subtle}>
              Each row is a job your agent is running, has finished, or paid out on. Tap into one to see the live audit log + any escalations waiting on your approval.
            </div>
          </div>
        </header>

        {status === "loading" && (
          <div style={empty}>
            <Loader2 size={18} style={{ animation: "ml-spin 0.9s linear infinite" }} />
            <span>Loading…</span>
          </div>
        )}

        {status === "no-wallet" && (
          <div style={empty}>
            <Target size={20} style={{ color: "var(--text-3)" }} />
            <div>
              Connect a wallet to see your missions. Once your agent posts or claims a job, it'll show up here.
            </div>
          </div>
        )}

        {status === "error" && (
          <div style={errBox}>{error || "Couldn't load missions."}</div>
        )}

        {status === "ready" && rows.length === 0 && (
          <div style={empty}>
            <Package size={20} style={{ color: "var(--text-3)" }} />
            <div>
              No missions yet. <Link href="/marketplace/kits" style={link}>Pick a Kit →</Link> and deploy your first agent.
            </div>
          </div>
        )}

        {status === "ready" && rows.length > 0 && (
          <div style={list}>
            {rows.map((m) => {
              const s = STATUS_STYLE[m.status] || { bg: "var(--bg-card)", color: "var(--text-2)", label: m.status };
              return (
                <Link key={m.on_chain_id} href={`/missions/${m.on_chain_id}`} style={row}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
                    <span style={{
                      display: "inline-flex", padding: "3px 10px", borderRadius: 999,
                      background: s.bg, color: s.color,
                      fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
                      flexShrink: 0,
                    }}>{s.label}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {m.kit_slug || m.template_slug || `Mission #${m.on_chain_id}`}
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--text-2)", marginTop: 2 }}>
                        #{m.on_chain_id}
                        {m.claimant_wallet ? <> · agent <code style={code}>{shortAccount(m.claimant_wallet)}</code></> : null}
                        {m.created_at ? <> · {fmtDate(m.created_at)}</> : null}
                      </div>
                    </div>
                  </div>
                  <ArrowRight size={14} style={{ color: "var(--text-3)", flexShrink: 0, marginLeft: 12 }} />
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <style jsx global>{`
        @keyframes ml-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

const page = {
  minHeight: "100vh",
  background: "var(--bg-app)",
  display: "flex",
  justifyContent: "center",
  padding: "32px 16px",
};

const shell = {
  width: "100%",
  maxWidth: 880,
  display: "flex",
  flexDirection: "column",
  gap: 18,
};

const head = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: "0 4px 6px",
};

const eyebrow = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: 1.2,
  color: "var(--accent)",
  textTransform: "uppercase",
};

const title = {
  margin: "4px 0 6px",
  fontSize: "clamp(22px, 3vw, 28px)",
  fontWeight: 800,
  color: "var(--text-1)",
  letterSpacing: -0.4,
  lineHeight: 1.2,
};

const subtle = {
  fontSize: 13,
  color: "var(--text-2)",
  lineHeight: 1.55,
  maxWidth: 560,
};

const list = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 8,
};

const row = {
  display: "flex",
  alignItems: "center",
  padding: "12px 14px",
  borderRadius: 10,
  background: "transparent",
  border: "1px solid transparent",
  textDecoration: "none",
  color: "inherit",
  transition: "background 120ms ease, border-color 120ms ease",
};

const empty = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "20px 18px",
  borderRadius: 12,
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  fontSize: 13,
  color: "var(--text-2)",
};

const errBox = {
  padding: "12px 14px",
  borderRadius: 10,
  background: "rgba(255, 77, 77, 0.08)",
  border: "1px solid rgba(255, 77, 77, 0.3)",
  color: "var(--red)",
  fontSize: 13,
};

const link = {
  color: "var(--accent)",
  textDecoration: "none",
  fontWeight: 700,
};

const code = {
  fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
  fontSize: 11,
  background: "var(--bg-card)",
  padding: "1px 5px",
  borderRadius: 4,
  border: "1px solid var(--border)",
};
