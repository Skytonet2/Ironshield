"use client";
// TradingTerminal — the composed Phase 3A screen.
//
// Layout matches spec Section 5:
//   [Token selector] [Chain switcher] [Timeframe chips]
//   ─────────────────────────────────────────────────
//   [PriceChart (60%)      ] [OrderPanel (40%)     ]
//
// Positions + Trade history tables land in Phase 3B alongside the
// actual swap execution. Today the chart is live, the order panel is
// wired to the UI state, but pressing Execute pops a placeholder.

import { useState } from "react";
import { useTheme } from "@/lib/contexts";
import { useSettings } from "@/lib/stores/settingsStore";
import PriceChart from "./PriceChart";
import OrderPanel from "./OrderPanel";
import TokenSelector from "./TokenSelector";
import { SUPPORTED_TIMEFRAMES } from "@/lib/api/geckoTerminal";

// Sensible preset token for SOL so the page has a live chart on first
// load. For NEAR we leave the preset null and show the search prompt —
// GeckoTerminal's NEAR pool addresses are numeric Ref pool IDs that
// change as pools migrate, and hardcoding a stale one 404s. The
// TokenSelector handles discovery cleanly.
const DEFAULT_TOKEN = {
  sol: {
    // SOL/USDC on Raydium — one of the most-traded pools on Solana.
    poolAddress: "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",
    baseSymbol: "SOL",
    quoteSymbol: "USDC",
    name: "Solana / USD Coin",
  },
  near: null,
};

export default function TradingTerminal() {
  const t = useTheme();
  const activeChain = useSettings((s) => s.activeChain);
  const setActiveChain = useSettings((s) => s.setActiveChain);
  const [timeframe, setTimeframe] = useState("1h");
  const [tokenByChain, setTokenByChain] = useState(DEFAULT_TOKEN);
  const token = tokenByChain[activeChain];

  const chainTab = (val, label) => {
    const active = activeChain === val;
    return (
      <button
        type="button"
        onClick={() => setActiveChain(val)}
        style={{
          padding: "6px 14px",
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 600,
          border: `1px solid ${active ? t.accent : t.border}`,
          background: active ? "var(--accent-dim)" : "transparent",
          color: active ? t.accent : t.textMuted,
          cursor: "pointer",
          letterSpacing: 0.6,
          textTransform: "uppercase",
        }}
      >
        {label}
      </button>
    );
  };

  const tfChip = (tf) => {
    const active = tf === timeframe;
    return (
      <button
        key={tf}
        type="button"
        onClick={() => setTimeframe(tf)}
        style={{
          padding: "4px 10px",
          fontSize: 11,
          borderRadius: 6,
          border: `1px solid ${active ? t.accent : t.border}`,
          background: active ? "var(--accent-dim)" : "transparent",
          color: active ? t.accent : t.textDim,
          cursor: "pointer",
        }}
      >
        {tf}
      </button>
    );
  };

  return (
    <div style={{ padding: "16px 20px", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        marginBottom: 14,
      }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: t.text, margin: 0 }}>
          Trading Terminal
        </h2>
        <div style={{ display: "flex", gap: 6, marginLeft: 8 }}>
          {chainTab("near", "NEAR")}
          {chainTab("sol",  "Solana")}
          {/* BNB opted out — see 93eabc3 commit notes. */}
        </div>
        <div style={{ flex: 1 }} />
      </div>

      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 14,
        flexWrap: "wrap",
      }}>
        <TokenSelector
          chain={activeChain}
          value={token}
          onPick={(picked) => setTokenByChain((prev) => ({
            ...prev,
            [activeChain]: picked,
          }))}
        />
        <div style={{ display: "flex", gap: 4 }}>
          {SUPPORTED_TIMEFRAMES.map(tfChip)}
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 3fr) minmax(260px, 2fr)",
        gap: 16,
      }}>
        <div className="card" style={{
          border: `1px solid ${t.border}`,
          borderRadius: 12,
          background: "var(--bg-card)",
          padding: 10,
          minHeight: 380,
        }}>
          {token?.poolAddress ? (
            <PriceChart
              chain={activeChain}
              pool={token.poolAddress}
              timeframe={timeframe}
              height={380}
            />
          ) : (
            <div style={{ padding: 40, textAlign: "center", color: t.textDim, fontSize: 12 }}>
              Search a token above to load its chart.
            </div>
          )}
        </div>
        <OrderPanel
          chain={activeChain}
          token={token}
          priceUsd={null /* live price will hang off PriceChart/GT pool info in 3B */}
        />
      </div>
    </div>
  );
}
