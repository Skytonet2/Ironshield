"use client";
// /rewards — Uxento-style rewards dashboard.
//
// Top header card with chain tabs on the left, user identity in the
// middle, and a rank / volume / next-tier stack on the right. Below
// it: a tab strip (uPoints · uStore · Referrals · Leaderboard ·
// Launchpads · uBurn) and tab-specific panels. The uPoints tab shows
// Total, Points Breakdown, "How to Earn" tiles, and a 7-day chart.
//
// Data points are placeholder zeros for now — once the rewards
// program wiring lands, all the `stats.*` fields read from the
// /api/rewards/me endpoint.

import { useMemo, useState } from "react";
import { useTheme, useWallet } from "@/lib/contexts";
import AppShell from "@/components/shell/AppShell";
import {
  Award, Rocket, Activity, Crosshair, Users, Store, Trophy, Flame,
  Medal, ChevronDown, Info, Copy as CopyIcon, BarChart3,
} from "lucide-react";

const CHAINS = [
  { key: "sol", label: "SOL", iconBg: "linear-gradient(135deg, #8b5cf6, #38bdf8)" },
  { key: "bnb", label: "BNB", iconBg: "linear-gradient(135deg, #facc15, #f59e0b)" },
  { key: "eth", label: "ETH", iconBg: "linear-gradient(135deg, #6366f1, #818cf8)" },
];

const TABS = [
  { key: "points",      label: "uPoints" },
  { key: "store",       label: "uStore" },
  { key: "referrals",   label: "Referrals" },
  { key: "leaderboard", label: "Leaderboard" },
  { key: "launchpads",  label: "Launchpads" },
  { key: "burn",        label: "uBurn" },
];

const TIERS = [
  { key: "bronze", label: "BRONZE", color: "#d97706", threshold: 0 },
  { key: "silver", label: "SILVER", color: "#94a3b8", threshold: 10 },
  { key: "gold",   label: "GOLD",   color: "#f59e0b", threshold: 50 },
  { key: "plat",   label: "PLATINUM", color: "#a78bfa", threshold: 250 },
];

const HOW_TO_EARN = [
  {
    key: "launches",
    Icon: Rocket,
    title: "uDev Launches",
    accent: "1 launch = 1 uPoint",
    hint: "Create coins with uDev to earn points",
    color: "var(--green)",
  },
  {
    key: "volume",
    Icon: Activity,
    title: "Trading Volume",
    accent: "0.1 SOL = 0.1 uPoint",
    hint: "Buy, sell, or create — all volume counts",
    color: "#60a5fa",
  },
  {
    key: "tracker",
    Icon: Crosshair,
    title: "Tracker Claims",
    accent: "5 uPoints per claim",
    hint: "Claim rewards when tracker alerts pop up",
    color: "#a78bfa",
  },
  {
    key: "referrals",
    Icon: Users,
    title: "Referrals",
    accent: "Earn from referees",
    hint: "Get points when your referrals earn",
    color: "#f59e0b",
  },
];

export default function RewardsPage() {
  const t = useTheme();
  const { address } = useWallet();
  const [chain, setChain] = useState("sol");
  const [tab, setTab] = useState("points");

  // Placeholder stats — the backend rewards endpoint lands alongside
  // the governance vote on the reward program. Zeros keep the UI
  // coherent (no NaN / undefined leaks) until then.
  const stats = useMemo(() => ({
    rank: 0,
    volume: 0,
    totalPoints: 0,
    creation: 0,
    tracker: 0,
    volumePoints: 0,
    referrals: 0,
    tier: TIERS[0],
    nextTier: TIERS[1],
    nextTierProgress: 0, // current volume counted toward tier threshold
  }), []);

  const short = useMemo(() => {
    if (!address) return "user-guest";
    const s = address;
    if (s.endsWith(".near")) return s;
    return s.length > 12 ? `user-${s.slice(2, 10)}` : `user-${s}`;
  }, [address]);

  return (
    <AppShell>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "16px" }}>
        {/* HEADER CARD */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 14,
          padding: 16,
          borderRadius: 14,
          border: `1px solid ${t.border}`,
          background: "radial-gradient(120% 120% at 0% 0%, rgba(249,115,22,0.08), transparent 60%), var(--bg-card)",
          marginBottom: 14,
        }}
        className="ix-rewards-header">
          <style jsx>{`
            @media (min-width: 760px) {
              .ix-rewards-header { grid-template-columns: minmax(0, 1fr) minmax(320px, 480px); }
            }
          `}</style>
          {/* LEFT — chain tabs + identity */}
          <div>
            <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
              {CHAINS.map((c) => {
                const active = c.key === chain;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setChain(c.key)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      padding: "6px 10px", borderRadius: 8,
                      border: `1px solid ${active ? t.accent : t.border}`,
                      background: active ? "var(--accent-dim)" : "transparent",
                      color: active ? t.white : t.textMuted,
                      fontSize: 12, fontWeight: 700, cursor: "pointer",
                    }}
                  >
                    <span style={{
                      width: 14, height: 14, borderRadius: 3,
                      background: c.iconBg,
                    }} />
                    {c.label}
                  </button>
                );
              })}
            </div>

            <div style={{
              display: "flex", flexDirection: "column",
              alignItems: "center", textAlign: "center",
              padding: "8px 0 4px",
            }}>
              <div style={{
                width: 84, height: 84, borderRadius: "50%",
                background: "linear-gradient(135deg, #cbd5e1, #64748b)",
                border: `2px solid ${t.border}`,
                marginBottom: 10,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#fff", fontWeight: 800, fontSize: 28,
              }}>
                {(address ? address[0]?.toUpperCase() : "?") || "?"}
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: t.white }}>
                {short}
              </div>
              <a
                href={`/profile${address ? `?address=${encodeURIComponent(address)}` : ""}`}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  color: t.textDim, fontSize: 12, textDecoration: "none",
                  marginTop: 4,
                }}
              >
                app.ironshield.io/@{short}
                <CopyIcon size={11} />
              </a>
              <button
                type="button"
                style={{
                  marginTop: 8,
                  padding: "4px 10px", background: "transparent", border: "none",
                  color: t.textDim, fontSize: 12, cursor: "pointer",
                  display: "inline-flex", alignItems: "center", gap: 4,
                }}
              >
                <Users size={12} />
                Set who referred you
              </button>
              <TierBadge tier={stats.tier} style={{ marginTop: 8 }} t={t} />
            </div>
          </div>

          {/* RIGHT — rank, volume, next tier */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12,
            }}>
              <StatTile label="RANK" value={`#${stats.rank}`} Icon={Medal} color="#d97706" t={t} />
              <StatTile label="VOLUME" value={`$${stats.volume.toFixed(2)}`} Icon={BarChart3} color="#f97316" t={t} />
            </div>

            <div style={{
              padding: 14, borderRadius: 12,
              border: `1px solid ${t.border}`, background: "var(--bg-surface)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>Next Tier</div>
                </div>
                <TierBadge tier={stats.nextTier} t={t} />
              </div>
              <div style={{ fontSize: 12, color: t.textDim, marginBottom: 8 }}>
                {stats.nextTierProgress} SOL / {stats.nextTier.threshold} SOL
                <span style={{ float: "right", color: t.amber, fontWeight: 700 }}>
                  {Math.max(0, stats.nextTier.threshold - stats.nextTierProgress)} SOL left
                </span>
              </div>
              <div style={{
                height: 4, borderRadius: 999,
                background: "var(--bg-input)",
                overflow: "hidden",
              }}>
                <div style={{
                  width: `${Math.min(100, 100 * stats.nextTierProgress / (stats.nextTier.threshold || 1))}%`,
                  height: "100%",
                  background: `linear-gradient(90deg, ${t.accent}, #0ea5e9)`,
                }} />
              </div>
              <div style={{
                marginTop: 8, textAlign: "center", fontSize: 11,
                color: "var(--green)", fontWeight: 700, letterSpacing: 0.4,
              }}>
                → UNLOCK <span style={{ color: "var(--green)" }}>2.5% OFF</span>
              </div>
            </div>

            <button
              type="button"
              style={{
                padding: "10px 12px", borderRadius: 12,
                border: `1px solid ${t.border}`, background: "var(--bg-surface)",
                color: t.text, fontSize: 13, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
              }}
            >
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Next Tiers</div>
                <Info size={12} color={t.textDim} />
              </div>
              <TierBadge tier={TIERS[0]} t={t} />
              <ChevronDown size={16} color={t.textDim} />
            </button>
          </div>
        </div>

        {/* TAB STRIP */}
        <div style={{
          display: "flex", gap: 2,
          borderBottom: `1px solid ${t.border}`,
          marginBottom: 14,
          overflowX: "auto",
        }}>
          {TABS.map((x) => {
            const active = x.key === tab;
            return (
              <button
                key={x.key}
                type="button"
                onClick={() => setTab(x.key)}
                style={{
                  padding: "10px 14px", background: "transparent", border: "none",
                  fontSize: 13, fontWeight: active ? 700 : 500,
                  color: active ? t.accent : t.textDim,
                  borderBottom: `2px solid ${active ? t.accent : "transparent"}`,
                  cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                {x.label}
              </button>
            );
          })}
        </div>

        {tab === "points" && (
          <PointsTab stats={stats} t={t} />
        )}

        {tab !== "points" && (
          <div style={{
            padding: 40, color: t.textDim, fontSize: 13, textAlign: "center",
            border: `1px dashed ${t.border}`, borderRadius: 10,
          }}>
            {TABS.find((x) => x.key === tab)?.label} — coming next build.
          </div>
        )}
      </div>
    </AppShell>
  );
}

/* ── Tiles ─────────────────────────────────────────────────────── */

function StatTile({ label, value, Icon, color, t }) {
  return (
    <div style={{
      padding: 14, borderRadius: 12,
      border: `1px solid ${t.border}`, background: "var(--bg-surface)",
    }}>
      <div style={{ fontSize: 11, letterSpacing: 0.8, color: t.textDim, fontWeight: 600, textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
        <Icon size={18} color={color} />
        <div style={{ fontSize: 22, fontWeight: 800, color }}>
          {value}
        </div>
      </div>
    </div>
  );
}

function TierBadge({ tier, style, t }) {
  if (!tier) return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "4px 10px", borderRadius: 999,
      border: `1px solid ${tier.color}`,
      background: `${tier.color}22`,
      color: tier.color,
      fontSize: 11, fontWeight: 700, letterSpacing: 0.6,
      ...(style || {}),
    }}>
      <Award size={11} />
      {tier.label}
    </span>
  );
}

/* ── uPoints tab ───────────────────────────────────────────────── */

function PointsTab({ stats, t }) {
  const SEGMENTS = [
    { key: "creation", label: "Creation",  value: stats.creation,     color: "var(--green)" },
    { key: "tracker",  label: "Tracker",   value: stats.tracker,      color: "#a78bfa" },
    { key: "volume",   label: "Volume",    value: stats.volumePoints, color: "#60a5fa" },
    { key: "referrals",label: "Referrals", value: stats.referrals,    color: "#f59e0b" },
  ];
  const total = SEGMENTS.reduce((a, b) => a + (b.value || 0), 0) || 1;

  return (
    <>
      {/* Total + Breakdown */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr",
        gap: 12, marginBottom: 14,
      }}
      className="ix-points-grid">
        <style jsx>{`
          @media (min-width: 760px) {
            .ix-points-grid { grid-template-columns: minmax(260px, 360px) 1fr; }
          }
        `}</style>
        <div style={{
          padding: 16, borderRadius: 12,
          border: `1px solid ${t.border}`, background: "var(--bg-card)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: t.textDim, fontSize: 12, fontWeight: 600 }}>
            <Trophy size={12} color="#f97316" />
            Total uPoints
          </div>
          <div style={{ fontSize: 56, fontWeight: 800, color: "#f97316", lineHeight: 1, marginTop: 12 }}>
            {stats.totalPoints}
          </div>
        </div>

        <div style={{
          padding: 16, borderRadius: 12,
          border: `1px solid ${t.border}`, background: "var(--bg-card)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <BarChart3 size={13} color={t.textDim} />
            <div style={{ fontSize: 13, color: t.text, fontWeight: 600 }}>Points Breakdown</div>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 12, color: t.text, fontWeight: 700 }}>{stats.totalPoints} uPoints</div>
          </div>
          <div style={{
            display: "flex", gap: 2, height: 6, borderRadius: 999, overflow: "hidden",
            background: "var(--bg-input)",
          }}>
            {SEGMENTS.map((s) => (
              <div
                key={s.key}
                style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
              />
            ))}
          </div>
          <div style={{
            display: "grid", gap: 10,
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            marginTop: 12,
          }}>
            {SEGMENTS.map((s) => (
              <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color }} />
                <span style={{ color: t.textDim }}>{s.label}</span>
                <span style={{ flex: 1 }} />
                <span style={{ color: t.text, fontWeight: 700 }}>{s.value}</span>
                <span style={{ color: t.textDim }}>({Math.round((s.value / total) * 100)}%)</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* How to Earn */}
      <div style={{
        padding: 16, borderRadius: 12,
        border: `1px solid ${t.border}`, background: "var(--bg-card)",
        marginBottom: 14,
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: t.text, marginBottom: 12 }}>
          How to Earn uPoints
        </div>
        <div style={{
          display: "grid", gap: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        }}>
          {HOW_TO_EARN.map((x) => {
            const { Icon } = x;
            return (
              <div
                key={x.key}
                style={{
                  padding: 12, borderRadius: 10,
                  border: `1px solid ${t.border}`, background: "var(--bg-surface)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{
                    width: 28, height: 28, borderRadius: 8,
                    background: `${x.color}22`, color: x.color,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Icon size={14} />
                  </span>
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{x.title}</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: x.color, marginTop: 2 }}>
                  {x.accent}
                </div>
                <div style={{ fontSize: 12, color: t.textDim, marginTop: 4, lineHeight: 1.4 }}>
                  {x.hint}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Daily chart + distribution */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr",
        gap: 12,
      }}
      className="ix-charts-grid">
        <style jsx>{`
          @media (min-width: 760px) {
            .ix-charts-grid { grid-template-columns: 1fr 1fr; }
          }
        `}</style>
        <div style={{
          padding: 16, borderRadius: 12,
          border: `1px solid ${t.border}`, background: "var(--bg-card)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <BarChart3 size={13} color={t.textDim} />
            <div style={{ fontSize: 13, color: t.text, fontWeight: 600 }}>Daily uPoints</div>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 11, color: t.textDim }}>Last 7 days</div>
          </div>
          <SparklineChart series={[0, 0, 0, 0, 0, 0, 0]} t={t} />
        </div>
        <div style={{
          padding: 16, borderRadius: 12,
          border: `1px solid ${t.border}`, background: "var(--bg-card)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Flame size={13} color="#f97316" />
            <div style={{ fontSize: 13, color: t.text, fontWeight: 600 }}>Points Distribution</div>
          </div>
          <DonutBreakdown segments={SEGMENTS} total={total} t={t} />
        </div>
      </div>
    </>
  );
}

function SparklineChart({ series, t }) {
  const max = Math.max(...series, 1);
  const pts = series.map((v, i) => {
    const x = (i / Math.max(series.length - 1, 1)) * 100;
    const y = 90 - (v / max) * 80;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: 140 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <line
          key={i}
          x1={0} x2={100}
          y1={10 + i * 20}
          y2={10 + i * 20}
          stroke={t.border}
          strokeWidth={0.4}
          strokeDasharray="2 3"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <polyline
        fill="none"
        stroke={t.accent}
        strokeWidth={1.2}
        points={pts}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function DonutBreakdown({ segments, total, t }) {
  // No real data yet — just renders the structure. When data lands,
  // each arc will be sized by `value / total`.
  const empty = total === 0 || segments.every((s) => s.value === 0);
  if (empty) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 140 }}>
        <div style={{ color: t.textDim, fontSize: 12 }}>No points yet — start earning to see the split.</div>
      </div>
    );
  }
  // Live path computation (kept simple, one ring).
  let acc = 0;
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <svg viewBox="-40 -40 80 80" width={140} height={140}>
        <circle r={r} fill="none" stroke={t.border} strokeWidth={8} />
        {segments.map((s) => {
          const frac = s.value / total;
          const dash = frac * c;
          const offset = -acc * c;
          acc += frac;
          return (
            <circle
              key={s.key}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={8}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={offset}
              transform="rotate(-90)"
            />
          );
        })}
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
        {segments.map((s) => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color }} />
            <span style={{ color: t.textDim }}>{s.label}</span>
            <span style={{ color: t.text, fontWeight: 700, marginLeft: 6 }}>{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
