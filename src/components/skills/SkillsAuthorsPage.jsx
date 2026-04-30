"use client";
// /skills/authors — leaderboard of skill authors by lifetime earnings.
// Tier 5 slice 4. Reads from /api/skills/authors which aggregates the
// skill_sales table grouped by creator_wallet, joined with feed_users
// for username + avatar. Public read — no wallet required.
//
// Switching `sort` (earnings | sales | skills_count) and `window`
// (all | 7d | 30d) re-fires the request; results are not paginated at
// v1 since the catalog is bounded by skill_sales row count.

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/lib/contexts";
import { API_BASE as API } from "@/lib/apiBase";
import { Trophy, TrendingUp, Layers, ExternalLink } from "lucide-react";

const YOCTO = 1_000_000_000_000_000_000_000_000n;

function fmtNear(yoctoStr) {
  if (!yoctoStr) return "0";
  try {
    const big = BigInt(yoctoStr);
    const whole = big / YOCTO;
    if (whole > 1_000_000n) return `${(Number(whole) / 1e6).toFixed(2)}M`;
    if (whole > 1_000n)     return `${(Number(whole) / 1e3).toFixed(2)}K`;
    const frac = big % YOCTO;
    const total = Number(whole) + Number(frac) / 1e24;
    if (total < 0.0001 && total > 0) return total.toExponential(2);
    if (total < 1) return total.toFixed(4);
    return total.toFixed(3);
  } catch { return "0"; }
}

function shortWallet(w = "") {
  if (!w) return "—";
  return w.length > 22 ? `${w.slice(0, 10)}…${w.slice(-6)}` : w;
}

function authorDisplay(row) {
  return row.display_name || row.username || shortWallet(row.wallet);
}

const SORT_OPTIONS = [
  { key: "earnings",     label: "Earnings",  Icon: Trophy },
  { key: "sales",        label: "Sales",     Icon: TrendingUp },
  { key: "skills_count", label: "Catalog",   Icon: Layers },
];
const WINDOW_OPTIONS = [
  { key: "all", label: "All time" },
  { key: "30d", label: "30 days" },
  { key: "7d",  label: "7 days"  },
];

export default function SkillsAuthorsPage() {
  const t = useTheme();
  const [rows, setRows]       = useState([]);
  const [sort, setSort]       = useState("earnings");
  const [window_, setWindow_] = useState("all");
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const url = `${API}/api/skills/authors?sort=${sort}&window=${window_}&limit=50`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setRows(j.rows || []);
    } catch (e) {
      setErr(e.message || String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [sort, window_]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1100, margin: "0 auto", color: t.white }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Top Skill Authors</h1>
        <div style={{ color: t.textMuted, fontSize: 13, marginTop: 4 }}>
          Ranked by paid installs. Earnings are the creator share after the platform fee.
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 14, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {SORT_OPTIONS.map(o => {
            const active = sort === o.key;
            const Icon = o.Icon;
            return (
              <button key={o.key} onClick={() => setSort(o.key)} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 8, border: "none",
                background: active ? t.accent : t.bgSurface,
                color: active ? "#fff" : t.textMuted,
                fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}>
                <Icon size={14} /> {o.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
          {WINDOW_OPTIONS.map(o => {
            const active = window_ === o.key;
            return (
              <button key={o.key} onClick={() => setWindow_(o.key)} style={{
                padding: "8px 14px", borderRadius: 8, border: "none",
                background: active ? t.accent : t.bgSurface,
                color: active ? "#fff" : t.textMuted,
                fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}>
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* States */}
      {loading && <div style={{ color: t.textMuted, padding: 16 }}>Loading…</div>}
      {err && <div style={{ color: "#ef4444", padding: 16 }}>Failed to load: {err}</div>}
      {!loading && !err && rows.length === 0 && (
        <div style={{ color: t.textMuted, padding: 32, textAlign: "center", border: `1px dashed ${t.border}`, borderRadius: 12 }}>
          No authors with paid sales yet. Free installs don't count toward earnings.
        </div>
      )}

      {/* Table */}
      {!loading && rows.length > 0 && (
        <div style={{ borderRadius: 12, overflow: "hidden", border: `1px solid ${t.border}` }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead style={{ background: t.bgSurface }}>
              <tr style={{ textAlign: "left", color: t.textMuted, fontWeight: 600 }}>
                <th style={{ padding: 12, width: 48 }}>#</th>
                <th style={{ padding: 12 }}>Author</th>
                <th style={{ padding: 12, textAlign: "right" }}>Earnings</th>
                <th style={{ padding: 12, textAlign: "right" }}>Sales</th>
                <th style={{ padding: 12, textAlign: "right" }}>Skills</th>
                <th style={{ padding: 12 }}>Top skill</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.wallet} style={{ borderTop: `1px solid ${t.border}` }}>
                  <td style={{ padding: 12, color: t.textMuted, fontWeight: 700 }}>{i + 1}</td>
                  <td style={{ padding: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {r.avatar_url
                        ? <img src={r.avatar_url} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} />
                        : <div style={{ width: 28, height: 28, borderRadius: "50%", background: t.bgSurface }} />}
                      <div>
                        <div style={{ fontWeight: 600 }}>{authorDisplay(r)}</div>
                        <div style={{ fontSize: 11, color: t.textMuted, fontFamily: "monospace" }}>{shortWallet(r.wallet)}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: 12, textAlign: "right", fontFamily: "monospace" }}>
                    {fmtNear(r.earnings_yocto)} <span style={{ color: t.textMuted }}>NEAR</span>
                  </td>
                  <td style={{ padding: 12, textAlign: "right" }}>{r.sales}</td>
                  <td style={{ padding: 12, textAlign: "right" }}>{r.skills_count}</td>
                  <td style={{ padding: 12 }}>
                    {r.top_skill_id ? (
                      <a href={`/skills/view?id=${r.top_skill_id}`} style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        color: t.accent, textDecoration: "none",
                      }}>
                        {r.top_skill_name || `#${r.top_skill_id}`} <ExternalLink size={12} />
                      </a>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
