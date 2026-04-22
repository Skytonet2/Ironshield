"use client";
// PositionsTable — reads /api/trading/positions for the active wallet.
//
// Phase 3B-2 ship: open-position rows + entry metadata. Live unrealized
// P&L polling lands in 3B-3 (needs a price-by-mint indexer call per
// row; deferred to avoid stacking another GeckoTerminal burst onto
// the same chart polling loop).

import { useEffect, useState } from "react";
import { useTheme } from "@/lib/contexts";
import { useWallet } from "@/lib/stores/walletStore";
import { useSettings } from "@/lib/stores/settingsStore";

const BACKEND_BASE = (() => {
  if (typeof window === "undefined") return "";
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3001";
  return "https://ironclaw-backend.onrender.com";
})();

function fmtAmount(baseStr, decimals) {
  if (!baseStr) return "—";
  try {
    const n = BigInt(baseStr);
    const factor = 10n ** BigInt(decimals || 0);
    const whole = n / factor;
    const frac  = n % factor;
    const fracStr = frac.toString().padStart(Number(decimals || 0), "0").slice(0, 6);
    return `${whole}${fracStr ? "." + fracStr.replace(/0+$/, "") : ""}`;
  } catch {
    return baseStr;
  }
}

function fmtUsd(n) {
  if (n == null || !isFinite(Number(n))) return "—";
  const v = Number(n);
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(6)}`;
}

function timeAgo(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function PositionsTable() {
  const t = useTheme();
  const activeChain = useSettings((s) => s.activeChain);
  const wallet = useWallet((s) => s[activeChain]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!wallet?.address) { setRows([]); return; }
    const ctl = new AbortController();
    async function load() {
      setLoading(true);
      setErr(null);
      try {
        const url =
          `${BACKEND_BASE}/api/trading/positions` +
          `?wallet=${encodeURIComponent(wallet.address)}` +
          `&chain=${activeChain}&open=1&limit=50`;
        const res = await fetch(url, { signal: ctl.signal, cache: "no-store" });
        if (!res.ok) throw new Error(`positions ${res.status}`);
        const j = await res.json();
        setRows(j.positions || []);
      } catch (e) {
        if (e.name !== "AbortError") setErr(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
    // Refresh every 30s — polling the backend is cheap and catches
    // fresh positions that just landed via swap.
    const id = setInterval(load, 30_000);
    return () => { ctl.abort(); clearInterval(id); };
  }, [wallet?.address, activeChain]);

  const th = {
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: t.textDim,
    fontWeight: 600,
    textAlign: "left",
    padding: "6px 10px",
    borderBottom: `1px solid ${t.border}`,
  };
  const td = {
    fontSize: 12,
    color: t.text,
    padding: "8px 10px",
    borderBottom: `1px solid ${t.border}`,
    fontFamily: "var(--font-jetbrains-mono), monospace",
  };

  return (
    <div style={{
      marginTop: 16,
      border: `1px solid ${t.border}`,
      borderRadius: 12,
      background: "var(--bg-card)",
      overflow: "hidden",
    }}>
      <div style={{
        padding: "10px 14px",
        borderBottom: `1px solid ${t.border}`,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: t.text }}>Open positions</span>
        <span style={{
          fontSize: 11,
          padding: "1px 6px",
          borderRadius: 4,
          background: "var(--bg-input)",
          color: t.textDim,
          fontFamily: "var(--font-jetbrains-mono), monospace",
        }}>
          {activeChain.toUpperCase()}
        </span>
        {loading && <span style={{ fontSize: 11, color: t.textDim }}>refreshing…</span>}
        {err && <span style={{ fontSize: 11, color: "var(--red)" }}>{err}</span>}
        <span style={{ flex: 1 }} />
        {wallet?.address && (
          <span style={{ fontSize: 10, color: t.textDim, fontFamily: "var(--font-jetbrains-mono), monospace" }}>
            {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
          </span>
        )}
      </div>

      {!wallet?.address && (
        <div style={{ padding: 16, fontSize: 12, color: t.textDim, textAlign: "center" }}>
          Connect a {activeChain.toUpperCase()} wallet to see your positions.
        </div>
      )}
      {wallet?.address && rows.length === 0 && !loading && (
        <div style={{ padding: 16, fontSize: 12, color: t.textDim, textAlign: "center" }}>
          No open positions yet. Your next trade will land here.
        </div>
      )}
      {rows.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Token</th>
              <th style={th}>Amount</th>
              <th style={{ ...th, textAlign: "right" }}>Entry</th>
              <th style={{ ...th, textAlign: "right" }}>Cost basis</th>
              <th style={{ ...th, textAlign: "right" }}>Opened</th>
              <th style={{ ...th, textAlign: "right" }}>Tx</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={td}>
                  <span style={{ color: t.white, fontWeight: 600 }}>{r.token_symbol || "?"}</span>
                </td>
                <td style={td}>{fmtAmount(r.amount_base, r.token_decimals)}</td>
                <td style={{ ...td, textAlign: "right" }}>{fmtUsd(r.entry_price_usd)}</td>
                <td style={{ ...td, textAlign: "right" }}>{fmtUsd(r.cost_basis_usd)}</td>
                <td style={{ ...td, textAlign: "right", color: t.textDim }}>{timeAgo(r.created_at)}</td>
                <td style={{ ...td, textAlign: "right" }}>
                  {r.entry_tx_hash && r.chain === "sol" ? (
                    <a
                      href={`https://solscan.io/tx/${r.entry_tx_hash}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: t.accent, textDecoration: "none" }}
                    >
                      {r.entry_tx_hash.slice(0, 6)}…
                    </a>
                  ) : r.entry_tx_hash ? (
                    <span style={{ color: t.textDim }}>{r.entry_tx_hash.slice(0, 6)}…</span>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
