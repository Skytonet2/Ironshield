"use client";
// ── TreasuryPage ─────────────────────────────────────────────────────
// IronClaw Treasury dashboard. Reads /api/newscoin/treasury and renders:
//   • 4 stat cards (Lifetime revenue / 24h revenue / Volume 7d / Coins)
//   • Live revenue feed (most recent fee slices, auto-refresh 20s)
//   • Payout schedule (next weekly distribution + breakdown)
//
// Treasury is funded by the 1% platform fee on every NewsCoin trade.
// Creators take 2% First-Mover fees separately (not shown here).
import { useEffect, useState } from "react";
import {
  Wallet, TrendingUp, Coins, Users, Flame, Clock,
  ArrowUpRight, ArrowDownRight, Loader2, RefreshCw,
} from "lucide-react";
import { useTheme } from "@/lib/contexts";

import { API_BASE as API } from "@/lib/apiBase";
const ORANGE = "#f97316";

function fmtNear(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return "0";
  if (n < 0.01) return n.toFixed(6);
  if (n < 1) return n.toFixed(4);
  if (n < 1000) return n.toFixed(2);
  if (n < 1_000_000) return `${(n / 1000).toFixed(2)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
function fmtInt(v) {
  const n = Number(v || 0);
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
function timeAgo(d) {
  if (!d) return "";
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
function shortWallet(w = "") {
  return w.length > 18 ? `${w.slice(0, 6)}…${w.slice(-6)}` : w;
}
function timeUntil(iso) {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "now";
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function TreasuryPage() {
  const t = useTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  // Day 16 — per-source revenue rollup (skill installs + NewsCoin
  // fees). Fetched in parallel with the legacy /newscoin/treasury
  // payload so the panel renders alongside without blocking.
  const [sources, setSources] = useState(null);

  const load = () => {
    setErr("");
    fetch(`${API}/api/newscoin/treasury`)
      .then(async r => {
        const text = await r.text();
        if (text.trimStart().startsWith("<")) throw new Error("Backend unreachable");
        const j = JSON.parse(text);
        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        return j;
      })
      .then(setData)
      .catch(e => setErr(e.message || "Failed to load"))
      .finally(() => setLoading(false));
    // Best-effort sources fetch — failures don't block the page.
    fetch(`${API}/api/treasury/sources`)
      .then(r => r.ok ? r.json() : null)
      .then(j => setSources(j?.sources || null))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, []);

  const cardStyle = {
    background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
    padding: 16,
  };

  if (loading && !data) {
    return (
      <div style={{ maxWidth: 980, margin: "0 auto", padding: 32, textAlign: "center", color: t.textDim }}>
        <Loader2 size={22} style={{ animation: "spin 1s linear infinite" }} />
        <div style={{ marginTop: 10, fontSize: 13 }}>Loading treasury…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const rev = data?.revenue_near || {};
  const vol = data?.volume_near || {};
  const coins = data?.coins || {};
  const trades = data?.trades || {};
  const feed = data?.feed || [];
  const payouts = data?.payouts || {};

  const stats = [
    {
      label: "Lifetime Revenue",
      value: `${fmtNear(rev.lifetime)} N`,
      sub: `${fmtInt(trades.lifetime)} trades`,
      icon: Wallet,
      color: ORANGE,
    },
    {
      label: "24h Revenue",
      value: `${fmtNear(rev.d24h)} N`,
      sub: `${fmtInt(trades.d24h)} trades · vol ${fmtNear(vol.d24h)} N`,
      icon: TrendingUp,
      color: t.green,
    },
    {
      label: "7d Volume",
      value: `${fmtNear(vol.d7d)} N`,
      sub: `Revenue ${fmtNear(rev.d7d)} N`,
      icon: Flame,
      color: "#fb923c",
    },
    {
      label: "Coins Launched",
      value: fmtInt(coins.total),
      sub: `${fmtInt(coins.graduated)} graduated`,
      icon: Coins,
      color: t.amber,
    },
  ];

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "16px 12px" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 16, gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <Wallet size={22} color={ORANGE} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: t.white }}>IronClaw Treasury</div>
            <div style={{ fontSize: 12, color: t.textMuted }}>
              Every NewsCoin trade pays 1% to the treasury. Distributed to $IRONCLAW stakers.
            </div>
          </div>
        </div>
        <button
          onClick={load}
          title="Refresh"
          style={{
            background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 10,
            padding: "8px 10px", color: t.textMuted, cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12,
          }}
        >
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {err && (
        <div style={{
          padding: "10px 14px", borderRadius: 10, background: `${t.red}15`,
          color: t.red, fontSize: 12, marginBottom: 12,
        }}>{err}</div>
      )}

      {/* 4 stat cards */}
      <div style={{
        display: "grid", gap: 10, marginBottom: 16,
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
      }}>
        {stats.map(s => (
          <div key={s.label} style={cardStyle}>
            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
              color: s.color, fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5,
            }}>
              <s.icon size={13} /> {s.label}
            </div>
            <div style={{
              fontSize: 26, fontWeight: 800, color: t.white,
              fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.1,
            }}>{s.value}</div>
            <div style={{ fontSize: 11, color: t.textDim, marginTop: 4 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Day 16 — Revenue sources panel. Renders only when the backend
          returns at least one source with non-zero lifetime revenue —
          on a brand-new deploy with no skill sales and no NewsCoin
          trades, the panel hides itself rather than show a row of
          zeros that's just visual noise. */}
      {sources && sources.some(s => s.lifetime_near > 0) && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: 0.5, color: t.textMuted, marginBottom: 10,
          }}>
            Revenue sources
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {sources.map(s => (
              <div key={s.key} style={{
                display: "grid",
                gridTemplateColumns: "1.4fr repeat(3, 1fr) 0.8fr",
                gap: 10, alignItems: "center",
                padding: "8px 10px", borderRadius: 8,
                background: t.bgSurface, fontSize: 12,
              }}>
                <span style={{ color: t.white, fontWeight: 700 }}>{s.label}</span>
                <span style={{ color: t.textDim }}>
                  Lifetime <strong style={{ color: t.white }}>{fmtNear(s.lifetime_near)} N</strong>
                </span>
                <span style={{ color: t.textDim }}>
                  24h <strong style={{ color: t.white }}>{fmtNear(s.d24h_near)} N</strong>
                </span>
                <span style={{ color: t.textDim }}>
                  7d <strong style={{ color: t.white }}>{fmtNear(s.d7d_near)} N</strong>
                </span>
                <span style={{ color: t.textDim, textAlign: "right" }}>
                  {fmtInt(s.tx_count)} tx
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Two-column: Revenue feed + Payout schedule */}
      <div style={{
        display: "grid", gap: 14,
        gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)",
      }} className="ix-treasury-grid">
        {/* Revenue feed */}
        <div style={cardStyle}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 10,
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.white, display: "flex", alignItems: "center", gap: 6 }}>
              <TrendingUp size={14} color={ORANGE} /> Revenue Feed
            </div>
            <div style={{ fontSize: 10, color: t.textDim }}>last 20 trades</div>
          </div>
          {feed.length === 0 ? (
            <div style={{ textAlign: "center", padding: 24, color: t.textDim, fontSize: 13 }}>
              No trades yet — treasury will light up once coins start trading.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {feed.map(f => (
                <div key={f.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px", borderRadius: 8, background: t.bgSurface, fontSize: 12,
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: f.side === "buy" ? t.green : t.red, flexShrink: 0,
                  }} />
                  <a
                    href={`#/NewsCoin?id=${encodeURIComponent(f.coinId)}`}
                    style={{
                      color: ORANGE, fontWeight: 700, textDecoration: "none",
                      minWidth: 52,
                    }}
                  >${f.ticker}</a>
                  <span style={{
                    color: f.side === "buy" ? t.green : t.red, fontWeight: 600,
                    display: "inline-flex", alignItems: "center", gap: 2,
                  }}>
                    {f.side === "buy" ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                    {f.side}
                  </span>
                  <span style={{ color: t.textMuted, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {shortWallet(f.trader)}
                  </span>
                  <span style={{ color: t.textDim }}>{fmtNear(f.volume_near)} N</span>
                  <span style={{ color: t.green, fontWeight: 700 }}>
                    +{fmtNear(f.platform_fee_near)} N
                  </span>
                  <span style={{ color: t.textDim, minWidth: 28, textAlign: "right" }}>
                    {timeAgo(f.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Payout schedule */}
        <div style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 700, color: t.white, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
            <Clock size={14} color={ORANGE} /> Payout Schedule
          </div>
          <div style={{
            padding: 12, borderRadius: 10, background: `${ORANGE}10`,
            border: `1px solid ${ORANGE}33`, marginBottom: 12,
          }}>
            <div style={{ fontSize: 11, color: t.textDim, marginBottom: 3 }}>Next distribution</div>
            <div style={{
              fontSize: 22, fontWeight: 800, color: ORANGE,
              fontFamily: "'JetBrains Mono', monospace",
            }}>{timeUntil(payouts.next_payout_iso)}</div>
            <div style={{ fontSize: 10, color: t.textDim, marginTop: 3 }}>
              {payouts.cadence || "weekly"} · {payouts.next_payout_iso ? new Date(payouts.next_payout_iso).toUTCString() : ""}
            </div>
          </div>
          <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 8, fontWeight: 700 }}>Distribution breakdown</div>
          {[
            { label: "$IRONCLAW Stakers", pct: payouts?.distribution?.stakers ?? 0.60, color: t.green, icon: Users },
            { label: "Buybacks + Burns",  pct: payouts?.distribution?.buybacks ?? 0.25, color: "#fb923c", icon: Flame },
            { label: "Protocol Ops",      pct: payouts?.distribution?.ops ?? 0.15, color: t.amber, icon: Coins },
          ].map(row => (
            <div key={row.label} style={{ marginBottom: 8 }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                fontSize: 12, color: t.textMuted, marginBottom: 4,
              }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: row.color, fontWeight: 700 }}>
                  <row.icon size={11} /> {row.label}
                </span>
                <span style={{ color: t.white, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                  {Math.round((row.pct || 0) * 100)}%
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: t.bgSurface, overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 3, width: `${Math.round((row.pct || 0) * 100)}%`,
                  background: row.color,
                }} />
              </div>
            </div>
          ))}
          <div style={{
            marginTop: 12, padding: 10, borderRadius: 8, background: t.bgSurface,
            fontSize: 11, color: t.textDim, lineHeight: 1.5,
          }}>
            Fee model: <strong style={{ color: t.white }}>1% platform</strong> (treasury) + <strong style={{ color: t.white }}>2% creator</strong> (First Mover) on every trade.
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 760px) {
          .ix-treasury-grid { grid-template-columns: 1fr !important; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
