"use client";
// /skills/history — lifetime purchase history for the connected wallet
// (Day 17.3). Reads /api/skills/history (filtered by buyer_wallet) and
// shades each row by current install state — chain is the source of
// truth for that, so we cross-reference useAgent.getInstalledSkills.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme, useWallet } from "@/lib/contexts";
import { apiFetch } from "@/lib/apiFetch";
import { API_BASE as API } from "@/lib/apiBase";
import useAgent from "@/hooks/useAgent";

const YOCTO = 1_000_000_000_000_000_000_000_000n;

function fmtNear(yoctoStr) {
  if (!yoctoStr) return "0";
  try {
    const big = BigInt(yoctoStr);
    const whole = big / YOCTO;
    const frac = big % YOCTO;
    if (whole > 1_000n) return `${(Number(whole) / 1e3).toFixed(2)}K`;
    const total = Number(whole) + Number(frac) / 1e24;
    if (total < 0.0001 && total > 0) return total.toExponential(2);
    if (total < 1) return total.toFixed(6);
    return total.toFixed(3);
  } catch { return "0"; }
}

function shortHash(h = "") {
  return h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h;
}

function fmtDate(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function SkillsHistoryPage() {
  const t = useTheme();
  const { connected, address, showModal } = useWallet?.() || {};
  const agent = useAgent();

  const [rows, setRows] = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [installedIds, setInstalledIds] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState("");

  const loadFirst = useCallback(async () => {
    if (!address) { setRows([]); setNextBefore(null); return; }
    setLoading(true); setErr("");
    try {
      const [historyRes, installed] = await Promise.all([
        apiFetch(`/api/skills/history?wallet=${encodeURIComponent(address)}`),
        // Best-effort. If chain RPC blips we still render history with
        // an unknown install state instead of failing the whole page.
        agent.getInstalledSkills?.(address).catch(() => []),
      ]);
      if (!historyRes.ok) throw new Error(`HTTP ${historyRes.status}`);
      const j = await historyRes.json();
      setRows(j.rows || []);
      setNextBefore(j.nextBefore || null);
      const ids = (installed || []).map((x) => String(x.id ?? x.skill_id ?? x));
      setInstalledIds(new Set(ids));
    } catch (e) {
      setErr(e.message || "Failed to load");
      setRows([]); setNextBefore(null);
    } finally { setLoading(false); }
  }, [address, agent]);

  useEffect(() => { loadFirst(); }, [loadFirst]);

  const loadMore = useCallback(async () => {
    if (!nextBefore || !address) return;
    setLoadingMore(true);
    try {
      const r = await apiFetch(`/api/skills/history?wallet=${encodeURIComponent(address)}&before=${encodeURIComponent(nextBefore)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setRows((prev) => [...prev, ...(j.rows || [])]);
      setNextBefore(j.nextBefore || null);
    } catch (e) {
      setErr(e.message || "Failed to load more");
    } finally { setLoadingMore(false); }
  }, [nextBefore, address]);

  const totalSpent = useMemo(() => {
    let sum = 0n;
    for (const r of rows) { try { sum += BigInt(r.price_yocto || "0"); } catch {} }
    return sum.toString();
  }, [rows]);

  if (!connected) {
    return (
      <div style={{ padding: 40, color: t.textDim, fontSize: 13, textAlign: "center",
        border: `1px dashed ${t.border}`, borderRadius: 10 }}>
        Connect a wallet to see your purchase history.{" "}
        <button onClick={showModal} style={{
          marginLeft: 8, padding: "4px 12px", borderRadius: 6,
          background: t.accent, color: "#fff", border: "none", fontSize: 12,
          fontWeight: 700, cursor: "pointer",
        }}>Connect</button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{
        padding: 16, borderRadius: 14,
        border: `1px solid ${t.border}`,
        background: "linear-gradient(180deg, rgba(59,130,246,0.08), transparent 60%), var(--bg-card)",
      }}>
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6, color: t.textMuted, textTransform: "uppercase", marginBottom: 8 }}>
          Purchase history
        </div>
        <div style={{ fontSize: 11, color: t.textDim, lineHeight: 1.55 }}>
          Every paid install_skill from this wallet, indexed from on-chain
          events. Uninstalled skills still appear here — purchases aren't
          refundable. Status mirrors the current chain state.
        </div>
      </div>

      <div style={{
        display: "grid", gap: 10,
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
      }}>
        <Tile t={t} label="Total purchases" value={String(rows.length + (nextBefore ? "+" : ""))} />
        <Tile t={t} label="Total spent (page)" value={`${fmtNear(totalSpent)} NEAR`} />
        <Tile t={t} label="Currently installed" value={String(installedIds.size)} />
      </div>

      {err && (
        <div style={{ padding: 10, borderRadius: 8, background: "rgba(239,68,68,0.08)",
          border: "1px solid var(--red)", color: "var(--red)", fontSize: 12 }}>
          {err}
        </div>
      )}

      <div style={{ padding: 14, borderRadius: 12, border: `1px solid ${t.border}`, background: "var(--bg-card)" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: t.text, marginBottom: 10 }}>
          Purchases
        </div>
        {rows.length === 0 ? (
          <div style={{ fontSize: 12, color: t.textDim, padding: "6px 0" }}>
            {loading ? "Loading…" : "No purchases yet."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
            {rows.map((row) => {
              const installed = installedIds.has(String(row.skill_id));
              return (
                <div key={row.tx_hash} style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto auto auto",
                  gap: 10, padding: "8px 10px", borderRadius: 6,
                  background: "var(--bg-surface)", alignItems: "center",
                }}>
                  <span style={{ color: t.textDim, fontFamily: "var(--font-jetbrains-mono), monospace" }}>
                    #{row.skill_id}
                  </span>
                  <a
                    href={`https://nearblocks.io/txns/${row.tx_hash}`}
                    target="_blank" rel="noreferrer"
                    style={{ color: t.textMuted, fontFamily: "var(--font-jetbrains-mono), monospace",
                      textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {shortHash(row.tx_hash)}
                  </a>
                  <span style={{ color: t.text, fontWeight: 700 }}>
                    −{fmtNear(row.price_yocto)} NEAR
                  </span>
                  <span style={{ color: t.textDim }}>{fmtDate(row.sold_at)}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
                    padding: "2px 8px", borderRadius: 999,
                    background: installed ? "rgba(34,197,94,0.15)" : "rgba(148,163,184,0.15)",
                    color: installed ? "#4ade80" : t.textDim,
                  }}>
                    {installed ? "Installed" : "Uninstalled"}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {nextBefore && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            style={{
              marginTop: 12, padding: "8px 14px", borderRadius: 8,
              background: "var(--bg-input)", color: t.text, fontSize: 12,
              fontWeight: 700, border: `1px solid ${t.border}`,
              cursor: loadingMore ? "wait" : "pointer",
            }}
          >
            {loadingMore ? "Loading…" : "Load older"}
          </button>
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
