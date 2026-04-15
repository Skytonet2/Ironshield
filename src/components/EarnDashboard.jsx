"use client";
// EarnDashboard — creator revenue-share panel, embedded in ProfileModal's "Earn" tab
// (and reusable on /leaderboard for the user's own row).
//
// Pulls /api/revenue/creator/:wallet → renders rank, est revenue, score breakdown,
// stake multiplier callout, and (when applicable) the new-creator 90-day matching badge.

import { useEffect, useState } from "react";
import {
  Trophy, TrendingUp, Zap, CheckCircle2, Heart, MessageCircle, Sparkles,
  Coins, Sprout, Loader2, ArrowRight, Info,
} from "lucide-react";
import { useTheme } from "@/lib/contexts";
import { IRONCLAW_SYMBOL } from "@/lib/ironclaw";

const API = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

const ICONS = {
  tips:      Zap,
  validated: CheckCircle2,
  likes:     Heart,
  comments:  MessageCircle,
  alpha:     Sparkles,
};
const LABELS = {
  tips:      "Tips received",
  validated: "Validated posts",
  likes:     "Likes received",
  comments:  "Comments received",
  alpha:     "Alpha calls",
};

export default function EarnDashboard({ wallet, isMine }) {
  const t = useTheme();
  const [data, setData] = useState(null);
  const [err, setErr]   = useState("");

  useEffect(() => {
    let cancel = false;
    if (!wallet) return;
    setErr("");
    (async () => {
      try {
        const r = await fetch(`${API}/api/revenue/creator/${encodeURIComponent(wallet)}`);
        if (!r.ok) throw new Error(`revenue ${r.status}`);
        const j = await r.json();
        if (!cancel) setData(j);
      } catch (e) {
        if (!cancel) setErr(e?.message || "Couldn't load earnings");
      }
    })();
    return () => { cancel = true; };
  }, [wallet]);

  if (err) {
    return <div style={{ padding: 20, color: t.textMuted, textAlign: "center", fontSize: 13 }}>{err}</div>;
  }
  if (!data) {
    return <div style={{ padding: 30, display: "grid", placeItems: "center", color: t.textMuted }}>
      <Loader2 size={18} className="ix-spin" />
    </div>;
  }

  const rankDisplay = data.rank ? `#${data.rank}` : "—";
  const totalActive = data.activeCreators || 0;

  return (
    <div style={{ padding: "12px 4px", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Hero stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        <HeroStat t={t} icon={<Trophy size={16} color="#f5b301" />} label="Rank"
          value={rankDisplay}
          sub={totalActive ? `of ${totalActive} creators` : "no scoring activity"} />
        <HeroStat t={t} icon={<TrendingUp size={16} color="#22c55e" />} label="Est. monthly"
          value={`$${(data.estRevenueUsd || 0).toFixed(2)}`}
          sub={`${(data.sharePct || 0).toFixed(2)}% of $${data.monthlyPoolUsd.toLocaleString()} pool`} />
        <HeroStat t={t} icon={<Coins size={16} color={t.amber} />} label="Tips earned"
          value={`$${(data.breakdown.tips.usd || 0).toFixed(2)}`}
          sub={`${data.breakdown.tips.count} tip${data.breakdown.tips.count === 1 ? "" : "s"} this period`} />
      </div>

      {/* New-creator matching banner */}
      {data.isNewCreator && (
        <div style={{
          padding: "10px 12px", borderRadius: 12, display: "flex", alignItems: "center", gap: 8,
          background: `${t.accent}14`, border: `1px solid ${t.accent}55`, color: t.text, fontSize: 12,
        }}>
          <Sprout size={14} color={t.accent} />
          <strong style={{ color: t.accent }}>+{Math.round(data.newCreatorBonus * 100)}% new-creator boost</strong>
          <span style={{ color: t.textMuted }}>
            · 90-day matching applied to your score. Keep posting to climb the leaderboard.
          </span>
        </div>
      )}

      {/* Stake multiplier */}
      <div style={{
        padding: "10px 12px", borderRadius: 12, display: "flex", alignItems: "center", gap: 8,
        background: t.bgSurface, border: `1px solid ${t.border}`, fontSize: 12,
      }}>
        <Coins size={14} color={t.amber} />
        <span style={{ color: t.text }}>
          Stake multiplier: <strong style={{ color: data.stakeMultiplier > 1 ? "#22c55e" : t.textMuted }}>
            ×{data.stakeMultiplier.toFixed(2)}
          </strong>
        </span>
        {data.stakeMultiplier === 1 && (
          <a href="/#staking" style={{ marginLeft: "auto", color: t.amber, textDecoration: "none",
            fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 3 }}>
            Stake to ×1.5 <ArrowRight size={11} />
          </a>
        )}
      </div>

      {/* Score breakdown */}
      <div style={{
        padding: 14, borderRadius: 12, background: t.bgCard, border: `1px solid ${t.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <Info size={13} color={t.textMuted} />
          <span style={{ color: t.white, fontWeight: 700, fontSize: 13 }}>Score breakdown</span>
          <span style={{ color: t.textDim, fontSize: 11 }}>· last {data.periodDays} days</span>
          <div style={{ flex: 1 }} />
          <span style={{ color: t.textMuted, fontSize: 11 }}>
            base {Math.round(data.baseScore)}{" "}
            {data.stakeMultiplier !== 1 && <>× {data.stakeMultiplier.toFixed(2)} </>}
            {data.newCreatorBonus > 0 && <>× {(1 + data.newCreatorBonus).toFixed(2)} </>}
            = <strong style={{ color: t.white }}>{Math.round(data.finalScore)}</strong>
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {Object.entries(data.breakdown).map(([k, v]) => (
            <BreakdownRow key={k} t={t} kind={k} row={v} maxPoints={Math.max(1, ...Object.values(data.breakdown).map(b => b.points))} />
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 4px", color: t.textDim, fontSize: 11 }}>
        <span>Pool resets monthly. Distributions paid in {IRONCLAW_SYMBOL} once token launches.</span>
        <a href="/leaderboard/" style={{ color: t.amber, textDecoration: "none", fontWeight: 700,
          display: "inline-flex", alignItems: "center", gap: 3 }}>
          See leaderboard <ArrowRight size={11} />
        </a>
      </div>
    </div>
  );
}

function HeroStat({ t, icon, label, value, sub }) {
  return (
    <div style={{
      padding: "12px 14px", borderRadius: 12, background: t.bgCard, border: `1px solid ${t.border}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: t.textMuted, fontSize: 11, fontWeight: 700 }}>
        {icon} <span>{label}</span>
      </div>
      <div style={{ color: t.white, fontSize: 22, fontWeight: 800, marginTop: 4 }}>{value}</div>
      <div style={{ color: t.textDim, fontSize: 11 }}>{sub}</div>
    </div>
  );
}

function BreakdownRow({ t, kind, row, maxPoints }) {
  const Icon = ICONS[kind];
  const pct = maxPoints > 0 ? (row.points / maxPoints) * 100 : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, width: 150, color: t.textMuted }}>
        <Icon size={12} /> {LABELS[kind]}
      </span>
      <div style={{ flex: 1, height: 6, background: t.bgSurface, borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%",
          background: `linear-gradient(90deg, ${t.accent}, ${t.amber})` }} />
      </div>
      <span style={{ width: 78, textAlign: "right", color: t.text, fontWeight: 600 }}>
        {row.count} × {row.weight}
      </span>
      <span style={{ width: 56, textAlign: "right", color: t.white, fontWeight: 800 }}>
        {Math.round(row.points)}
      </span>
    </div>
  );
}
