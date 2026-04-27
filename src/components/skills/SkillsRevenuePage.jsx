"use client";
// /skills/revenue — earnings dashboard for skill authors. Pulls from
// the backend's skill_sales aggregate (Day 16). Read-only by design;
// NEAR auto-credits creator balance, so there's no payout button.
// Anyone can mint a skill, so the page renders even for non-creators —
// they just see zeros and an empty table, which is the correct signal
// (no sales = no revenue).

import { useCallback, useEffect, useState } from "react";
import { useTheme, useWallet } from "@/lib/contexts";
import { apiFetch } from "@/lib/apiFetch";
import { API_BASE as API } from "@/lib/apiBase";

const YOCTO = 1_000_000_000_000_000_000_000_000n;

// Format yocto-NEAR into a short human string. BigInt math up front
// to avoid float drift, then cast to Number once we're below the
// 2^53 safe range — earnings under 9M NEAR fit comfortably.
function fmtNear(yoctoStr) {
  if (!yoctoStr) return "0";
  try {
    const big = BigInt(yoctoStr);
    const whole = big / YOCTO;
    const frac = big % YOCTO;
    if (whole > 1_000_000n) return `${(Number(whole) / 1e6).toFixed(2)}M`;
    if (whole > 1_000n)     return `${(Number(whole) / 1e3).toFixed(2)}K`;
    const wholeN = Number(whole);
    const fracN = Number(frac) / 1e24;
    const total = wholeN + fracN;
    if (total < 0.0001 && total > 0) return total.toExponential(2);
    if (total < 1) return total.toFixed(6);
    return total.toFixed(3);
  } catch { return "0"; }
}

function shortWallet(w = "") {
  if (!w) return "—";
  return w.length > 18 ? `${w.slice(0, 8)}…${w.slice(-6)}` : w;
}

function timeAgo(d) {
  if (!d) return "";
  const s = Math.max(1, Math.floor((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function SkillsRevenuePage() {
  const t = useTheme();
  const { connected, address, showModal } = useWallet?.() || {};

  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!address) { setData(null); return; }
    setLoading(true); setErr("");
    try {
      const res = await apiFetch(`/api/skills/revenue?wallet=${encodeURIComponent(address)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setData(j);
    } catch (e) {
      setErr(e.message || "Failed to load");
      setData(null);
    } finally { setLoading(false); }
  }, [address]);

  useEffect(() => { load(); }, [load]);

  if (!connected) {
    return (
      <div style={{ padding: 40, color: t.textDim, fontSize: 13, textAlign: "center",
        border: `1px dashed ${t.border}`, borderRadius: 10 }}>
        Connect a wallet to see your skill revenue.{" "}
        <button onClick={showModal} style={{
          marginLeft: 8, padding: "4px 12px", borderRadius: 6,
          background: t.accent, color: "#fff", border: "none", fontSize: 12,
          fontWeight: 700, cursor: "pointer",
        }}>Connect</button>
      </div>
    );
  }

  const totals = data?.totals || {};
  const perSkill = data?.perSkill || [];
  const recent = data?.recent || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Header card */}
      <div style={{
        padding: 16, borderRadius: 14,
        border: `1px solid ${t.border}`,
        background: "linear-gradient(180deg, rgba(168,85,247,0.08), transparent 60%), var(--bg-card)",
      }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6, color: t.textMuted, textTransform: "uppercase", marginBottom: 8 }}>
          Skill revenue · {shortWallet(address)}
        </div>
        <div style={{ fontSize: 11, color: t.textDim, lineHeight: 1.55 }}>
          NEAR auto-credits the author wallet on every install_skill. This page
          aggregates indexed sales from the contract's skill_installed events.
          Numbers are after the 1% platform fee.
        </div>
      </div>

      {/* Stat tiles */}
      <div style={{
        display: "grid", gap: 10,
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
      }}>
        <Tile t={t} label="Total earned" value={`${fmtNear(totals.earned_total)} NEAR`} />
        <Tile t={t} label="Last 24h"     value={`${fmtNear(totals.earned_24h)} NEAR`} />
        <Tile t={t} label="Last 7 days"  value={`${fmtNear(totals.earned_7d)} NEAR`} />
        <Tile t={t} label="Sales total"  value={String(totals.sales_total ?? 0)} />
      </div>

      {err && (
        <div style={{ padding: 10, borderRadius: 8, background: "rgba(239,68,68,0.08)",
          border: "1px solid var(--red)", color: "var(--red)", fontSize: 12 }}>
          {err}
        </div>
      )}

      {/* Per-skill breakdown */}
      <div style={{ padding: 14, borderRadius: 12, border: `1px solid ${t.border}`, background: "var(--bg-card)" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: t.text, marginBottom: 10 }}>
          By skill
        </div>
        {perSkill.length === 0 ? (
          <div style={{ fontSize: 12, color: t.textDim, padding: "6px 0" }}>
            {loading ? "Loading…" : "No sales yet."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {perSkill.map((row) => (
              <div key={row.skill_id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 10px", borderRadius: 8, background: "var(--bg-surface)",
                fontSize: 12,
              }}>
                <span style={{ color: t.text, fontFamily: "var(--font-jetbrains-mono), monospace" }}>
                  Skill #{row.skill_id}
                </span>
                <span style={{ color: t.textDim }}>
                  {row.sales} sale{row.sales === 1 ? "" : "s"} · <strong style={{ color: t.text }}>
                    {fmtNear(row.earned_yocto)} NEAR
                  </strong>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent sales */}
      <div style={{ padding: 14, borderRadius: 12, border: `1px solid ${t.border}`, background: "var(--bg-card)" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: t.text, marginBottom: 10 }}>
          Recent sales
        </div>
        {recent.length === 0 ? (
          <div style={{ fontSize: 12, color: t.textDim, padding: "6px 0" }}>
            {loading ? "Loading…" : "No sales yet."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            {recent.map((row) => (
              <div key={row.tx_hash} style={{
                display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 10,
                padding: "6px 10px", borderRadius: 6, background: "var(--bg-surface)",
                alignItems: "center",
              }}>
                <span style={{ color: t.textDim, fontFamily: "var(--font-jetbrains-mono), monospace" }}>
                  #{row.skill_id}
                </span>
                <span style={{ color: t.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {shortWallet(row.buyer_wallet)}
                </span>
                <span style={{ color: t.text, fontWeight: 700 }}>
                  +{fmtNear(row.creator_take_yocto)} NEAR
                </span>
                <span style={{ color: t.textDim }}>{timeAgo(row.sold_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ t, label, value }) {
  return (
    <div style={{
      padding: 12, borderRadius: 10,
      border: `1px solid ${t.border}`, background: "var(--bg-card)",
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: t.textDim, textTransform: "uppercase", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, color: t.text, fontFamily: "var(--font-jetbrains-mono), monospace" }}>
        {value}
      </div>
    </div>
  );
}
