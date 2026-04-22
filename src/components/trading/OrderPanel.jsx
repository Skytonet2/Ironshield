"use client";
// OrderPanel — buy/sell form. Phase 3A is UI-only; Phase 3B wires
// Jupiter for SOL + Ref for NEAR under the same Execute button.
//
// Slippage chip + custom %, amount input, quote preview, route display.
// Button state reads the wallet store — no wallet = "Connect to trade".

import { useState } from "react";
import { useTheme } from "@/lib/contexts";
import { useWallet } from "@/lib/stores/walletStore";

const SLIPPAGE_PRESETS = [0.5, 1.0, 3.0];
const FEE_BPS = 20; // 0.2% — matches lib/fees.ts constant (Phase 3B)

function fmtUsd(n) {
  if (n == null || !isFinite(n)) return "—";
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(6)}`;
}

export default function OrderPanel({ chain, token, priceUsd }) {
  const t = useTheme();
  const [side, setSide]         = useState("buy");
  const [amount, setAmount]     = useState("");
  const [slippage, setSlippage] = useState(1.0);
  const wallet = useWallet((s) => s[chain]);

  const amountNum = Number(amount) || 0;
  const feeUsd = priceUsd && amountNum ? (amountNum * priceUsd * FEE_BPS) / 10_000 : 0;
  const canTrade = wallet?.connected && amountNum > 0 && token?.poolAddress;

  const disabledReason = !wallet?.connected
    ? `Connect a ${chain.toUpperCase()} wallet to trade`
    : !token?.poolAddress ? "Pick a token first"
    : amountNum <= 0 ? "Enter an amount"
    : null;

  const tab = (val, label) => (
    <button
      type="button"
      onClick={() => setSide(val)}
      style={{
        flex: 1,
        padding: "8px 0",
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0.6,
        textTransform: "uppercase",
        background: side === val ? "var(--accent-dim)" : "transparent",
        color: side === val ? t.accent : t.textMuted,
        border: "none",
        borderBottom: `2px solid ${side === val ? t.accent : "transparent"}`,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{
      padding: 14,
      border: `1px solid ${t.border}`,
      borderRadius: 12,
      background: "var(--bg-card)",
    }}>
      <div style={{ display: "flex", borderBottom: `1px solid ${t.border}`, marginBottom: 14 }}>
        {tab("buy", "Buy")}
        {tab("sell", "Sell")}
      </div>

      <label style={{ fontSize: 10, color: t.textDim, letterSpacing: 0.6, textTransform: "uppercase" }}>
        Amount ({side === "buy" ? chain.toUpperCase() : token?.baseSymbol || "—"})
      </label>
      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="0.00"
        style={{
          width: "100%",
          marginTop: 4,
          padding: "10px 12px",
          background: "var(--bg-input)",
          border: `1px solid ${t.border}`,
          borderRadius: 8,
          color: t.text,
          fontSize: 16,
          fontFamily: "var(--font-jetbrains-mono), monospace",
          outline: "none",
        }}
      />

      <div style={{ marginTop: 14 }}>
        <label style={{ fontSize: 10, color: t.textDim, letterSpacing: 0.6, textTransform: "uppercase" }}>
          Slippage
        </label>
        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
          {SLIPPAGE_PRESETS.map((p) => {
            const active = p === slippage;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setSlippage(p)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  border: `1px solid ${active ? t.accent : t.border}`,
                  background: active ? "var(--accent-dim)" : "transparent",
                  color: active ? t.accent : t.textMuted,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {p}%
              </button>
            );
          })}
          <input
            type="number"
            value={slippage}
            onChange={(e) => setSlippage(Number(e.target.value) || 0)}
            style={{
              width: 64,
              marginLeft: "auto",
              padding: "6px 8px",
              background: "var(--bg-input)",
              border: `1px solid ${t.border}`,
              borderRadius: 6,
              color: t.text,
              fontSize: 12,
              outline: "none",
            }}
            step="0.1" min="0" max="50"
          />
        </div>
      </div>

      <div style={{
        marginTop: 14,
        padding: 10,
        borderRadius: 8,
        background: "var(--bg-input)",
        fontSize: 11,
        color: t.textMuted,
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        rowGap: 4,
        columnGap: 10,
      }}>
        <span>Price</span>           <span style={{ textAlign: "right", color: t.text }}>{fmtUsd(priceUsd)}</span>
        <span>Slippage</span>        <span style={{ textAlign: "right", color: t.text }}>{slippage}%</span>
        <span>Platform fee</span>   <span style={{ textAlign: "right", color: t.text }}>0.20% ({fmtUsd(feeUsd)})</span>
        <span>Route</span>          <span style={{ textAlign: "right", color: t.textDim }}>
          {chain === "sol" ? "Jupiter" : chain === "near" ? "Ref Finance" : "—"}
        </span>
      </div>

      <button
        type="button"
        disabled={!canTrade}
        onClick={() => {
          // Phase 3B wires the actual swap here. Until then, a toast.
          window.alert(
            `Trade dispatch lands in Phase 3B:\n` +
            `${side.toUpperCase()} ${amountNum} on ${chain.toUpperCase()} via ` +
            `${chain === "sol" ? "Jupiter" : "Ref"}, slippage ${slippage}%`
          );
        }}
        style={{
          width: "100%",
          marginTop: 14,
          padding: "12px 16px",
          borderRadius: 8,
          border: "none",
          background: canTrade
            ? (side === "buy" ? "var(--green)" : "var(--red)")
            : "var(--bg-input)",
          color: canTrade ? "#fff" : t.textDim,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          cursor: canTrade ? "pointer" : "not-allowed",
        }}
      >
        {canTrade ? `${side} ${token?.baseSymbol || ""}` : (disabledReason || "—")}
      </button>
    </div>
  );
}
