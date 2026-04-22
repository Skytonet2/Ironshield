"use client";
// BridgeModal — NEAR Intents cross-chain swap (spec §7).
//
// From: [Chain] [Token] [Amount]     To: [Chain] [Token]
//                    ↕
// Quote: rate · min received · fees · ETA
// [Bridge] button
//
// This turn ships: token loading, debounced quote fetch via our
// backend proxy, price/ETA preview, swap-direction button. The
// signed-intent submission lands in Phase 5-3 when the NEP-413
// signMessage integration across wallets is tested. Bridge button
// surfaces a clear "coming next session" status today.

import { useEffect, useMemo, useState } from "react";
import { ArrowDownUp, X as XIcon } from "lucide-react";
import { useTheme, useWallet as useNearWalletCtx } from "@/lib/contexts";

const BACKEND_BASE = (() => {
  if (typeof window === "undefined") return "";
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3001";
  return "https://ironclaw-backend.onrender.com";
})();

// Placeholder recipients per destination blockchain so dry quotes can
// run before the user connects a wallet / pastes a real address. These
// aren't wallets we control — they're format-valid dummies 1click
// accepts for quote validation. Real bridges require a real recipient.
const PLACEHOLDER_RECIPIENT = {
  near: "guest.near",
  sol:  "7ZbEHHu4m6Rr5uWaGbfQ6dA3b2Z8kWq9hN1gZ2QvPXYZ",
  eth:  "0x0000000000000000000000000000000000000001",
  arb:  "0x0000000000000000000000000000000000000001",
  base: "0x0000000000000000000000000000000000000001",
  bsc:  "0x0000000000000000000000000000000000000001",
  op:   "0x0000000000000000000000000000000000000001",
  pol:  "0x0000000000000000000000000000000000000001",
  avax: "0x0000000000000000000000000000000000000001",
  btc:  "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
  sui:  "0x0000000000000000000000000000000000000000000000000000000000000001",
  tron: "TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH",
  xrp:  "rN7n7otQDd6FczFgLdSqtcsAUxDkw6fzRH",
  ton:  "UQBcWhP_GOH7X4L0PGknEdsZ-BVk-iJDMsa5EzWmBoXo5rVw",
  xlm:  "GAIGZHHWK3REZQPLQX5DNUN4A32CSEONTU6CMDBO7GDWLPSXZDSYA4JU",
  zec:  "t1ZcWhiN3Nn1pZbBVqMkQ1dL9nxQ86dNVTn",
  doge: "D6W8RhVzwDcP4cdTwqxZ3qkAiK9zQ8XGHi",
  stellar: "GAIGZHHWK3REZQPLQX5DNUN4A32CSEONTU6CMDBO7GDWLPSXZDSYA4JU",
  starknet: "0x0000000000000000000000000000000000000000000000000000000000000001",
  gnosis: "0x0000000000000000000000000000000000000001",
};

const CHAIN_LABELS = {
  near: "NEAR",
  sol:  "Solana",
  eth:  "Ethereum",
  btc:  "Bitcoin",
  arb:  "Arbitrum",
  base: "Base",
  bsc:  "BNB",
  sui:  "Sui",
  tron: "Tron",
};

function fmtUsd(n) {
  const v = Number(n || 0);
  if (!isFinite(v) || v === 0) return "—";
  if (v >= 1)    return `$${v.toFixed(2)}`;
  if (v >= 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toExponential(2)}`;
}

function fmtAmount(baseStr, decimals) {
  if (!baseStr) return "—";
  try {
    const n = BigInt(baseStr);
    const factor = 10n ** BigInt(decimals || 0);
    const whole = n / factor;
    const frac  = n % factor;
    const fracStr = frac.toString().padStart(Number(decimals || 0), "0").slice(0, 8);
    return `${whole}${fracStr ? "." + fracStr.replace(/0+$/, "") : ""}`;
  } catch { return baseStr; }
}

export default function BridgeModal({ onClose }) {
  const t = useTheme();
  const nearCtx = useNearWalletCtx();
  const [tokens, setTokens] = useState([]);
  const [fromId, setFromId] = useState("nep141:wrap.near");
  const [toId, setToId]     = useState("nep141:sol.omft.near");
  const [amount, setAmount] = useState("");
  const [quote, setQuote]   = useState(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [err, setErr]       = useState(null);
  const [status, setStatus] = useState(null);

  // Load the token registry once per mount (backend caches upstream).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${BACKEND_BASE}/api/bridge/tokens`);
        if (!r.ok) throw new Error(`tokens ${r.status}`);
        const j = await r.json();
        if (!cancelled) setTokens(Array.isArray(j) ? j : []);
      } catch (e) {
        if (!cancelled) setErr(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Escape to close.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fromToken = useMemo(() => tokens.find((x) => x.assetId === fromId) || null, [tokens, fromId]);
  const toToken   = useMemo(() => tokens.find((x) => x.assetId === toId)   || null, [tokens, toId]);

  // Amount in base units for the quote endpoint. Precision-safe via
  // BigInt — some bridgeable tokens have 24 decimals (NEAR).
  const amountBase = useMemo(() => {
    if (!fromToken || !amount || !Number.isFinite(Number(amount))) return null;
    try {
      const f = 10n ** BigInt(fromToken.decimals || 0);
      const whole = BigInt(Math.floor(Number(amount)));
      const frac  = Math.floor((Number(amount) - Math.floor(Number(amount))) * Number(f));
      const v = (whole * f + BigInt(frac));
      return v > 0n ? v.toString() : null;
    } catch { return null; }
  }, [fromToken, amount]);

  // Debounced quote. 400ms so typing "1.5" doesn't hammer 1click with
  // three requests.
  useEffect(() => {
    if (!amountBase || !fromToken || !toToken || fromToken.assetId === toToken.assetId) {
      setQuote(null);
      return;
    }
    // Real recipient once signed; placeholder good enough for the dry
    // quote so the UI can preview a rate before the user connects.
    // If the destination is NEAR we reuse the connected NEAR wallet;
    // else map to a chain-appropriate format-valid dummy.
    const destChain = toToken.blockchain;
    const recipient = destChain === "near"
      ? (nearCtx?.address || "guest.near")
      : (PLACEHOLDER_RECIPIENT[destChain] || "guest.near");
    const refundTo = nearCtx?.address || PLACEHOLDER_RECIPIENT[fromToken.blockchain] || "guest.near";
    const timer = setTimeout(async () => {
      setLoadingQuote(true);
      setErr(null);
      try {
        const r = await fetch(`${BACKEND_BASE}/api/bridge/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            originAsset:      fromToken.assetId,
            destinationAsset: toToken.assetId,
            amount:           amountBase,
            slippageBps:      100,
            refundTo,
            recipient,
            dry: true,
          }),
        });
        const j = await r.json();
        if (!r.ok) {
          // Bubble 1click's validation messages verbatim — they're
          // precise about what's missing or wrong.
          throw new Error(j.error || `quote ${r.status}`);
        }
        setQuote(j.quote || null);
      } catch (e) {
        setErr(e.message || String(e));
        setQuote(null);
      } finally {
        setLoadingQuote(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [amountBase, fromToken, toToken, nearCtx?.address]);

  const swap = () => { setFromId(toId); setToId(fromId); setQuote(null); };

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.62)",
        backdropFilter: "blur(8px)",
        zIndex: 220,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 520,
          background: "var(--bg-surface)",
          border: `1px solid ${t.border}`,
          borderRadius: 14,
          boxShadow: "0 20px 80px rgba(0,0,0,0.5), var(--accent-glow)",
          padding: 22,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <ArrowDownUp size={16} style={{ color: t.accent }} />
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.white }}>
            Bridge via NEAR Intents
          </h2>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent", border: "none",
              color: t.textDim, cursor: "pointer", padding: 4,
              display: "inline-flex",
            }}
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* From row */}
        <Row
          label="From"
          token={fromToken}
          tokens={tokens}
          selectedId={fromId}
          onSelect={setFromId}
          amount={amount}
          onAmount={setAmount}
          editable
          t={t}
        />

        {/* Flip */}
        <div style={{ display: "flex", justifyContent: "center", margin: "6px 0" }}>
          <button
            type="button"
            onClick={swap}
            title="Swap From / To"
            style={{
              width: 32, height: 32, borderRadius: "50%",
              border: `1px solid ${t.border}`,
              background: "var(--bg-card)",
              color: t.accent, cursor: "pointer",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <ArrowDownUp size={14} />
          </button>
        </div>

        {/* To row */}
        <Row
          label="To"
          token={toToken}
          tokens={tokens}
          selectedId={toId}
          onSelect={setToId}
          amount={quote ? fmtAmount(quote.amountOut, toToken?.decimals) : ""}
          t={t}
        />

        {/* Quote summary */}
        <div style={{
          marginTop: 14,
          padding: "10px 12px",
          borderRadius: 10,
          background: "var(--bg-input)",
          fontSize: 11,
          color: t.textMuted,
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          rowGap: 5,
          columnGap: 10,
        }}>
          <span>Rate</span>
          <span style={{ textAlign: "right", color: t.text }}>
            {quote && fromToken && toToken
              ? `1 ${fromToken.symbol} ≈ ${(Number(quote.amountOut) / 10 ** (toToken.decimals || 0) / Number(amount || 1)).toFixed(6)} ${toToken.symbol}`
              : "—"}
          </span>
          <span>Minimum received</span>
          <span style={{ textAlign: "right", color: t.text }}>
            {quote && toToken
              ? `${fmtAmount(quote.minAmountOut, toToken.decimals)} ${toToken.symbol}`
              : "—"}
          </span>
          <span>USD value</span>
          <span style={{ textAlign: "right", color: t.text }}>
            {quote?.amountOutUsd ? fmtUsd(quote.amountOutUsd) : "—"}
          </span>
          <span>IronShield fee</span>
          <span style={{ textAlign: "right", color: t.text }}>0.20%</span>
          <span>ETA</span>
          <span style={{ textAlign: "right", color: t.text }}>
            {quote?.timeEstimate ? `~${quote.timeEstimate}s` : "—"}
          </span>
        </div>

        {err && (
          <div style={{
            marginTop: 10,
            padding: "8px 10px",
            borderRadius: 8,
            background: "var(--bg-input)",
            color: "var(--red)",
            fontSize: 11,
            lineHeight: 1.5,
          }}>
            {err}
          </div>
        )}
        {status && (
          <div style={{
            marginTop: 10,
            padding: "8px 10px",
            borderRadius: 8,
            background: "var(--bg-input)",
            color: t.textMuted,
            fontSize: 11,
            lineHeight: 1.5,
          }}>
            {status}
          </div>
        )}

        <button
          type="button"
          disabled={!quote || loadingQuote}
          onClick={() => setStatus(
            "Signed-intent submission lands in Phase 5-3 — we're wiring " +
            "NEP-413 signMessage across all wallets in the selector. " +
            "Quote + 0.2% fee routing is live today."
          )}
          style={{
            width: "100%",
            marginTop: 14,
            padding: "12px 16px",
            borderRadius: 10,
            border: "none",
            background: quote && !loadingQuote ? t.accent : "var(--bg-input)",
            color: quote && !loadingQuote ? "#fff" : t.textDim,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            cursor: quote && !loadingQuote ? "pointer" : "not-allowed",
          }}
        >
          {loadingQuote ? "Quoting…" : "Bridge"}
        </button>
      </div>
    </div>
  );
}

function Row({ label, token, tokens, selectedId, onSelect, amount, onAmount, editable = false, t }) {
  return (
    <div style={{
      padding: "12px 14px",
      borderRadius: 10,
      border: `1px solid ${t.border}`,
      background: "var(--bg-card)",
    }}>
      <div style={{
        fontSize: 10,
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: t.textDim,
        marginBottom: 6,
      }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <select
          value={selectedId}
          onChange={(e) => onSelect(e.target.value)}
          style={{
            padding: "8px 10px",
            borderRadius: 8,
            border: `1px solid ${t.border}`,
            background: "var(--bg-input)",
            color: t.text,
            fontSize: 12,
            minWidth: 180,
            fontFamily: "inherit",
            outline: "none",
          }}
        >
          {tokens.map((tk) => (
            <option key={tk.assetId} value={tk.assetId}>
              {tk.symbol} · {CHAIN_LABELS[tk.blockchain] || tk.blockchain}
            </option>
          ))}
        </select>
        <input
          value={amount}
          readOnly={!editable}
          onChange={editable ? (e) => onAmount(e.target.value) : undefined}
          placeholder="0.00"
          type={editable ? "number" : "text"}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "8px 10px",
            borderRadius: 8,
            border: `1px solid ${t.border}`,
            background: editable ? "var(--bg-input)" : "transparent",
            color: t.text,
            fontSize: 16,
            fontFamily: "var(--font-jetbrains-mono), monospace",
            textAlign: "right",
            outline: "none",
          }}
        />
      </div>
      {token?.price && (
        <div style={{
          fontSize: 10,
          color: t.textDim,
          marginTop: 4,
          textAlign: "right",
          fontFamily: "var(--font-jetbrains-mono), monospace",
        }}>
          {fmtUsd(token.price)} / {token.symbol}
        </div>
      )}
    </div>
  );
}
