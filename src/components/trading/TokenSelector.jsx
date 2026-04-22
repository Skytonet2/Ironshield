"use client";
// TokenSelector — free-text search against GeckoTerminal, debounced.
//
// User types a ticker / name / partial address; we hit searchPools with
// chain-scope and render a ranked list by liquidity. Clicking a result
// hands (poolAddress, baseSymbol) up to the parent.

import { useEffect, useRef, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { useTheme } from "@/lib/contexts";
import { searchTokens, fetchPoolDetails } from "@/lib/api/geckoTerminal";

const DEBOUNCE_MS = 220;

function fmtUsd(n) {
  if (n == null || !isFinite(n)) return "—";
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toExponential(2)}`;
}

/** Enrich a search result with mint addresses + decimals so the swap
 *  path can build a Jupiter quote. Search API doesn't include these;
 *  the pool-detail endpoint does. Falls back to the raw search row
 *  when enrichment fails so the chart still works (swap will error
 *  clearly with "Token missing mint metadata" on Execute).
 */
async function enrichWithMetadata(chain, raw) {
  try {
    const d = await fetchPoolDetails({ chain, pool: raw.poolAddress });
    return {
      ...raw,
      baseMint:     d.base.address,
      quoteMint:    d.quote.address,
      baseDecimals: d.base.decimals,
      quoteDecimals: d.quote.decimals,
      dex: d.dex,
    };
  } catch {
    return raw;
  }
}

export default function TokenSelector({ chain, value, onPick }) {
  const t = useTheme();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const ctlRef = useRef(null);
  const rootRef = useRef(null);

  // Debounced search. Cancels the previous request on every keystroke.
  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const timer = setTimeout(async () => {
      ctlRef.current?.abort();
      const ctl = new AbortController();
      ctlRef.current = ctl;
      setLoading(true);
      try {
        const rows = await searchTokens({ chain, query: q, signal: ctl.signal });
        setResults(rows.slice(0, 12));
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q, chain]);

  // Click-outside closes the dropdown.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative", flex: 1, minWidth: 240 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 12px",
        border: `1px solid ${open ? t.accent : t.border}`,
        borderRadius: 8,
        background: "var(--bg-input)",
      }}>
        <SearchIcon size={14} style={{ color: t.textDim }} />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={value ? value.baseSymbol : `Search ${chain.toUpperCase()} tokens or paste a CA`}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: t.text,
            fontSize: 13,
          }}
        />
        {value && (
          <span style={{
            fontSize: 11,
            padding: "1px 6px",
            borderRadius: 4,
            background: "var(--accent-dim)",
            color: t.accent,
          }}>
            {value.baseSymbol}
          </span>
        )}
      </div>
      {open && (q || loading) && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0, right: 0,
          maxHeight: 360,
          overflowY: "auto",
          background: "var(--bg-surface)",
          border: `1px solid ${t.border}`,
          borderRadius: 10,
          boxShadow: "0 10px 40px rgba(0,0,0,0.4)",
          zIndex: 30,
        }}>
          {loading && (
            <div style={{ padding: 10, fontSize: 12, color: t.textDim }}>Searching…</div>
          )}
          {!loading && results.length === 0 && (
            <div style={{ padding: 10, fontSize: 12, color: t.textDim }}>No matches.</div>
          )}
          {results.map((r) => (
            <button
              key={r.poolAddress}
              type="button"
              onClick={async () => {
                setOpen(false);
                setQ("");
                const enriched = await enrichWithMetadata(chain, r);
                onPick(enriched);
              }}
              style={{
                display: "flex",
                width: "100%",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                background: "transparent",
                border: "none",
                color: t.text,
                cursor: "pointer",
                textAlign: "left",
                fontSize: 12,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-card-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{
                fontWeight: 700,
                color: t.white,
                minWidth: 80,
              }}>
                {r.baseSymbol}/{r.quoteSymbol}
              </span>
              <span style={{ color: t.textDim, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.name}
              </span>
              <span style={{ fontFamily: "var(--font-jetbrains-mono), monospace", color: t.textMuted }}>
                {fmtUsd(r.priceUsd)}
              </span>
              <span style={{
                minWidth: 52,
                textAlign: "right",
                color: r.change24h >= 0 ? "var(--green)" : "var(--red)",
                fontSize: 11,
              }}>
                {r.change24h >= 0 ? "+" : ""}{r.change24h.toFixed(1)}%
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
