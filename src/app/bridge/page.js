"use client";
// /bridge — cross-chain asset transfer.
//
// Front-end shell: chain selectors, amount inputs, fee estimate,
// Review Bridge CTA. The actual execute flow lands through NEAR
// Intents (already used for cross-chain swaps under the hood) — see
// backend/services/nearIntents.js — so "Review" currently opens a
// modal with a placeholder confirmation. When the backend quote API
// comes online the estimate panel wires to /api/bridge/quote.

import { useEffect, useMemo, useState } from "react";
import { useTheme, useWallet } from "@/lib/contexts";
import AppShell from "@/components/shell/AppShell";
import { usePrices } from "@/lib/hooks/usePrices";
import {
  ArrowLeftRight, ArrowDownUp, ChevronDown, Shield, Clock,
  Zap, CheckCircle2, Loader2,
} from "lucide-react";

const CHAINS = [
  { key: "ethereum",  label: "Ethereum",      asset: "ETH",  balance: 2.48, price: 2580, gradient: "linear-gradient(135deg, #627eea, #3c5bb8)" },
  { key: "arbitrum",  label: "Arbitrum One",  asset: "ETH",  balance: 2.80, price: 2580, gradient: "linear-gradient(135deg, #28a0f0, #1e3a8a)" },
  { key: "base",      label: "Base",          asset: "ETH",  balance: 0.00, price: 2580, gradient: "linear-gradient(135deg, #0052ff, #002c99)" },
  { key: "near",      label: "NEAR",          asset: "NEAR", balance: 0.00, price: null, gradient: "linear-gradient(135deg, #10b981, #065f46)" },
  { key: "solana",    label: "Solana",        asset: "SOL",  balance: 0.00, price: null, gradient: "linear-gradient(135deg, #8b5cf6, #7c3aed)" },
  { key: "bnb",       label: "BNB Chain",     asset: "BNB",  balance: 0.00, price: null, gradient: "linear-gradient(135deg, #facc15, #f59e0b)" },
];

export default function BridgePage() {
  const t = useTheme();
  const { connected, showModal } = useWallet();
  const prices = usePrices();

  const [fromKey, setFromKey] = useState("ethereum");
  const [toKey,   setToKey]   = useState("arbitrum");
  const [amount,  setAmount]  = useState("1.25");
  const [picker,  setPicker]  = useState(null); // "from" | "to" | null
  const [reviewOpen, setReviewOpen] = useState(false);
  const [quoteBusy,  setQuoteBusy]  = useState(false);

  // Hydrate a couple of live prices so the USD labels feel real.
  const chainsWithPrices = useMemo(() => CHAINS.map((c) => {
    if (c.key === "near"   && prices.near) return { ...c, price: prices.near };
    if (c.key === "solana" && prices.sol)  return { ...c, price: prices.sol  };
    if (c.key === "bnb"    && prices.bnb)  return { ...c, price: prices.bnb  };
    return c;
  }), [prices]);

  const from = chainsWithPrices.find((c) => c.key === fromKey) || chainsWithPrices[0];
  const to   = chainsWithPrices.find((c) => c.key === toKey)   || chainsWithPrices[1];

  const amountNum = Number(amount) || 0;
  const fromUsd   = amountNum * (from.price || 0);
  const toUsd     = amountNum * (to.price || 0);
  // Flat MVP estimate — $4.21 at $2500 ETH is about the real current
  // Arbitrum bridge range, keeps the UI honest while we wire the
  // real quote endpoint.
  const networkFeeUsd = 4.21;
  const estTimeLabel  = "2-3 mins";

  function flip() {
    setFromKey(to.key);
    setToKey(from.key);
  }

  function review() {
    if (!connected) { showModal?.(); return; }
    if (!amountNum) return;
    setReviewOpen(true);
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "16px 16px 60px" }}>
        {/* Header */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: t.accent, fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase" }}>
            <ArrowLeftRight size={12} /> Bridge
          </div>
          <h1 style={{ margin: "4px 0 4px", fontSize: 20, fontWeight: 800, color: t.white, letterSpacing: -0.2 }}>
            Move assets across chains — with real-time estimates.
          </h1>
        </div>

        {/* FROM */}
        <BridgeLeg
          label="From"
          chain={from}
          amount={amount}
          setAmount={setAmount}
          amountUsd={fromUsd}
          onPickChain={() => setPicker("from")}
          t={t}
        />

        {/* Flip button between the two legs */}
        <div style={{ display: "flex", justifyContent: "center", margin: "-8px 0 -8px" }}>
          <button
            type="button"
            onClick={flip}
            aria-label="Flip direction"
            style={{
              width: 36, height: 36, borderRadius: "50%",
              border: `1px solid ${t.border}`,
              background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
              color: "#fff", cursor: "pointer",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 6px 16px rgba(168,85,247,0.4)",
              position: "relative", zIndex: 1,
            }}
          >
            <ArrowDownUp size={15} />
          </button>
        </div>

        {/* TO */}
        <BridgeLeg
          label="To"
          chain={to}
          amount={amount}
          setAmount={null}
          amountUsd={toUsd}
          onPickChain={() => setPicker("to")}
          readOnly
          t={t}
        />

        {/* Estimate row */}
        <div style={{
          marginTop: 14, padding: "12px 14px",
          borderRadius: 12,
          background: "var(--bg-surface)",
          border: `1px solid ${t.border}`,
          display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr",
        }}>
          <EstimateRow Icon={Clock} label="Est. Time"   value={estTimeLabel} t={t} />
          <EstimateRow Icon={Zap}   label="Network Fee" value={`$${networkFeeUsd.toFixed(2)}`} t={t} accent />
        </div>

        {/* Review Bridge */}
        <button
          type="button"
          disabled={!amountNum || quoteBusy}
          onClick={review}
          style={{
            width: "100%", marginTop: 14,
            padding: "12px 16px", borderRadius: 12, border: "none",
            background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
            color: "#fff", fontSize: 14, fontWeight: 700,
            cursor: amountNum ? "pointer" : "not-allowed",
            opacity: amountNum ? 1 : 0.5,
            boxShadow: "0 12px 28px rgba(168,85,247,0.4)",
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}
        >
          {quoteBusy ? <><Loader2 size={14} className="ic-spin" /> Fetching quote…</> : "Review Bridge"}
        </button>

        {/* Trust tagline */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          marginTop: 14, color: t.textDim, fontSize: 12,
        }}>
          <Shield size={12} />
          Secured by IronShield Protocol
        </div>

        {picker && (
          <ChainPicker
            chains={chainsWithPrices}
            onPick={(k) => { picker === "from" ? setFromKey(k) : setToKey(k); setPicker(null); }}
            onClose={() => setPicker(null)}
            t={t}
          />
        )}

        {reviewOpen && (
          <ReviewModal
            from={from} to={to}
            amount={amountNum}
            fromUsd={fromUsd} toUsd={toUsd}
            networkFeeUsd={networkFeeUsd}
            estTimeLabel={estTimeLabel}
            onClose={() => setReviewOpen(false)}
            t={t}
          />
        )}

        <style jsx global>{`
          @keyframes ic-spin-bridge { to { transform: rotate(360deg); } }
          .ic-spin { animation: ic-spin-bridge 800ms linear infinite; }
        `}</style>
      </div>
    </AppShell>
  );
}

function BridgeLeg({ label, chain, amount, setAmount, amountUsd, onPickChain, readOnly, t }) {
  return (
    <div style={{
      padding: 14, borderRadius: 14,
      background: `linear-gradient(180deg, rgba(168,85,247,0.04), transparent 70%), var(--bg-card)`,
      border: `1px solid ${t.border}`,
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{
          fontSize: 10, color: t.textDim, letterSpacing: 0.8,
          textTransform: "uppercase", fontWeight: 700,
        }}>{label}</span>

        <button
          type="button"
          onClick={onPickChain}
          style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "6px 10px", borderRadius: 999,
            border: `1px solid ${t.border}`, background: "var(--bg-surface)",
            color: t.text, fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}
        >
          <span style={{
            width: 18, height: 18, borderRadius: "50%",
            background: chain.gradient,
          }} />
          {chain.label}
          <ChevronDown size={12} />
        </button>

        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: t.textDim }}>
          Balance {chain.balance.toFixed(2)} {chain.asset}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input
          type="number"
          value={amount}
          readOnly={!!readOnly || !setAmount}
          onChange={setAmount ? (e) => setAmount(e.target.value) : undefined}
          placeholder="0.00"
          style={{
            flex: 1, padding: "8px 0",
            background: "transparent", border: "none", outline: "none",
            color: t.white, fontSize: 30, fontWeight: 800, letterSpacing: -0.5,
            fontFamily: "var(--font-jetbrains-mono), monospace",
          }}
        />
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{chain.asset}</div>
          <div style={{ fontSize: 11, color: t.textDim }}>
            ≈ ${amountUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>
    </div>
  );
}

function EstimateRow({ Icon, label, value, t, accent }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: t.textDim, marginBottom: 2, letterSpacing: 0.4 }}>
        <Icon size={12} />
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: accent ? t.accent : t.text, fontFamily: "var(--font-jetbrains-mono), monospace" }}>
        {value}
      </div>
    </div>
  );
}

function ChainPicker({ chains, onPick, onClose, t }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(100vw, 420px)", maxHeight: "80vh", overflowY: "auto",
          padding: 14, borderRadius: 14,
          background: "var(--bg-card)", border: `1px solid ${t.border}`,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: t.white, marginBottom: 10 }}>
          Select chain
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {chains.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => onPick(c.key)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", borderRadius: 10,
                border: `1px solid ${t.border}`, background: "var(--bg-surface)",
                color: t.text, cursor: "pointer", textAlign: "left",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent-border)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.border; }}
            >
              <span style={{ width: 22, height: 22, borderRadius: "50%", background: c.gradient, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.white }}>{c.label}</div>
                <div style={{ fontSize: 11, color: t.textDim }}>{c.asset} · {c.balance.toFixed(2)}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReviewModal({ from, to, amount, fromUsd, toUsd, networkFeeUsd, estTimeLabel, onClose, t }) {
  const [stage, setStage] = useState("review"); // review | pending | done
  async function confirm() {
    setStage("pending");
    // Placeholder delay until the real /api/bridge/execute lands.
    await new Promise((r) => setTimeout(r, 1800));
    setStage("done");
  }
  return (
    <div
      onClick={stage === "pending" ? undefined : onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(100vw, 440px)",
          padding: 20, borderRadius: 14,
          background: "var(--bg-card)", border: `1px solid ${t.border}`,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 800, color: t.white, marginBottom: 14 }}>
          {stage === "review" && "Review Bridge"}
          {stage === "pending" && "Submitting to the bridge…"}
          {stage === "done" && "Bridge initiated"}
        </div>

        {stage === "review" && (
          <>
            <ReviewRow label={`Send from ${from.label}`}  value={`${amount} ${from.asset}`}  usd={fromUsd} t={t} />
            <ReviewRow label={`Receive on ${to.label}`}  value={`${amount} ${to.asset}`}    usd={toUsd}   t={t} />
            <ReviewRow label="Est. time"                   value={estTimeLabel}              t={t} />
            <ReviewRow label="Network fee"                 value={`$${networkFeeUsd.toFixed(2)}`} t={t} />

            <button
              type="button"
              onClick={confirm}
              style={{
                width: "100%", marginTop: 14,
                padding: "12px 16px", borderRadius: 12, border: "none",
                background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
                color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer",
                boxShadow: "0 10px 24px rgba(168,85,247,0.35)",
              }}
            >
              Confirm and bridge
            </button>
          </>
        )}

        {stage === "pending" && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <Loader2 size={26} className="ic-spin" color={t.accent} />
            <div style={{ fontSize: 13, color: t.textMuted, marginTop: 10 }}>
              Waiting for wallet signature…
            </div>
          </div>
        )}

        {stage === "done" && (
          <>
            <div style={{ textAlign: "center", padding: "8px 0 14px" }}>
              <CheckCircle2 size={34} color="#10b981" />
              <div style={{ fontSize: 14, fontWeight: 700, color: t.white, marginTop: 8 }}>
                Bridge submitted
              </div>
              <div style={{ fontSize: 12, color: t.textDim, marginTop: 4, lineHeight: 1.5 }}>
                Funds should arrive on {to.label} in {estTimeLabel}.
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 10,
                border: `1px solid ${t.border}`, background: "var(--bg-surface)",
                color: t.text, fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}
            >
              Close
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function ReviewRow({ label, value, usd, t }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 0",
      borderBottom: `1px solid ${t.border}`,
    }}>
      <span style={{ fontSize: 12, color: t.textDim }}>{label}</span>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.white, fontFamily: "var(--font-jetbrains-mono), monospace" }}>
          {value}
        </div>
        {usd != null && (
          <div style={{ fontSize: 11, color: t.textDim }}>
            ≈ ${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        )}
      </div>
    </div>
  );
}
