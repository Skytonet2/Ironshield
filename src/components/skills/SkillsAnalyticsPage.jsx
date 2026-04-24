"use client";
// /skills/analytics — ecosystem-wide rollup of what's on-chain in the
// skills marketplace. Pulls real numbers (total skills listed, installs
// across the author's own catalogue, verified count) without requiring
// the viewer to be connected. Deeper per-skill charts come later — this
// page was added to patch a broken nav link rather than ship a full
// analytics surface.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, Package, CheckCircle2, TrendingUp, Loader2 } from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import useAgent from "@/hooks/useAgent";

function StatCard({ t, icon: Icon, value, label, sub }) {
  return (
    <div style={{
      background: t.bgCard, border: `1px solid ${t.border}`,
      borderRadius: 12, padding: "18px 20px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{
          width: 32, height: 32, borderRadius: 8,
          background: `${t.accent}22`, color: t.accent,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}><Icon size={16} /></span>
        <span style={{ fontSize: 12, color: t.textMuted, fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{
        fontSize: 30, fontWeight: 800, color: t.white, lineHeight: 1,
        fontFamily: "var(--font-jetbrains-mono), monospace",
      }}>{value}</div>
      {sub && (
        <div style={{ fontSize: 11, color: t.textDim, marginTop: 8 }}>{sub}</div>
      )}
    </div>
  );
}

export default function SkillsAnalyticsPage() {
  const t = useTheme();
  const { address } = useWallet?.() || {};
  const agent = useAgent();
  const agentRef = useRef(agent);
  agentRef.current = agent;

  const [loading, setLoading]  = useState(false);
  const [rollup, setRollup]    = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const a = agentRef.current;
      // list_skills is capped at 100 per call. For the early-stage catalog
      // that's enough for a total; we'll switch to paginated aggregation
      // once the registry grows past that.
      const rows = await a.listSkillsWithMetadata({ limit: 100, offset: 0 });
      const total        = rows.length;
      const totalInstalls = rows.reduce((n, { skill }) => n + Number(skill.install_count || 0), 0);
      const verified     = rows.filter(({ metadata }) => metadata?.verified).length;
      const yours        = address ? rows.filter(({ skill }) => skill.author === address).length : 0;
      setRollup({ total, totalInstalls, verified, yours });
    } catch {
      setRollup({ total: 0, totalInstalls: 0, verified: 0, yours: 0 });
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{
          fontSize: "clamp(24px, 2.4vw, 32px)", margin: 0,
          fontWeight: 800, color: t.white, letterSpacing: -0.4,
        }}>Skills Analytics</h1>
        <p style={{ fontSize: 13, color: t.textMuted, marginTop: 6 }}>
          Ecosystem rollup of the on-chain skills catalogue. Per-skill charts land in a later pass.
        </p>
      </header>

      {loading && !rollup && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: t.textMuted, fontSize: 13 }}>
          <Loader2 size={14} style={{ animation: "ma-spin 0.9s linear infinite" }} /> Loading catalogue…
        </div>
      )}

      {rollup && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 14, marginBottom: 24,
        }}>
          <StatCard t={t} icon={Package}       value={rollup.total}         label="Skills listed" />
          <StatCard t={t} icon={TrendingUp}    value={rollup.totalInstalls} label="Total installs" />
          <StatCard t={t} icon={CheckCircle2}  value={rollup.verified}      label="Verified" sub="Admin-reviewed" />
          <StatCard t={t} icon={BarChart3}     value={rollup.yours}         label="Your listings"
            sub={address ? "from the connected wallet" : "Connect a wallet to see yours"} />
        </div>
      )}

      <section style={{
        padding: "20px 22px",
        background: t.bgCard, border: `1px solid ${t.border}`,
        borderRadius: 14,
      }}>
        <h2 style={{ fontSize: 15, fontWeight: 800, color: t.white, margin: 0 }}>
          Per-skill dashboards
        </h2>
        <p style={{ fontSize: 13, color: t.textMuted, marginTop: 8, lineHeight: 1.55 }}>
          Install history, geo breakdowns, and revenue-over-time for each skill you author
          will appear here in a later update. For now, every skill's install count is
          visible on its <Link href="/skills" style={{ color: t.accent, fontWeight: 600, textDecoration: "none" }}>marketplace</Link> card.
        </p>
      </section>

      <style jsx global>{`
        @keyframes ma-spin { to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}
