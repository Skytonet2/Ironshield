"use client";
// /portfolio — trader/creator portfolio hub.
//
// Shows total balance in USD, 24h delta, three action buttons
// (Deposit / Withdraw / History), and a tab strip for Holdings /
// Positions / Performance. Asset rows pull from:
//   - NEAR wallet balance (via useWallet + near-api-js)
//   - Solana balance (via Privy embedded wallet + public RPC — lazy
//     import so the SPA doesn't pay for the @solana/web3.js bundle
//     until the user actually lands here)
//   - ETH / BNB via Privy embedded EVM wallet (again, lazy)
//   - IRONCLAW token balance via the NEP-141 ft_balance_of view
//
// Prices come from the existing usePrices poll; IRONCLAW uses the
// in-project useIronclawPrice helper so the fully-diluted and
// per-holding USD stay consistent with the feed's tip preview.

import { useEffect, useMemo, useState } from "react";
import { useTheme, useWallet, getReadAccount } from "@/lib/contexts";
import { useIronclawPrice } from "@/lib/ironclaw";
import { usePrices } from "@/lib/hooks/usePrices";
import { useWallet as useMultiChainWallet } from "@/lib/stores/walletStore";
import AppShell from "@/components/shell/AppShell";
import {
  Wallet, ArrowDownToLine, ArrowUpFromLine, Clock, ArrowUpRight,
  ArrowDownRight, Coins, TrendingUp,
} from "lucide-react";

const TABS = [
  { key: "holdings",    label: "Holdings" },
  { key: "positions",   label: "Positions" },
  { key: "performance", label: "Performance" },
];

const ASSET_META = {
  near:     { label: "NEAR",     symbol: "NEAR", color: "#10b981", gradient: "linear-gradient(135deg, #10b981, #065f46)" },
  sol:      { label: "Solana",   symbol: "SOL",  color: "#8b5cf6", gradient: "linear-gradient(135deg, #8b5cf6, #7c3aed)" },
  eth:      { label: "Ethereum", symbol: "ETH",  color: "#627eea", gradient: "linear-gradient(135deg, #627eea, #3c5bb8)" },
  btc:      { label: "Bitcoin",  symbol: "BTC",  color: "#f7931a", gradient: "linear-gradient(135deg, #f7931a, #b86b08)" },
  ironclaw: { label: "IronClaw", symbol: "IRON", color: "#3b82f6", gradient: "linear-gradient(135deg, #3b82f6, #a855f7)" },
};

export default function PortfolioPage() {
  const t = useTheme();
  const { address, balance: nearBal, connected } = useWallet();
  const prices = usePrices();
  const ironPrice = useIronclawPrice();
  const [ironBal, setIronBal] = useState(null);
  const [tab, setTab] = useState("holdings");

  // Multi-chain wallet slots from the Privy mirror. sol holds the
  // Solana embedded wallet address; bnb holds whatever Privy reports
  // as the user's EVM wallet (which we use for ETH balance display).
  const solWallet = useMultiChainWallet((s) => s.sol);
  const evmWallet = useMultiChainWallet((s) => s.bnb);
  const [solBal, setSolBal] = useState(null);
  const [ethBal, setEthBal] = useState(null);

  // Solana balance — public Ankr/public RPC. Lazy-imports
  // @solana/web3.js so the SPA doesn't pay for it on feed-only
  // sessions.
  useEffect(() => {
    let cancelled = false;
    const addr = solWallet?.address;
    if (!addr) { setSolBal(null); return; }
    (async () => {
      try {
        const { Connection, PublicKey } = await import("@solana/web3.js");
        const conn = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
        const lamports = await conn.getBalance(new PublicKey(addr));
        if (!cancelled) setSolBal(lamports / 1e9);
      } catch { if (!cancelled) setSolBal(0); }
    })();
    return () => { cancelled = true; };
  }, [solWallet?.address]);

  // ETH balance — eth_getBalance via a public RPC. Formats wei to
  // ether with BigInt to avoid precision loss.
  useEffect(() => {
    let cancelled = false;
    const addr = evmWallet?.address;
    if (!addr) { setEthBal(null); return; }
    (async () => {
      try {
        const r = await fetch("https://ethereum-rpc.publicnode.com", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0", id: 1, method: "eth_getBalance",
            params: [addr, "latest"],
          }),
        });
        const j = await r.json();
        const hex = j?.result;
        if (!hex) { if (!cancelled) setEthBal(0); return; }
        const wei = BigInt(hex);
        // Keep 6 decimals of precision as a Number for the UI.
        const ether = Number(wei / 10n ** 12n) / 1e6;
        if (!cancelled) setEthBal(ether);
      } catch { if (!cancelled) setEthBal(0); }
    })();
    return () => { cancelled = true; };
  }, [evmWallet?.address]);

  // IRONCLAW balance — read from the NEP-141 contract. Only runs
  // when the user has a NEAR wallet connected.
  useEffect(() => {
    let cancelled = false;
    if (!address || !address.endsWith(".near")) { setIronBal(null); return; }
    (async () => {
      try {
        const account = await getReadAccount();
        const raw = await account.viewFunction({
          contractId: "ironclaw.near",
          methodName: "ft_balance_of",
          args: { account_id: address },
        });
        if (cancelled) return;
        setIronBal(Number(BigInt(raw || "0") / 1_000_000_000_000_000_000_000_000n));
      } catch {
        if (!cancelled) setIronBal(0);
      }
    })();
    return () => { cancelled = true; };
  }, [address]);

  // Build the holdings list from whatever we have. Items with zero
  // balance are kept so the layout matches the reference (empty
  // rows read as "not funded yet" rather than "not available").
  const holdings = useMemo(() => {
    const rows = [];
    const nearUsd = prices.near != null ? Number(nearBal || 0) * prices.near : null;
    rows.push({
      key: "near",
      balance: Number(nearBal || 0),
      price: prices.near,
      usd: nearUsd,
      change: null, // no 24h change yet
      ...ASSET_META.near,
    });
    rows.push({
      key: "ironclaw",
      balance: ironBal,
      price: ironPrice,
      usd: ironBal != null && ironPrice != null ? ironBal * ironPrice : null,
      change: null,
      ...ASSET_META.ironclaw,
    });
    // EVM (ETH) from Privy embedded wallet.
    rows.push({
      key: "eth",
      balance: ethBal,
      price: prices.eth,
      usd: ethBal != null && prices.eth != null ? ethBal * prices.eth : null,
      change: null,
      ...ASSET_META.eth,
    });
    // BTC isn't custodially held in Privy — keep it aspirational
    // until a user can link an external BTC wallet.
    rows.push({
      key: "btc",
      balance: null,
      price: prices.btc,
      usd: null,
      change: null,
      ...ASSET_META.btc,
    });
    // Solana from the Privy embedded wallet.
    rows.push({
      key: "sol",
      balance: solBal,
      price: prices.sol,
      usd: solBal != null && prices.sol != null ? solBal * prices.sol : null,
      change: null,
      ...ASSET_META.sol,
    });
    return rows;
  }, [prices, nearBal, ironBal, ironPrice, ethBal, solBal]);

  const totalUsd = holdings.reduce((a, r) => a + (r.usd || 0), 0);
  const totalDelta24h = 0; // TODO: wire once we track per-asset 24h change

  return (
    <AppShell>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "16px 16px 60px" }}>
        {/* Header — compact, left-aligned. Back affordance would be
            AppShell's left sidebar; no need for a chevron here. */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: t.accent, fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase" }}>
            <Wallet size={12} /> Portfolio
          </div>
          <h1 style={{ margin: "4px 0 4px", fontSize: 20, fontWeight: 800, color: t.white, letterSpacing: -0.2 }}>
            Track your portfolio, holdings, and performance.
          </h1>
        </div>

        {/* Total balance card — glass with ambient gradient. */}
        <div style={{
          padding: "18px 20px", borderRadius: 14,
          background: "linear-gradient(180deg, rgba(168,85,247,0.08), rgba(59,130,246,0.04) 60%, transparent), var(--bg-card)",
          border: `1px solid ${t.border}`,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 20px 40px rgba(168,85,247,0.06)",
          marginBottom: 14,
        }}>
          <div style={{ fontSize: 11, color: t.textDim, letterSpacing: 0.8, textTransform: "uppercase", fontWeight: 600 }}>
            Total Balance
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: t.white, marginTop: 4, letterSpacing: -0.5 }}>
            {connected ? fmtUsd(totalUsd) : "—"}
          </div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            marginTop: 6, fontSize: 13, fontWeight: 700,
            color: totalDelta24h >= 0 ? "#10b981" : "#ef4444",
          }}>
            {totalDelta24h >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {connected ? `${totalDelta24h >= 0 ? "+" : ""}${totalDelta24h.toFixed(2)}%` : "0.00%"} (24h)
          </div>

          {/* Mini sparkline area — placeholder bar so the card has
              a recognizable shape when unfunded. Replaces with a
              real chart once the backend portfolio endpoint ships. */}
          <MiniSparkline t={t} />

          {/* Action row */}
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr 1fr", marginTop: 12 }}>
            <ActionChip Icon={ArrowDownToLine} label="Deposit" onClick={() => alert("Deposit flow — coming next build.")} t={t} />
            <ActionChip Icon={ArrowUpFromLine} label="Withdraw" onClick={() => alert("Withdraw flow — coming next build.")} t={t} />
            <ActionChip Icon={Clock}           label="History"  onClick={() => alert("History — coming next build.")} t={t} />
          </div>
        </div>

        {/* Tab strip */}
        <div style={{
          display: "flex", gap: 2,
          borderBottom: `1px solid ${t.border}`,
          marginBottom: 12, overflowX: "auto",
        }}>
          {TABS.map((x) => {
            const sel = x.key === tab;
            return (
              <button
                key={x.key}
                type="button"
                onClick={() => setTab(x.key)}
                style={{
                  padding: "10px 14px", background: "transparent", border: "none",
                  fontSize: 13, fontWeight: sel ? 700 : 500,
                  color: sel ? t.accent : t.textDim,
                  borderBottom: `2px solid ${sel ? t.accent : "transparent"}`,
                  cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                {x.label}
              </button>
            );
          })}
        </div>

        {tab === "holdings" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {holdings.map((r) => (
              <HoldingRow key={r.key} row={r} t={t} connected={connected} />
            ))}
          </div>
        )}

        {tab === "positions" && (
          <EmptyPanel t={t}>
            You haven't opened any trading positions yet. Visit{" "}
            <a href="/newscoin" style={{ color: t.accent, textDecoration: "none" }}>NewsCoin</a>
            {" "}to open your first.
          </EmptyPanel>
        )}

        {tab === "performance" && (
          <EmptyPanel t={t}>
            Performance charts unlock once you have trade history to plot.
          </EmptyPanel>
        )}
      </div>
    </AppShell>
  );
}

function ActionChip({ Icon, label, onClick, t }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        padding: "9px 10px", borderRadius: 10,
        border: `1px solid ${t.border}`, background: "var(--bg-surface)",
        color: t.text, fontSize: 12, fontWeight: 600, cursor: "pointer",
        transition: "background 120ms ease, border-color 120ms ease",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent-border)"; e.currentTarget.style.background = "var(--accent-dim)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.background = "var(--bg-surface)"; }}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

function HoldingRow({ row, t, connected }) {
  const hasBal = row.balance != null && row.balance > 0;
  const delta = row.change;
  const up = delta == null ? null : delta >= 0;

  return (
    <div
      className="card-lift"
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 14px", borderRadius: 12,
        background: `linear-gradient(90deg, ${row.color}08, transparent 40%), var(--bg-card)`,
        border: `1px solid ${t.border}`,
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: row.gradient, color: "#fff",
        fontSize: 11, fontWeight: 800, letterSpacing: 0.4,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        {row.symbol}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: t.white }}>
          {row.label}
        </div>
        <div style={{ fontSize: 11, color: t.textDim }}>
          {hasBal
            ? `${fmtBalance(row.balance)} ${row.symbol}`
            : (connected ? "Connect on this chain" : "Not connected")}
        </div>
      </div>

      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: t.white, fontFamily: "var(--font-jetbrains-mono), monospace" }}>
          {row.usd != null ? fmtUsd(row.usd) : "—"}
        </div>
        {delta != null && (
          <div style={{
            fontSize: 11, fontWeight: 700,
            color: up ? "#10b981" : "#ef4444",
            display: "inline-flex", alignItems: "center", gap: 2,
          }}>
            {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
            {Math.abs(delta).toFixed(2)}%
          </div>
        )}
      </div>
    </div>
  );
}

function MiniSparkline({ t }) {
  // Simple 14-point seeded curve — decorative only. Replace with real
  // per-asset data when the portfolio time-series endpoint ships.
  const pts = [18, 22, 19, 25, 28, 26, 30, 28, 33, 31, 35, 34, 38, 42];
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const path = pts.map((v, i) => {
    const x = (i / (pts.length - 1)) * 100;
    const y = 100 - ((v - min) / (max - min)) * 80 - 10;
    return `${i === 0 ? "M" : "L"} ${x} ${y}`;
  }).join(" ");
  return (
    <svg viewBox="0 0 100 60" preserveAspectRatio="none" style={{ width: "100%", height: 48, marginTop: 10, display: "block" }}>
      <defs>
        <linearGradient id="ixSparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor={t.accent} stopOpacity="0.35" />
          <stop offset="100%" stopColor={t.accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L 100 60 L 0 60 Z`} fill="url(#ixSparkFill)" />
      <path d={path} fill="none" stroke={t.accent} strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function EmptyPanel({ t, children }) {
  return (
    <div style={{
      padding: 30, color: t.textDim, fontSize: 13, textAlign: "center",
      border: `1px dashed ${t.border}`, borderRadius: 10,
    }}>
      {children}
    </div>
  );
}

function fmtUsd(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtBalance(n) {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1000)      return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (v >= 1)         return v.toFixed(3);
  if (v > 0)          return v.toFixed(6);
  return "0";
}
