"use client";

// ── NewsCoinTerminal ──────────────────────────────────────────────────
// Full Axiom-style trading terminal for a NewsCoin. Three columns on
// desktop, stacked on mobile (chart full-width, order panel slides up
// from bottom as a drawer).
//
// Price/OHLCV is fetched live from /api/newscoin/:coinId/candles, which
// aggregates feed_newscoin_trades into OHLCV buckets. The deterministic
// ticker-seeded RNG below is kept as a fallback for brand-new coins
// that have no trades yet, so the chart still renders something
// coherent on the first user's first visit.
//
// Buy/sell submission re-uses the exact on-chain flow from `CoinModal`
// so we don't fork the tx logic.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight, ArrowUpRight, BarChart3, Bell, Copy, ExternalLink,
  Flame, Loader2, Lock, Search, TrendingUp, X,
} from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import { sendTx, functionCallAction } from "@/lib/walletActions";

import { API_BASE as API } from "@/lib/apiBase";
const ORANGE = "#f97316";

// ── Formatting helpers (kept local to avoid coupling) ────────────────
function fmtNear(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return "0";
  if (n === 0) return "0";
  if (n < 0.0001) return n.toExponential(2);
  if (n < 1) return n.toFixed(6);
  if (n < 1000) return n.toFixed(3);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function fmtUsd(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}
function fmtTokens(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
}
function shortWallet(w = "") {
  if (!w) return "";
  return w.length > 16 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w;
}
function timeAgo(d) {
  if (!d) return "";
  const s = Math.max(1, Math.floor((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
function api(path, init = {}) {
  return fetch(`${API}${path}`, init).then(r => r.json()).catch(() => null);
}

// ── Lifecycle badge ──────────────────────────────────────────────────
// Maps bonding-curve fill % to one of five IronClaw-managed lifecycle
// states. Real contract state (graduated / killed) overrides the %.
function lifecycleFor({ bondingPct = 0, graduated = false, killed = false }) {
  if (killed)     return { key: "killed",     label: "Killed",     color: "#6b7280" };
  if (graduated)  return { key: "graduated",  label: "Graduated",  color: "#a78bfa" };
  if (bondingPct >= 90) return { key: "graduating", label: "Graduating", color: "#60a5fa" };
  if (bondingPct >= 60) return { key: "peak",        label: "Peak",        color: "#fb923c" };
  if (bondingPct >= 20) return { key: "trending",    label: "Trending",    color: "#facc15" };
  return                    { key: "early",       label: "Early",       color: "#10b981" };
}

// ── Deterministic OHLCV mock ─────────────────────────────────────────
// Seeds a predictable candle sequence from the ticker so two users
// viewing the same coin see the same chart. Replace with a live trade
// aggregator when available.
function seedFromString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}
function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return (s >>> 0) / 4294967295;
  };
}
function mockCandles(ticker, basePrice, count = 120) {
  const rand = seededRandom(seedFromString(ticker || "IRONCLAW"));
  const candles = [];
  let price = basePrice > 0 ? basePrice : 0.00001;
  const now = Math.floor(Date.now() / 1000);
  const step = 60; // 1m candles
  for (let i = count - 1; i >= 0; i--) {
    const vol = (rand() * 0.08 - 0.04); // ±4%
    const open = price;
    const close = Math.max(open * (1 + vol), 1e-12);
    const high = Math.max(open, close) * (1 + rand() * 0.02);
    const low  = Math.min(open, close) * (1 - rand() * 0.02);
    candles.push({
      time: now - i * step,
      open, high, low, close,
      volume: Math.floor(rand() * 5000 + 500),
    });
    price = close;
  }
  return candles;
}

// ── Chart component (lightweight-charts v5) ──────────────────────────
function CandleChart({ candles, color = ORANGE, dark = true }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const lc = await import("lightweight-charts");
        if (cancelled || !containerRef.current) return;
        const chart = lc.createChart(containerRef.current, {
          layout: {
            background: { color: "transparent" },
            textColor: dark ? "#94a3b8" : "#475569",
            attributionLogo: false,
          },
          grid: {
            vertLines: { color: dark ? "#1f2937" : "#e2e8f0" },
            horzLines: { color: dark ? "#1f2937" : "#e2e8f0" },
          },
          rightPriceScale: { borderVisible: false },
          timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
          crosshair: { mode: 1 },
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
        const series = chart.addSeries(lc.CandlestickSeries, {
          upColor: "#10b981", borderUpColor: "#10b981", wickUpColor: "#10b981",
          downColor: "#ef4444", borderDownColor: "#ef4444", wickDownColor: "#ef4444",
        });
        series.setData(candles);
        chart.timeScale().fitContent();
        chartRef.current = chart;
        seriesRef.current = series;

        const onResize = () => {
          if (!containerRef.current || !chartRef.current) return;
          chartRef.current.applyOptions({
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight,
          });
        };
        const ro = new ResizeObserver(onResize);
        ro.observe(containerRef.current);
        chartRef.current._ro = ro;
      } catch (e) {
        console.warn("[NewsCoinTerminal] chart init failed:", e?.message);
      }
    })();
    return () => {
      cancelled = true;
      try {
        chartRef.current?._ro?.disconnect?.();
        chartRef.current?.remove?.();
      } catch {}
      chartRef.current = null; seriesRef.current = null;
    };
  }, [dark]);

  useEffect(() => {
    if (seriesRef.current && candles?.length) {
      try { seriesRef.current.setData(candles); chartRef.current?.timeScale().fitContent(); } catch {}
    }
  }, [candles]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

// ── Order panel (Buy / Sell) ─────────────────────────────────────────
function OrderPanel({ t, coin, wallet, selector, onTraded }) {
  const [side, setSide] = useState("buy");
  const [orderType, setOrderType] = useState("market"); // market | limit | adv
  const [amount, setAmount] = useState("");
  // NOTE: this slippage value is cosmetic right now. The buy/sell
  // FunctionCall args below don't pass a min_out — the bonding-curve
  // contract returns whatever the curve quotes. Fixing this needs a
  // contract-side `min_tokens_out` / `min_near_out` arg (v1.1).
  // Default lowered 20→1 to read as a plausible value rather than a
  // 20% giveaway invite.
  const [slippage, setSlippage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState("");

  const quickAmts = ["0.01", "0.1", "1", "10"];

  const priceNear = Number(coin?.price_near || 0);
  const est = (() => {
    const n = Number(amount);
    if (!n || !priceNear) return 0;
    return side === "buy" ? n / priceNear : n * priceNear;
  })();

  // Price age tracking. Stamp the wall-clock time whenever priceNear
  // changes value, then tick a "now" state every 1s so the rendered
  // age stays current. The 10s threshold triggers a "stale" badge —
  // mirrors the standard "quote is getting old" UX without needing a
  // server-side quote endpoint (NewsCoin trades execute on-chain
  // directly so there's no quote to re-mint).
  const priceStampRef = useRef({ value: priceNear, at: Date.now() });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (priceNear !== priceStampRef.current.value) {
      priceStampRef.current = { value: priceNear, at: Date.now() };
    }
  }, [priceNear]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const priceAgeS = priceNear > 0 ? Math.floor((now - priceStampRef.current.at) / 1000) : 0;
  const priceStale = priceAgeS >= 10;

  const handleTrade = useCallback(async () => {
    if (!wallet || !selector) { setErr("Connect your wallet first"); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { setErr("Enter a valid amount"); return; }
    const addr = coin?.coinAddress || coin?.curve_contract || coin?.id;
    if (!addr || !String(addr).includes(".")) { setErr("Coin address not ready — refresh"); return; }
    setErr(""); setSuccess(""); setLoading(true);
    try {
      const w = await selector.wallet();
      let action;
      if (side === "buy") {
        const [whole, frac = ""] = String(amt).split(".");
        const padded = (frac + "0".repeat(24)).slice(0, 24);
        const yocto = (BigInt(whole || "0") * 1_000_000_000_000_000_000_000_000n + BigInt(padded || "0")).toString();
        action = functionCallAction({ methodName: "buy", args: {}, gas: "100000000000000", deposit: yocto });
      } else {
        const [whole, frac = ""] = String(amt).split(".");
        const padded = (frac + "0".repeat(18)).slice(0, 18);
        const tokenAmount = (BigInt(whole || "0") * 1_000_000_000_000_000_000n + BigInt(padded || "0")).toString();
        action = functionCallAction({ methodName: "sell", args: { amount: tokenAmount }, gas: "100000000000000", deposit: "1" });
      }
      await sendTx(w, wallet, addr, [action]);
      setSuccess(`${side === "buy" ? "Bought" : "Sold"} successfully`);
      setAmount("");
      onTraded?.();
    } catch (e) {
      const msg = e?.message || String(e);
      setErr(/reject|cancel|denied|user closed/i.test(msg) ? "Transaction cancelled" : msg.slice(0, 120));
    } finally {
      setLoading(false);
    }
  }, [amount, coin, onTraded, selector, side, wallet]);

  const inputStyle = {
    flex: 1, background: t.bgSurface, border: `1px solid ${t.border}`,
    borderRadius: 10, padding: "10px 12px", color: t.white, fontSize: 15,
    fontFamily: "'JetBrains Mono', monospace", outline: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Buy / Sell toggle */}
      <div style={{ display: "flex", gap: 4, background: t.bgSurface, borderRadius: 10, padding: 3 }}>
        {["buy", "sell"].map(s => (
          <button key={s} onClick={() => { setSide(s); setAmount(""); }} style={{
            flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 13, fontWeight: 800,
            background: side === s ? (s === "buy" ? t.green : t.red) : "transparent",
            color: side === s ? "#fff" : t.textMuted,
            border: "none", cursor: "pointer", textTransform: "capitalize",
          }}>{s}</button>
        ))}
      </div>

      {/* Order type tabs */}
      <div style={{ display: "flex", gap: 4, fontSize: 12 }}>
        {["market", "limit", "adv"].map(ot => (
          <button key={ot} onClick={() => setOrderType(ot)} style={{
            flex: 1, padding: "6px 0", borderRadius: 8, fontWeight: 700,
            background: orderType === ot ? `${ORANGE}22` : "transparent",
            color: orderType === ot ? ORANGE : t.textMuted,
            border: `1px solid ${orderType === ot ? ORANGE + "55" : t.border}`,
            cursor: "pointer", textTransform: "capitalize",
          }}>{ot === "adv" ? "Adv." : ot}</button>
        ))}
      </div>

      {/* Amount */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <div style={{ fontSize: 11, color: t.textDim }}>AMOUNT</div>
          <div style={{ fontSize: 11, color: t.textDim, fontFamily: "'JetBrains Mono', monospace" }}>
            {side === "buy" ? "NEAR" : `$${coin?.ticker || "COIN"}`}
          </div>
        </div>
        <input
          type="number" min="0" step="any" placeholder="0.0"
          value={amount} onChange={e => { setAmount(e.target.value); setErr(""); setSuccess(""); }}
          style={inputStyle}
        />
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          {quickAmts.map(q => (
            <button key={q} onClick={() => setAmount(q)} style={{
              flex: 1, padding: "6px 0", borderRadius: 8, background: t.bgSurface,
              border: `1px solid ${t.border}`, color: t.text, fontSize: 12, fontWeight: 700,
              cursor: "pointer", fontFamily: "'JetBrains Mono', monospace",
            }}>{q}</button>
          ))}
        </div>
      </div>

      {/* Slippage */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: "5px 10px", borderRadius: 8,
          background: t.bgSurface, border: `1px solid ${t.border}`,
          fontSize: 11, color: t.textMuted,
        }}>
          <span style={{ color: t.textDim }}>Slippage</span>
          <input
            type="number" min="0.1" max="50" step="0.1"
            value={slippage} onChange={e => setSlippage(Number(e.target.value) || 0)}
            style={{ width: 42, border: "none", background: "transparent", color: t.white, fontFamily: "'JetBrains Mono', monospace" }}
          />
          <span>%</span>
        </div>
        <div style={{ fontSize: 11, color: t.textDim }}>Priority fee: 0.001 NEAR</div>
      </div>

      {/* Estimated out + price freshness indicator */}
      {Number(amount) > 0 && (
        <div style={{
          padding: "8px 10px", borderRadius: 8, background: t.bgSurface,
          fontSize: 12, color: t.textMuted,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        }}>
          <span>
            Est. output: <strong style={{ color: t.white }}>
              {side === "buy" ? `${fmtTokens(est)} $${coin?.ticker || ""}` : `${fmtNear(est)} NEAR`}
            </strong>
          </span>
          {priceNear > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 700,
              padding: "2px 6px", borderRadius: 4,
              color: priceStale ? "#fff" : t.textDim,
              background: priceStale ? `${t.red}` : "transparent",
              border: priceStale ? "none" : `1px solid ${t.bgSurface}`,
            }}>
              {priceStale ? `Stale · ${priceAgeS}s old` : `Price ${priceAgeS}s ago`}
            </span>
          )}
        </div>
      )}

      {/* CTA */}
      <button onClick={handleTrade} disabled={loading || !wallet}
        style={{
          width: "100%", padding: "12px 0", borderRadius: 10, border: "none",
          fontWeight: 800, fontSize: 14, cursor: loading || !wallet ? "not-allowed" : "pointer",
          background: side === "buy" ? t.green : t.red,
          color: "#fff", opacity: loading || !wallet ? 0.6 : 1,
          display: "inline-flex", justifyContent: "center", alignItems: "center", gap: 8,
        }}>
        {loading ? <><Loader2 size={14} className="spin" /> Processing…</>
          : !wallet ? <><Lock size={14} /> Connect Wallet</>
          : side === "buy" ? <><ArrowUpRight size={14} /> Buy ${coin?.ticker || ""}</>
                           : <><ArrowDownRight size={14} /> Sell ${coin?.ticker || ""}</>}
      </button>

      {err     && <div style={{ padding: "8px 10px", borderRadius: 8, background: `${t.red}15`,   color: t.red,   fontSize: 12 }}>{err}</div>}
      {success && <div style={{ padding: "8px 10px", borderRadius: 8, background: `${t.green}15`, color: t.green, fontSize: 12 }}>{success}</div>}

      {/* Position summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 4 }}>
        {[
          { label: "Bought",  value: fmtTokens(coin?.bought || 0) },
          { label: "Sold",    value: fmtTokens(coin?.sold || 0) },
          { label: "Holding", value: fmtTokens(coin?.user_balance || 0) },
          { label: "PnL",     value: `${coin?.pnl_pct != null ? (coin.pnl_pct >= 0 ? "+" : "") + coin.pnl_pct.toFixed(1) : "0.0"}%` },
        ].map((p, i) => (
          <div key={i} style={{ padding: "6px 8px", borderRadius: 8, background: t.bgSurface }}>
            <div style={{ fontSize: 10, color: t.textDim }}>{p.label}</div>
            <div style={{ fontSize: 12, color: t.white, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>{p.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── First Mover card ─────────────────────────────────────────────────
// Shows the coin creator + live 2% First-Mover fee earnings.
function FirstMoverCard({ t, coin }) {
  const [fm, setFm] = useState(null);
  const coinId = coin?.id;
  useEffect(() => {
    if (!coinId) return;
    let cancelled = false;
    fetch(`${API}/api/newscoin/${coinId}/firstmover`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setFm(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [coinId]);

  const wallet = fm?.first_mover?.wallet || coin?.creator_wallet || coin?.creator;
  const display = fm?.first_mover?.display_name || fm?.first_mover?.username || wallet;
  const lifetime = fm?.earnings_near?.lifetime || 0;
  const d24h = fm?.earnings_near?.d24h || 0;

  if (!wallet) return null;
  return (
    <div style={{
      padding: 12, borderRadius: 12, background: `${ORANGE}10`,
      border: `1px solid ${ORANGE}33`,
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6, marginBottom: 8,
        fontSize: 11, color: ORANGE, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5,
      }}>
        <Flame size={12} /> First Mover <span style={{ color: t.textDim, fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>· 2% on every trade</span>
      </div>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
        fontSize: 12, color: t.white, minWidth: 0,
      }}>
        {fm?.first_mover?.pfp_url
          ? <img src={fm.first_mover.pfp_url} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} />
          : <div style={{
              width: 28, height: 28, borderRadius: "50%", background: `${ORANGE}22`,
              display: "grid", placeItems: "center", color: ORANGE, fontWeight: 800, fontSize: 12,
            }}>{(display || "?")[0]?.toUpperCase()}</div>}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, color: t.white, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {display}
          </div>
          <div style={{ fontSize: 10, color: t.textDim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "'JetBrains Mono', monospace" }}>
            {wallet}
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <div style={{ padding: "6px 8px", borderRadius: 8, background: t.bgSurface }}>
          <div style={{ fontSize: 10, color: t.textDim }}>Lifetime</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: t.green, fontFamily: "'JetBrains Mono', monospace" }}>
            {fmtNear(lifetime)} N
          </div>
        </div>
        <div style={{ padding: "6px 8px", borderRadius: 8, background: t.bgSurface }}>
          <div style={{ fontSize: 10, color: t.textDim }}>24h</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: t.white, fontFamily: "'JetBrains Mono', monospace" }}>
            {fmtNear(d24h)} N
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Piecewise bonding curve ──────────────────────────────────────────
// Visualises the 4-segment curve returned by /api/newscoin/:id/curve
// with a highlighted active segment and transition progress bar.
function PiecewiseCurve({ t, coin }) {
  const [curve, setCurve] = useState(null);
  const coinId = coin?.id;
  useEffect(() => {
    if (!coinId) return;
    let cancelled = false;
    fetch(`${API}/api/newscoin/${coinId}/curve`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setCurve(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [coinId]);

  if (!curve?.segments?.length) return null;
  const segs = curve.segments;
  const target = curve.graduation_mcap_usd || 70000;
  const activeIdx = curve.activeSegmentIndex ?? -1;
  const transition = (curve.transition_pct_in_segment || 0);

  return (
    <div style={{
      padding: 12, borderRadius: 12, background: t.bgCard,
      border: `1px solid ${t.border}`,
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 10,
      }}>
        <div style={{ fontSize: 12, color: t.textDim, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
          <TrendingUp size={12} /> Bonding Curve
        </div>
        <div style={{ fontSize: 11, color: t.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>
          {Math.round(curve.bonding_pct || 0)}% → ${target.toLocaleString()}
        </div>
      </div>

      {/* Segment strip */}
      <div style={{ display: "flex", gap: 3, marginBottom: 8 }}>
        {segs.map((s, i) => (
          <div key={i} style={{ flex: s.to_usd - s.from_usd, minWidth: 2 }}>
            <div style={{
              height: 6, borderRadius: 3, position: "relative",
              background: i === activeIdx ? s.color : `${s.color}33`,
              opacity: i < activeIdx ? 0.5 : 1,
            }}>
              {i === activeIdx && (
                <div style={{
                  position: "absolute", top: 0, left: 0, bottom: 0,
                  width: `${transition}%`,
                  background: "#fff", opacity: 0.35, borderRadius: 3,
                }} />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Segment legend */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {segs.map((s, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            fontSize: 11, color: i === activeIdx ? t.white : t.textDim,
            padding: "4px 8px", borderRadius: 6,
            background: i === activeIdx ? `${s.color}14` : "transparent",
            border: i === activeIdx ? `1px solid ${s.color}44` : "1px solid transparent",
          }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color }} />
              <span style={{ fontWeight: i === activeIdx ? 700 : 500 }}>{s.label}</span>
            </span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", color: t.textMuted }}>
              ${Math.round(s.from_usd / 1000)}k–${Math.round(s.to_usd / 1000)}k
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Token Info panel ─────────────────────────────────────────────────
function TokenInfo({ t, coin, score }) {
  const Row = ({ label, value, color }) => (
    <div style={{
      padding: "8px 10px", borderRadius: 10, background: t.bgSurface,
      border: `1px solid ${t.border}`, display: "flex", flexDirection: "column",
    }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: color || t.white, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
      <div style={{ fontSize: 10, color: t.textDim }}>{label}</div>
    </div>
  );
  const holders = coin?.holders_count || 0;
  const dev = coin?.dev_pct    != null ? `${(coin.dev_pct).toFixed(2)}%`     : "0%";
  const top10 = coin?.top10_pct != null ? `${(coin.top10_pct).toFixed(2)}%`   : "—";
  const insiders = coin?.insiders_pct != null ? `${coin.insiders_pct.toFixed(2)}%` : "—";
  const bundlers = coin?.bundlers_pct != null ? `${coin.bundlers_pct.toFixed(2)}%` : "—";
  const snipers  = coin?.snipers_pct  != null ? `${coin.snipers_pct.toFixed(2)}%`  : "—";
  const lpBurned = coin?.graduated ? "100%" : "0%";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
      <Row label="Top 10 H."   value={top10}    color={t.amber} />
      <Row label="Dev H."      value={dev}      color={t.green} />
      <Row label="Snipers H."  value={snipers}  color={t.red} />
      <Row label="Insiders"    value={insiders} color={t.green} />
      <Row label="Bundlers"    value={bundlers} color={t.red} />
      <Row label="LP Burned"   value={lpBurned} color={coin?.graduated ? t.green : t.textDim} />
      <Row label="Holders"     value={holders || "0"} />
      <Row label="Pro Traders" value={coin?.pro_count || 0} />
      <Row label="Dex Paid"    value={coin?.graduated ? "Paid" : "Bonding"} color={coin?.graduated ? t.green : t.amber} />
    </div>
  );
}

// ── Bottom tabs ──────────────────────────────────────────────────────
function BottomTabs({ t, coin, trades, wallet }) {
  const [tab, setTab] = useState("trades");
  const tabs = [
    { key: "trades",     label: "Trades" },
    { key: "positions",  label: "Positions" },
    { key: "orders",     label: "Orders" },
    { key: "holders",    label: `Holders (${coin?.holders_count || 0})` },
    { key: "topTraders", label: "Top Traders" },
    { key: "devTokens",  label: `Dev Tokens (${coin?.dev_coins_count || 0})` },
  ];

  const row = (cells, key) => (
    <div key={key} style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8,
      padding: "8px 12px", borderBottom: `1px solid ${t.border}`, fontSize: 12, color: t.text,
      fontFamily: "'JetBrains Mono', monospace",
    }}>{cells.map((c, i) => <div key={i} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c}</div>)}</div>
  );

  const empty = (msg) => (
    <div style={{ padding: 32, textAlign: "center", color: t.textDim, fontSize: 13 }}>{msg}</div>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 2, borderBottom: `1px solid ${t.border}`, overflowX: "auto" }}>
        {tabs.map(x => (
          <button key={x.key} onClick={() => setTab(x.key)} style={{
            padding: "10px 16px", border: "none", background: "transparent",
            color: tab === x.key ? t.white : t.textMuted,
            borderBottom: `2px solid ${tab === x.key ? ORANGE : "transparent"}`,
            fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
          }}>{x.label}</button>
        ))}
      </div>

      {tab === "trades" && (
        trades?.length
          ? (
            <div>
              {row(["Token", "Bought", "Sold", "PnL", "Time"], "hdr")}
              {trades.slice(0, 40).map((tr, i) => row([
                <span key="a" style={{ color: tr.side === "buy" ? t.green : t.red }}>{shortWallet(tr.wallet || tr.account_id)}</span>,
                tr.side === "buy"  ? `${fmtTokens(tr.amount)} $${coin?.ticker}` : "",
                tr.side === "sell" ? `${fmtTokens(tr.amount)} $${coin?.ticker}` : "",
                `${fmtNear(tr.near_amount)} N`,
                timeAgo(tr.created_at || tr.timestamp),
              ], tr.id || i))}
            </div>
          )
          : empty("No trades yet")
      )}
      {tab === "positions"  && empty(wallet ? "No open position on this coin" : "Connect wallet to see your position")}
      {tab === "orders"     && empty("No open orders — Limit & Adv. orders coming soon")}
      {tab === "holders"    && empty(coin?.holders_count ? "Holder list loading…" : "No holders yet")}
      {tab === "topTraders" && empty("Top traders ranked by PnL — indexer warming up")}
      {tab === "devTokens"  && empty("Other tokens launched by this wallet will appear here")}
    </div>
  );
}

// ── Coin list (left column) ──────────────────────────────────────────
function CoinList({ t, coins, activeId, onSelect }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return coins;
    return coins.filter(c => [c.name, c.ticker, c.id].some(x => String(x || "").toLowerCase().includes(qq)));
  }, [q, coins]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "10px 10px 8px", borderBottom: `1px solid ${t.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
          background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 10 }}>
          <Search size={14} color={t.textMuted} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search coins"
            style={{ flex: 1, border: "none", background: "transparent", color: t.white, fontSize: 13, outline: "none" }} />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {filtered.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: t.textDim, fontSize: 12 }}>
            No coins yet — launch one from an IronFeed post.
          </div>
        )}
        {filtered.map(c => {
          const mcap = Number(c.mcap_usd || 0);
          const bondingPct = Math.min(100, (mcap / (c.hardcap_usd || 70000)) * 100);
          const lc = lifecycleFor({ bondingPct, graduated: !!c.graduated, killed: !!c.killed });
          const active = activeId && (c.id === activeId || c.coinAddress === activeId);
          return (
            <button key={c.id || c.coinAddress} onClick={() => onSelect(c)} style={{
              width: "100%", textAlign: "left", padding: "10px 12px",
              border: "none", borderBottom: `1px solid ${t.border}`,
              background: active ? `${ORANGE}14` : "transparent",
              cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%",
                background: `${ORANGE}22`, color: ORANGE,
                display: "grid", placeItems: "center", fontSize: 12, fontWeight: 800,
              }}>{(c.ticker || "?")[0]}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: t.white, fontSize: 13, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    ${c.ticker}
                  </span>
                  <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: `${lc.color}22`, color: lc.color, fontWeight: 800 }}>
                    {lc.label}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: t.textDim, display: "flex", gap: 8, marginTop: 2 }}>
                  <span>{fmtUsd(mcap)}</span>
                  <span>•</span>
                  <span>{bondingPct.toFixed(0)}%</span>
                </div>
              </div>
              <div style={{ fontSize: 11, color: t.textMuted, fontFamily: "'JetBrains Mono', monospace" }}>
                {fmtNear(c.price_near)}N
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Terminal ────────────────────────────────────────────────────
export default function NewsCoinTerminal({ coins, initialCoinId, score, onBack }) {
  const t = useTheme();
  const { address: wallet, selector } = useWallet();

  const [active, setActive] = useState(() =>
    coins.find(c => c.id === initialCoinId || c.coinAddress === initialCoinId) || coins[0] || null
  );
  const [trades, setTrades] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);

  // Fetch trades for the active coin.
  useEffect(() => {
    if (!active?.id) { setTrades([]); return; }
    let cancelled = false;
    api(`/api/newscoin/${active.id}/trades`).then(d => {
      if (cancelled) return;
      setTrades(Array.isArray(d?.trades) ? d.trades : Array.isArray(d) ? d : []);
    });
    return () => { cancelled = true; };
  }, [active?.id, refreshKey]);

  // Day 10: fetch real OHLCV from /candles. Falls back to the seeded
  // mock when the API returns empty (brand-new coin, no trades yet)
  // so the chart never goes blank.
  const [liveCandles, setLiveCandles] = useState(null);
  useEffect(() => {
    if (!active?.id) { setLiveCandles(null); return; }
    let cancelled = false;
    api(`/api/newscoin/${active.id}/candles?interval=1m&count=120`).then((d) => {
      if (cancelled) return;
      setLiveCandles(Array.isArray(d?.candles) ? d.candles : []);
    });
    return () => { cancelled = true; };
  }, [active?.id, refreshKey]);

  const candles = useMemo(() => {
    if (!active) return [];
    if (liveCandles && liveCandles.length > 0) return liveCandles;
    const base = Number(active.price_near || 0) || 0.00001;
    return mockCandles(active.ticker || "X", base);
  }, [active?.ticker, active?.price_near, liveCandles]);

  if (!active) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: t.textDim }}>
        No coins to trade yet. Launch one from IronFeed.
      </div>
    );
  }

  const mcap = Number(active.mcap_usd || 0);
  const hardcap = Number(active.hardcap_usd || 70000);
  const bondingPct = Math.min(100, (mcap / hardcap) * 100);
  const lc = lifecycleFor({ bondingPct, graduated: !!active.graduated, killed: !!active.killed });

  const copy = (s) => { try { navigator.clipboard.writeText(s); } catch {} };
  const last = Number(candles[candles.length - 1]?.close || active.price_near || 0);
  const first = Number(candles[0]?.open || last);
  const change = first > 0 ? ((last - first) / first) * 100 : 0;

  // 5m stats from trades (best-effort, falls back to 0s if empty).
  const fiveMin = (() => {
    const now = Date.now();
    const recent = trades.filter(x => new Date(x.created_at || x.timestamp).getTime() > now - 5 * 60 * 1000);
    const buys  = recent.filter(x => x.side === "buy");
    const sells = recent.filter(x => x.side === "sell");
    const sum = (arr) => arr.reduce((a, x) => a + Number(x.near_amount || 0), 0);
    return { vol: sum(recent), buys: { c: buys.length, v: sum(buys) }, sells: { c: sells.length, v: sum(sells) } };
  })();

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "260px 1fr 320px",
      gridTemplateRows: "1fr",
      height: "calc(100vh - 60px)",
      gap: 0, background: t.bg,
    }} className="ix-terminal">

      {/* Left: coin list */}
      <aside style={{
        borderRight: `1px solid ${t.border}`, background: t.bgCard,
        display: "flex", flexDirection: "column", minHeight: 0,
      }} className="ix-term-left">
        {onBack && (
          <button onClick={onBack} style={{
            padding: "10px 12px", textAlign: "left", color: t.textMuted,
            background: "transparent", border: "none", borderBottom: `1px solid ${t.border}`,
            cursor: "pointer", fontSize: 12,
          }}>← Back to list</button>
        )}
        <CoinList t={t} coins={coins} activeId={active.id || active.coinAddress} onSelect={setActive} />
      </aside>

      {/* Center: header + chart + tabs */}
      <section style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* Header bar */}
        <div style={{
          padding: "10px 14px", borderBottom: `1px solid ${t.border}`,
          display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
          background: t.bgCard,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: "50%",
            background: `${ORANGE}22`, color: ORANGE,
            display: "grid", placeItems: "center", fontSize: 14, fontWeight: 800,
          }}>{(active.ticker || "?")[0]}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: t.white, fontSize: 15, fontWeight: 800 }}>{active.name || active.ticker}</span>
              <span style={{ color: ORANGE, fontSize: 13, fontWeight: 700 }}>${active.ticker}</span>
              <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4,
                background: `${lc.color}22`, color: lc.color, fontWeight: 800 }}>{lc.label}</span>
            </div>
            <div style={{ fontSize: 11, color: t.textDim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 380 }}>
              {active.headline || active.name}
            </div>
          </div>

          {/* Stat cells */}
          <div style={{ marginLeft: "auto", display: "flex", gap: 14, flexWrap: "wrap" }}>
            {[
              { l: "Price",     v: `$${(Number(active.price_near || 0) * 5).toFixed(4)}`, c: change >= 0 ? t.green : t.red },
              { l: "Liquidity", v: fmtUsd(active.liquidity_usd ?? mcap * 0.2) },
              { l: "Supply",    v: fmtTokens(active.total_supply || 1_000_000_000) },
              { l: "Fees Paid", v: fmtUsd(active.fees_paid_usd || 0) },
              { l: "B.Curve",   v: `${bondingPct.toFixed(2)}%`, c: ORANGE },
            ].map((s, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", minWidth: 70 }}>
                <span style={{ fontSize: 10, color: t.textDim }}>{s.l}</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: s.c || t.white, fontFamily: "'JetBrains Mono', monospace" }}>{s.v}</span>
              </div>
            ))}
            {typeof score === "number" && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px",
                borderRadius: 999, background: `${ORANGE}14`, border: `1px solid ${ORANGE}44`, color: ORANGE, fontWeight: 800 }}>
                <Flame size={12} /> {score.toFixed(1)}
              </div>
            )}
            <button title="Alert" style={{
              display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px",
              borderRadius: 999, background: t.bgSurface, border: `1px solid ${t.border}`,
              color: t.textMuted, cursor: "pointer", fontSize: 12,
            }}><Bell size={12} /> Alert</button>
          </div>
        </div>

        {/* Chart area */}
        <div style={{ flex: 1, minHeight: 240, position: "relative", background: t.bg }}>
          <CandleChart candles={candles} />
        </div>

        {/* Bottom tabs */}
        <div style={{ borderTop: `1px solid ${t.border}`, background: t.bgCard }}>
          <BottomTabs t={t} coin={active} trades={trades} wallet={wallet} />
        </div>
      </section>

      {/* Right: order panel */}
      <aside style={{
        borderLeft: `1px solid ${t.border}`, background: t.bgCard,
        padding: 14, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto",
      }} className="ix-term-right">
        {/* 5m strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {[
            { l: "5m Vol", v: `${fmtNear(fiveMin.vol)}N` },
            { l: "Buys",   v: `${fiveMin.buys.c} / ${fmtNear(fiveMin.buys.v)}N`, c: t.green },
            { l: "Sells",  v: `${fiveMin.sells.c} / ${fmtNear(fiveMin.sells.v)}N`, c: t.red },
            { l: "Net Vol", v: `${fmtNear(fiveMin.buys.v - fiveMin.sells.v)}N`, c: (fiveMin.buys.v - fiveMin.sells.v) >= 0 ? t.green : t.red },
          ].map((s, i) => (
            <div key={i} style={{ padding: "6px 8px", borderRadius: 8, background: t.bgSurface, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: t.textDim }}>{s.l}</div>
              <div style={{ fontSize: 11, color: s.c || t.white, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.v}</div>
            </div>
          ))}
        </div>

        <OrderPanel t={t} coin={active} wallet={wallet} selector={selector}
          onTraded={() => setRefreshKey(k => k + 1)} />

        {/* Presets strip (static for MVP — saves coming in follow-up) */}
        <div style={{ display: "flex", gap: 6 }}>
          {[1, 2, 3].map(n => (
            <button key={n} style={{
              flex: 1, padding: "6px 0", borderRadius: 8,
              background: t.bgSurface, border: `1px solid ${t.border}`,
              color: t.textMuted, fontSize: 11, fontWeight: 700, cursor: "pointer",
            }}>PRESET {n}</button>
          ))}
        </div>

        {/* First Mover card — the creator earns 2% of every trade forever */}
        <FirstMoverCard t={t} coin={active} />

        {/* Piecewise bonding curve */}
        <PiecewiseCurve t={t} coin={active} />

        {/* Token Info */}
        <div>
          <div style={{ fontSize: 12, color: t.textDim, fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
            <BarChart3 size={12} /> Token Info
          </div>
          <TokenInfo t={t} coin={active} score={score} />
        </div>

        {/* Addresses */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[
            { label: "CA", value: active.coinAddress || active.curve_contract || active.id },
            { label: "DA", value: active.creator_wallet || active.creator || "—" },
          ].map(row => (
            <div key={row.label} style={{
              display: "flex", alignItems: "center", gap: 6, padding: "6px 10px",
              borderRadius: 8, background: t.bgSurface, border: `1px solid ${t.border}`,
              fontSize: 11, color: t.textMuted, fontFamily: "'JetBrains Mono', monospace",
            }}>
              <span style={{ color: t.textDim }}>{row.label}:</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.value}</span>
              {row.value && row.value !== "—" && (
                <>
                  <button onClick={() => copy(row.value)} title="Copy"
                    style={{ background: "transparent", border: "none", color: t.textDim, cursor: "pointer" }}><Copy size={11} /></button>
                  <a href={`https://nearblocks.io/address/${row.value}`} target="_blank" rel="noopener noreferrer"
                    style={{ color: t.textDim, display: "inline-flex" }}><ExternalLink size={11} /></a>
                </>
              )}
            </div>
          ))}
        </div>
      </aside>

      {/* Responsive overrides: stack on narrow viewports; order panel becomes
          a bottom drawer pulled up by a small tab. */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
        @media (max-width: 900px) {
          .ix-terminal { grid-template-columns: 1fr !important; height: auto !important; }
          .ix-term-left  { max-height: 44vh; border-right: none; border-bottom: 1px solid; border-color: inherit; }
          .ix-term-right { max-height: 60vh; border-left: none; border-top: 1px solid; border-color: inherit; }
        }
      `}</style>
    </div>
  );
}
