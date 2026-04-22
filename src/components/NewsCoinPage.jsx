"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  TrendingUp, Clock, Award, Timer, Briefcase, X, ArrowUpRight, ArrowDownRight,
  Coins, Sparkles, AlertTriangle, Loader2, ChevronDown, ExternalLink,
  BarChart3, Wallet, Lock, Info, Flame, GraduationCap, RefreshCw,
} from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import { Btn, Badge } from "@/components/Primitives";
import { functionCallAction, sendTx, extractTxHash } from "@/lib/walletActions";
import NewsCoinTerminal from "@/components/NewsCoinTerminal";
import { lifecycleFor } from "@/lib/newscoinLifecycle";

const API = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const FACTORY = "newscoin-factory.ironshield.near";
const ORANGE = "#f97316";

// ── Helpers ────────────────────────────────────────────────────────────

function api(path, { method = "GET", body, wallet } = {}) {
  const headers = { "content-type": "application/json" };
  if (wallet) headers["x-wallet"] = wallet;
  return fetch(`${API}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  }).then(async r => {
    const text = await r.text();
    // If the backend returns HTML (e.g. SPA fallback because NEXT_PUBLIC_BACKEND_URL
    // isn't configured in prod), don't crash the UI with "Unexpected token '<'".
    const looksHtml = text.trimStart().startsWith("<");
    if (looksHtml) {
      const err = new Error(`Backend unreachable (HTTP ${r.status}). Set NEXT_PUBLIC_BACKEND_URL.`);
      err.backendDown = true;
      throw err;
    }
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data;
  });
}

function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function shortWallet(w = "") {
  return w.length > 18 ? `${w.slice(0, 8)}...${w.slice(-6)}` : w;
}

function fmtNear(v) {
  const n = Number(v);
  if (isNaN(n)) return "0";
  return n < 0.01 ? n.toFixed(6) : n < 1 ? n.toFixed(4) : n < 1000 ? n.toFixed(2) : `${(n / 1000).toFixed(1)}k`;
}

function fmtUsd(v) {
  const n = Number(v);
  if (isNaN(n)) return "$0";
  if (n < 1) return `$${n.toFixed(4)}`;
  if (n < 1000) return `$${n.toFixed(2)}`;
  if (n < 1_000_000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${(n / 1_000_000).toFixed(2)}M`;
}

function fmtPct(v) {
  const n = Number(v);
  if (isNaN(n)) return "0%";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function fmtTokens(v) {
  const n = Number(v);
  if (isNaN(n) || n === 0) return "0";
  if (n < 1) return n.toFixed(4);
  if (n < 10000) return n.toFixed(2);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

// ── Sparkline ──────────────────────────────────────────────────────────

function Sparkline({ data = [], width = 50, height = 20, color = ORANGE }) {
  if (!data.length) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((v, i) =>
    `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * height}`
  ).join(" ");
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

// ── Shared styles ──────────────────────────────────────────────────────

function cardStyle(t) {
  return {
    background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
    transition: "all 0.25s",
  };
}

function overlayStyle() {
  return {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
    display: "flex", alignItems: "flex-end", justifyContent: "center",
    zIndex: 1000, backdropFilter: "blur(6px)",
  };
}

function sheetStyle(t) {
  return {
    background: t.bgCard, border: `1px solid ${t.border}`,
    borderRadius: "20px 20px 0 0", padding: "24px 20px 32px",
    width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto",
    boxShadow: "0 -8px 40px rgba(0,0,0,0.5)",
    animation: "slideUp 0.25s ease-out",
  };
}

function inputStyle(t) {
  return {
    width: "100%", padding: "10px 14px", background: t.bgSurface,
    border: `1px solid ${t.border}`, color: t.text, borderRadius: 10,
    outline: "none", fontSize: 14, boxSizing: "border-box",
  };
}

// ── CoinBadge (inline for PostCard) ────────────────────────────────────

export function CoinBadge({ coins }) {
  const t = useTheme();
  if (!coins || !coins.length) return null;
  const primary = coins[0];
  const change = Number(primary.change_24h || 0);
  const isUp = change >= 0;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "3px 8px", borderRadius: 8,
      background: `${ORANGE}12`, border: `1px solid ${ORANGE}44`,
      fontSize: 11, fontWeight: 700, color: ORANGE, cursor: "pointer",
    }}>
      <Coins size={11} />
      <span style={{ textTransform: "uppercase" }}>${primary.ticker}</span>
      <span style={{
        fontSize: 10, color: isUp ? t.green : t.red,
        display: "inline-flex", alignItems: "center", gap: 1,
      }}>
        {isUp ? <ArrowUpRight size={9} /> : <ArrowDownRight size={9} />}
        {fmtPct(change)}
      </span>
      <Sparkline data={primary.sparkline || []} width={32} height={12} />
      {coins.length > 1 && (
        <span style={{ fontSize: 9, color: t.textDim, marginLeft: 2 }}>
          +{coins.length - 1}
        </span>
      )}
    </div>
  );
}

// ── CoinModal (slide-up trading sheet) ─────────────────────────────────

export function CoinModal({ coin: initialCoin, post, wallet, selector, onClose }) {
  const t = useTheme();
  const [tab, setTab] = useState("buy");
  const [coin, setCoin] = useState(initialCoin);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [success, setSuccess] = useState("");
  const [trades, setTrades] = useState([]);
  const [tradesLoading, setTradesLoading] = useState(true);
  // Multi-coin support: post might have multiple coins
  const siblings = post?.coins || [initialCoin];
  const [activeCoinIdx, setActiveCoinIdx] = useState(
    Math.max(0, siblings.findIndex(c => c.id === initialCoin.id))
  );

  useEffect(() => {
    setCoin(siblings[activeCoinIdx] || initialCoin);
  }, [activeCoinIdx]);

  // Fetch trades
  useEffect(() => {
    if (!coin?.id) return;
    setTradesLoading(true);
    api(`/api/newscoin/${coin.id}/trades`)
      .then(d => setTrades(Array.isArray(d?.trades) ? d.trades : Array.isArray(d) ? d : []))
      .catch(() => setTrades([]))
      .finally(() => setTradesLoading(false));
  }, [coin?.id]);

  // Pull live on-chain price + mcap so the estimate works even when the
  // backend indexer is behind (or down). Runs whenever the active coin changes.
  useEffect(() => {
    const addr = coin?.coinAddress || coin?.curve_contract || coin?.id;
    if (!addr || !String(addr).includes(".")) return;
    let cancelled = false;
    (async () => {
      try {
        const { getCoinInfo } = await import("@/lib/newscoin");
        const info = await getCoinInfo(addr);
        if (cancelled || !info) return;
        // info.price is yoctoNEAR per 1e18-base-units token
        // → NEAR per whole token = price / 1e24 * 1e18 = price / 1e6 ... wait
        // price is yocto per token-base-unit. For 1 whole token (=1e18 units):
        //   near_per_whole = price * 1e18 / 1e24 = price / 1e6
        const priceYocto = String(info.price || "0");
        const priceNear = Number(priceYocto) / 1e6 / 1e18;
        const mcapUsd = Number(info.mcap_usd || 0);
        setCoin(prev => ({
          ...prev,
          price_near: priceNear > 0 ? priceNear : (prev?.price_near || 0),
          mcap_usd: mcapUsd || (prev?.mcap_usd || 0),
          total_supply: info.total_supply,
          graduated: !!info.graduated,
          killed: !!info.killed,
        }));
      } catch (_) { /* backend or chain unreachable; leave as-is */ }
    })();
    return () => { cancelled = true; };
  }, [coin?.coinAddress, coin?.curve_contract, coin?.id]);

  const mcap = Number(coin?.mcap_usd || 0);
  const bondingTarget = 70000;
  const bondingPct = Math.min(100, (mcap / bondingTarget) * 100);
  const graduated = mcap >= bondingTarget;

  const estimatedOutput = (() => {
    const amt = Number(amount);
    if (!amt) return 0;
    const pn = Number(coin?.price_near || 0);
    if (!pn) return 0;
    if (tab === "buy") return amt / pn;
    return amt * pn;
  })();

  const handleTrade = async () => {
    if (!wallet || !selector) { setErr("Connect your wallet first"); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { setErr("Enter a valid amount"); return; }
    setErr(""); setSuccess(""); setLoading(true);
    try {
      const w = await selector.wallet();
      // The coin itself IS the curve contract. Address comes from one of:
      //   coin.coinAddress (on-chain fetch)  |  coin.curve_contract (backend)  |  coin.id (backend slug)
      const coinAddress = coin.coinAddress || coin.curve_contract || coin.id;
      if (!coinAddress || !String(coinAddress).includes(".")) {
        throw new Error("Coin address not found — refresh the page");
      }
      let action;
      if (tab === "buy") {
        // Convert NEAR to yoctoNEAR
        const [whole, frac = ""] = String(amt).split(".");
        const padded = (frac + "0".repeat(24)).slice(0, 24);
        const yocto = (BigInt(whole || "0") * 1_000_000_000_000_000_000_000_000n + BigInt(padded || "0")).toString();
        action = functionCallAction({
          methodName: "buy",
          args: {},
          gas: "100000000000000",
          deposit: yocto,
        });
        await sendTx(w, wallet, coinAddress, [action]);
      } else {
        // Sell: amount is token count (18 decimals)
        const [whole, frac = ""] = String(amt).split(".");
        const padded = (frac + "0".repeat(18)).slice(0, 18);
        const tokenAmount = (BigInt(whole || "0") * 1_000_000_000_000_000_000n + BigInt(padded || "0")).toString();
        action = functionCallAction({
          methodName: "sell",
          args: { amount: tokenAmount },
          gas: "100000000000000",
          deposit: "1",
        });
        await sendTx(w, wallet, coinAddress, [action]);
      }
      setSuccess(`${tab === "buy" ? "Bought" : "Sold"} successfully!`);
      setAmount("");
      // Refresh coin + user balance. Try backend first (richer data),
      // fall back to the chain so allocation updates even when backend is offline.
      try {
        const updated = await api(`/api/newscoin/${coin.id}`);
        if (updated) setCoin(prev => ({ ...prev, ...updated }));
      } catch {}
      try {
        const { getCoinBalance, getCurveState } = await import("@/lib/newscoin");
        const [balU128, curve] = await Promise.all([
          getCoinBalance(coinAddress, wallet).catch(() => null),
          getCurveState(coinAddress).catch(() => null),
        ]);
        setCoin(prev => ({
          ...prev,
          coinAddress,
          user_balance: balU128 ? Number(BigInt(balU128) / 1_000_000_000_000n) / 1e6 : prev?.user_balance,
          total_supply: curve?.total_supply ? Number(BigInt(curve.total_supply) / 1_000_000_000_000n) / 1e6 : prev?.total_supply,
        }));
      } catch {}
    } catch (e) {
      const msg = e?.message || String(e);
      if (/reject|cancel|denied|user closed/i.test(msg)) setErr("Transaction cancelled");
      else setErr(msg.slice(0, 120));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={overlayStyle()} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={sheetStyle(t)} onClick={e => e.stopPropagation()}>
        {/* Drag handle */}
        <div style={{ width: 40, height: 4, borderRadius: 2, background: t.border, margin: "0 auto 16px" }} />

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.5, marginBottom: 4 }}>
              {post?.content?.slice(0, 100)}{post?.content?.length > 100 ? "..." : ""}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: t.white }}>{coin?.name || "NewsCoin"}</div>
            <div style={{ fontSize: 13, color: ORANGE, fontWeight: 700 }}>${coin?.ticker || "???"}</div>
          </div>
          <button onClick={onClose} style={{
            background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8,
            width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: t.textMuted, flexShrink: 0,
          }}>
            <X size={16} />
          </button>
        </div>

        {/* Multi-coin tabs */}
        {siblings.length > 1 && (
          <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto" }}>
            {siblings.map((s, i) => (
              <button key={s.id} onClick={() => setActiveCoinIdx(i)} style={{
                padding: "4px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                background: i === activeCoinIdx ? `${ORANGE}20` : t.bgSurface,
                color: i === activeCoinIdx ? ORANGE : t.textMuted,
                border: `1px solid ${i === activeCoinIdx ? ORANGE + "66" : t.border}`,
                cursor: "pointer", whiteSpace: "nowrap",
              }}>
                ${s.ticker}
              </button>
            ))}
          </div>
        )}

        {/* Stats row */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16,
        }}>
          {[
            { label: "Price", value: `${fmtNear(coin?.price_near)} N`, color: t.white },
            { label: "MCap", value: fmtUsd(mcap), color: t.white },
            {
              label: "24h",
              value: fmtPct(coin?.change_24h || 0),
              color: Number(coin?.change_24h || 0) >= 0 ? t.green : t.red,
            },
          ].map(s => (
            <div key={s.label} style={{ background: t.bgSurface, borderRadius: 10, padding: "10px 12px", textAlign: "center" }}>
              <div style={{ fontSize: 11, color: t.textDim, marginBottom: 2 }}>{s.label}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: s.color, fontFamily: "'JetBrains Mono', monospace" }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Bonding progress */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: t.textMuted }}>Bonding Progress</span>
            {graduated
              ? <Badge color="#10b981" style={{ fontSize: 10 }}>Graduated to Rhea Finance</Badge>
              : <span style={{ fontSize: 12, color: ORANGE, fontWeight: 700 }}>{bondingPct.toFixed(1)}%</span>
            }
          </div>
          <div style={{
            height: 8, borderRadius: 4, background: t.bgSurface, overflow: "hidden",
          }}>
            <div style={{
              height: "100%", borderRadius: 4, transition: "width 0.5s ease",
              width: `${bondingPct}%`,
              background: graduated
                ? `linear-gradient(90deg, #10b981, #34d399)`
                : `linear-gradient(90deg, ${ORANGE}, #fb923c)`,
            }} />
          </div>
          <div style={{ fontSize: 10, color: t.textDim, marginTop: 4, textAlign: "right" }}>
            {fmtUsd(mcap)} / $70,000
          </div>
        </div>

        {/* Buy / Sell tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 12, background: t.bgSurface, borderRadius: 10, padding: 3 }}>
          {["buy", "sell"].map(v => (
            <button key={v} onClick={() => { setTab(v); setAmount(""); setErr(""); setSuccess(""); }} style={{
              flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 13, fontWeight: 700,
              textTransform: "uppercase", cursor: "pointer", border: "none",
              background: tab === v ? (v === "buy" ? t.green : t.red) : "transparent",
              color: tab === v ? "#fff" : t.textMuted,
              transition: "all 0.2s",
            }}>
              {v}
            </button>
          ))}
        </div>

        {/* Input */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: t.textDim, marginBottom: 4 }}>
            {tab === "buy" ? "Amount (NEAR)" : "Amount (tokens)"}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="number" min="0" step="any" placeholder="0.00"
              value={amount} onChange={e => { setAmount(e.target.value); setErr(""); setSuccess(""); }}
              style={inputStyle(t)}
            />
            {tab === "sell" && (
              <button onClick={() => setAmount(String(coin?.user_balance || 0))} style={{
                padding: "10px 12px", borderRadius: 10, fontSize: 12, fontWeight: 700,
                background: `${ORANGE}18`, color: ORANGE, border: `1px solid ${ORANGE}44`,
                cursor: "pointer", whiteSpace: "nowrap",
              }}>
                MAX
              </button>
            )}
          </div>
        </div>

        {/* Estimated output */}
        {Number(amount) > 0 && (
          <div style={{
            padding: "8px 12px", borderRadius: 8, background: t.bgSurface,
            fontSize: 12, color: t.textMuted, marginBottom: 8,
          }}>
            Estimated: <strong style={{ color: t.white }}>
              {tab === "buy" ? `${fmtTokens(estimatedOutput)} $${coin?.ticker}` : `${fmtNear(estimatedOutput)} NEAR`}
            </strong>
          </div>
        )}

        {/* Fee breakdown */}
        <div style={{
          fontSize: 11, color: t.textDim, marginBottom: 12,
          display: "flex", alignItems: "center", gap: 4,
        }}>
          <Info size={11} /> 1% protocol fee + 0.5% creator fee
        </div>

        {/* Trade button */}
        <Btn primary onClick={handleTrade} disabled={loading || !wallet} style={{ width: "100%", justifyContent: "center" }}>
          {loading ? <><Loader2 size={14} className="spin" /> Processing...</>
            : !wallet ? <><Lock size={14} /> Connect Wallet</>
            : tab === "buy" ? <><ArrowUpRight size={14} /> Buy ${coin?.ticker}</>
            : <><ArrowDownRight size={14} /> Sell ${coin?.ticker}</>
          }
        </Btn>

        {err && (
          <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: `${t.red}15`, color: t.red, fontSize: 12 }}>
            {err}
          </div>
        )}
        {success && (
          <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: `${t.green}15`, color: t.green, fontSize: 12 }}>
            {success}
          </div>
        )}

        {/* Trade history */}
        <div style={{ marginTop: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.white, marginBottom: 8 }}>Recent Trades</div>
          {tradesLoading ? (
            <div style={{ textAlign: "center", padding: 16, color: t.textDim }}>
              <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
            </div>
          ) : trades.length === 0 ? (
            <div style={{ textAlign: "center", padding: 16, color: t.textDim, fontSize: 12 }}>No trades yet</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {trades.slice(0, 10).map((tr, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "6px 10px", borderRadius: 8, background: t.bgSurface, fontSize: 12,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: tr.side === "buy" ? t.green : t.red,
                    }} />
                    <span style={{ color: t.textMuted }}>{shortWallet(tr.wallet || tr.account_id || "")}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: tr.side === "buy" ? t.green : t.red, fontWeight: 600 }}>
                      {tr.side === "buy" ? "+" : "-"}{fmtTokens(tr.amount)}
                    </span>
                    <span style={{ color: t.textDim }}>{fmtNear(tr.near_amount)} N</span>
                    <span style={{ color: t.textDim }}>{timeAgo(tr.created_at || tr.timestamp)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Slide-up animation keyframes */}
      <style>{`
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}

// ── MintModal ──────────────────────────────────────────────────────────

export function MintModal({ post, wallet, selector, onClose, onMinted }) {
  const t = useTheme();
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  // Creator-configurable tokenomics. Blank = use contract default.
  const [maxSupply, setMaxSupply] = useState("");        // tokens, whole units (e.g. 1_000_000_000)
  const [hardcapUsd, setHardcapUsd] = useState("");      // USD mcap that triggers bonding
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [suggesting, setSuggesting] = useState(true);
  const [minting, setMinting] = useState(false);
  const [err, setErr] = useState("");
  // IronClaw Virality Score (0–10). null while loading.
  const [score, setScore] = useState(null);
  // Low-signal (score < 4) requires explicit user confirmation before launch.
  const [lowSignalAck, setLowSignalAck] = useState(false);

  // Fetch IronClaw suggestion on open
  useEffect(() => {
    if (!post?.content) { setSuggesting(false); return; }
    setSuggesting(true);
    api("/api/newscoin/suggest", { method: "POST", body: { headline: post.content } })
      .then(d => {
        if (d?.name) setName(d.name);
        if (d?.ticker) setTicker(d.ticker.toUpperCase());
        if (typeof d?.score === "number") setScore(d.score);
      })
      .catch(() => {})
      .finally(() => setSuggesting(false));
  }, [post?.content]);

  // Score tier: drives badge colour + label ("High tokenization potential", etc).
  const scoreTier = (() => {
    if (score == null) return null;
    if (score >= 7) return { color: t.green,  label: "High tokenization potential" };
    if (score >= 4) return { color: t.amber,  label: "Moderate signal" };
    return                 { color: t.red,    label: "Low signal — IronClaw flagged this story" };
  })();
  const isLowSignal = score != null && score < 4;

  const handleMint = async () => {
    if (!wallet || !selector) { setErr("Connect your wallet first"); return; }
    if (!name.trim()) { setErr("Name is required"); return; }
    if (!ticker.trim()) { setErr("Ticker is required"); return; }
    if (ticker.length > 10) { setErr("Ticker too long (max 10 chars)"); return; }
    setErr(""); setMinting(true);
    try {
      const w = await selector.wallet();
      // Check fee waiver on-chain
      let deposit = "2000000000000000000000000"; // 2 NEAR default
      try {
        const acct = await (await import("@/lib/contexts")).getReadAccount();
        const waived = await acct.viewFunction({
          contractId: FACTORY,
          methodName: "is_fee_waived",
          args: { account_id: wallet },
        });
        if (waived) deposit = "0";
      } catch (_) { /* fallback to paid */ }
      // Build optional tokenomics args. Numbers are validated before send.
      let graduation_mcap_usd = null;
      let max_supply_u128 = null;
      if (hardcapUsd) {
        const n = Math.floor(Number(hardcapUsd));
        if (!Number.isFinite(n) || n < 1000 || n > 10_000_000) {
          throw new Error("Hardcap must be between $1,000 and $10,000,000");
        }
        graduation_mcap_usd = String(n);
      }
      if (maxSupply) {
        const n = Math.floor(Number(maxSupply));
        if (!Number.isFinite(n) || n < 1000 || n > 1_000_000_000_000) {
          throw new Error("Max supply must be between 1,000 and 1,000,000,000,000");
        }
        max_supply_u128 = String(n);
      }
      const action = functionCallAction({
        methodName: "create_coin",
        args: {
          story_id: String(post?.id || post?.story_id || Date.now()),
          name: name.trim(),
          ticker: ticker.trim().toUpperCase(),
          headline: (post?.content || "").slice(0, 280),
          graduation_mcap_usd, // null = default
          max_supply: max_supply_u128, // null = uncapped
        },
        deposit,
        gas: "300000000000000",
      });
      const result = await sendTx(w, wallet, FACTORY, [action]);
      const txHash = extractTxHash(result);

      // A NEAR tx can report top-level success while a downstream receipt
      // (sub-account creation, WASM deploy, registry call) panics. Walk
      // the receipts_outcome array and surface the first Failure so the
      // user doesn't think the mint succeeded when it silently didn't.
      const receipts = Array.isArray(result?.receipts_outcome) ? result.receipts_outcome : [];
      for (const r of receipts) {
        const status = r?.outcome?.status;
        if (status && typeof status === "object" && "Failure" in status) {
          const f = status.Failure;
          const msg = f?.ActionError?.kind
            ? (typeof f.ActionError.kind === "string"
                ? f.ActionError.kind
                : JSON.stringify(f.ActionError.kind))
            : (f?.error_message || JSON.stringify(f).slice(0, 200));
          throw new Error(`Mint failed on-chain: ${String(msg).slice(0, 180)}`);
        }
      }
      // Optimistically cache in DB so it appears in the feed/list immediately.
      // Contract address is derived as coin{N}.{factory}; the indexer will
      // reconcile exact indexing later.
      try {
        await api("/api/newscoin/register", {
          method: "POST", wallet,
          body: {
            storyId: String(post?.id || post?.story_id || ""),
            contractAddress: txHash ? `tx:${txHash}` : `pending:${Date.now()}`,
            name: name.trim(),
            ticker: ticker.trim().toUpperCase(),
            headline: (post?.content || "").slice(0, 280),
            txHash,
          },
        });
      } catch (registerErr) {
        console.warn("[NewsCoin] register failed:", registerErr.message);
      }
      onMinted?.({ name, ticker, txHash });
      onClose();
    } catch (e) {
      const msg = e?.message || String(e);
      if (/reject|cancel|denied|user closed/i.test(msg)) setErr("Transaction cancelled");
      else setErr(msg.slice(0, 120));
    } finally {
      setMinting(false);
    }
  };

  return (
    <div style={overlayStyle()} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={sheetStyle(t)} onClick={e => e.stopPropagation()}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: t.border, margin: "0 auto 16px" }} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: t.white, display: "flex", alignItems: "center", gap: 8 }}>
              <Coins size={20} color={ORANGE} /> Coin This Story
            </div>
            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>Create a tradeable token for this post</div>
          </div>
          <button onClick={onClose} style={{
            background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8,
            width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", color: t.textMuted,
          }}>
            <X size={16} />
          </button>
        </div>

        {/* Story preview */}
        <div style={{
          padding: "10px 14px", borderRadius: 10, background: t.bgSurface,
          marginBottom: 16, fontSize: 13, color: t.textMuted, lineHeight: 1.5,
          borderLeft: `3px solid ${ORANGE}`,
        }}>
          {post?.content?.slice(0, 200)}{post?.content?.length > 200 ? "..." : ""}
        </div>

        {suggesting ? (
          <div style={{ textAlign: "center", padding: 24, color: t.textDim }}>
            <Loader2 size={20} style={{ animation: "spin 1s linear infinite", marginBottom: 8 }} />
            <div style={{ fontSize: 13 }}>IronClaw is suggesting a name...</div>
          </div>
        ) : (
          <>
            {/* IronClaw Virality Score */}
            {scoreTier && (
              <div style={{
                padding: "10px 14px", borderRadius: 10, marginBottom: 12,
                background: `${scoreTier.color}12`, border: `1px solid ${scoreTier.color}44`,
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 800,
                  color: scoreTier.color, minWidth: 52, textAlign: "center",
                }}>{score.toFixed(1)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: t.textDim, marginBottom: 2 }}>
                    IronClaw rates this story
                  </div>
                  <div style={{ fontSize: 12.5, color: scoreTier.color, fontWeight: 700 }}>
                    {scoreTier.label}
                  </div>
                </div>
              </div>
            )}

            {/* Name input */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: t.textDim, display: "block", marginBottom: 4 }}>Coin Name</label>
              <input
                value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. NEAR Bull Run"
                style={inputStyle(t)}
                maxLength={32}
              />
            </div>

            {/* Ticker input */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: t.textDim, display: "block", marginBottom: 4 }}>Ticker Symbol</label>
              <input
                value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())}
                placeholder="e.g. NBULL"
                style={{ ...inputStyle(t), textTransform: "uppercase", fontWeight: 700, letterSpacing: 1 }}
                maxLength={10}
              />
            </div>

            {/* Advanced tokenomics toggle */}
            <button
              type="button"
              onClick={() => setShowAdvanced(v => !v)}
              style={{
                background: "transparent", border: "none", color: ORANGE,
                fontSize: 12, cursor: "pointer", padding: "4px 0", marginBottom: 8,
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              <ChevronDown
                size={12}
                style={{ transform: showAdvanced ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
              />
              Advanced tokenomics {showAdvanced ? "" : "(optional)"}
            </button>

            {showAdvanced && (
              <div style={{
                padding: 12, borderRadius: 10, background: t.bgSurface,
                border: `1px solid ${t.border}`, marginBottom: 16,
              }}>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, color: t.textDim, display: "block", marginBottom: 4 }}>
                    Max Supply (tokens)
                  </label>
                  <input
                    value={maxSupply}
                    onChange={e => setMaxSupply(e.target.value.replace(/[^\d]/g, ""))}
                    placeholder="Default: 1,000,000,000"
                    style={inputStyle(t)}
                    inputMode="numeric"
                  />
                  <div style={{ fontSize: 11, color: t.textDim, marginTop: 4 }}>
                    Hard cap on total tokens ever minted. Range: 1,000 – 1,000,000,000,000.
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: t.textDim, display: "block", marginBottom: 4 }}>
                    Bonding Hardcap (USD mcap)
                  </label>
                  <input
                    value={hardcapUsd}
                    onChange={e => setHardcapUsd(e.target.value.replace(/[^\d]/g, ""))}
                    placeholder="Default: 70000"
                    style={inputStyle(t)}
                    inputMode="numeric"
                  />
                  <div style={{ fontSize: 11, color: t.textDim, marginTop: 4 }}>
                    USD market cap that triggers bonding to Rhea. Range: $1,000 – $10,000,000.
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Fee + curve transparency */}
        <div style={{
          padding: "10px 12px", borderRadius: 10,
          background: t.bgSurface, border: `1px solid ${t.border}`,
          marginBottom: 12, fontSize: 11.5, color: t.textMuted, lineHeight: 1.6,
        }}>
          <div><strong style={{ color: t.white }}>Creator First-Mover fee:</strong> 2% of all trades on this coin — forever.</div>
          <div><strong style={{ color: t.white }}>Platform fee:</strong> 1% of every trade (funds IronClaw Treasury).</div>
          <div><strong style={{ color: t.white }}>Bonding curve:</strong> piecewise, managed by IronClaw. Graduates to DEX at hardcap.</div>
        </div>

        {/* Warning */}
        <div style={{
          padding: "10px 14px", borderRadius: 10, background: `${t.amber}10`,
          border: `1px solid ${t.amber}33`, marginBottom: 16,
          fontSize: 12, color: t.amber, lineHeight: 1.6,
          display: "flex", gap: 8, alignItems: "flex-start",
        }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <strong>Creator sell restriction:</strong> Before bonding (your hardcap), you cannot sell.
            After bonding, a single sell burns 70% of your tokens.
          </div>
        </div>

        {/* Low-signal acknowledgement gate */}
        {isLowSignal && (
          <label style={{
            display: "flex", alignItems: "flex-start", gap: 8,
            padding: "10px 12px", borderRadius: 10,
            background: `${t.red}10`, border: `1px solid ${t.red}44`,
            marginBottom: 12, fontSize: 12, color: t.red, lineHeight: 1.5,
            cursor: "pointer",
          }}>
            <input
              type="checkbox"
              checked={lowSignalAck}
              onChange={e => setLowSignalAck(e.target.checked)}
              style={{ marginTop: 2, accentColor: t.red }}
            />
            <span>Launch anyway — I understand IronClaw flagged this story as low signal.</span>
          </label>
        )}

        {/* Fee */}
        <div style={{ fontSize: 12, color: t.textDim, marginBottom: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <Coins size={12} /> Creation fee: <strong style={{ color: ORANGE }}>2 NEAR</strong>
        </div>

        {/* Mint button */}
        <Btn primary onClick={handleMint} disabled={minting || suggesting || !wallet || (isLowSignal && !lowSignalAck)} style={{ width: "100%", justifyContent: "center" }}>
          {minting ? <><Loader2 size={14} className="spin" /> Creating coin...</>
            : !wallet ? <><Lock size={14} /> Connect Wallet</>
            : <><Sparkles size={14} /> Coin This Story</>
          }
        </Btn>

        {err && (
          <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: `${t.red}15`, color: t.red, fontSize: 12 }}>
            {err}
          </div>
        )}
      </div>
      <style>{`
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}

// ── CreatorDashboard ───────────────────────────────────────────────────

function CreatorDashboard({ wallet }) {
  const t = useTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(null);
  const { selector } = useWallet();

  useEffect(() => {
    if (!wallet) return;
    setLoading(true);
    api(`/api/newscoin/creator/${wallet}`, { wallet })
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [wallet]);

  const handleClaim = async (coinId, curveContract) => {
    if (!selector || !wallet) return;
    setClaiming(coinId);
    try {
      const w = await selector.wallet();
      const action = functionCallAction({
        methodName: "claim_fees",
        args: { coin_id: coinId },
        gas: "100000000000000",
        deposit: "1",
      });
      await sendTx(w, wallet, curveContract || FACTORY, [action]);
      // Refresh
      const updated = await api(`/api/newscoin/creator/${wallet}`, { wallet });
      setData(updated);
    } catch (e) {
      console.warn("Claim failed:", e?.message || e);
    } finally {
      setClaiming(null);
    }
  };

  if (loading) return (
    <div style={{ textAlign: "center", padding: 32, color: t.textDim }}>
      <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
    </div>
  );

  if (!data || !data.coins?.length) return (
    <div style={{ textAlign: "center", padding: 32, color: t.textDim, fontSize: 13 }}>
      You haven't coined any stories yet.
    </div>
  );

  const totalPnl = data.pnl || 0;

  return (
    <div>
      {/* PnL summary */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 16,
      }}>
        {[
          { label: "Total Coins", value: data.coins.length, color: ORANGE },
          { label: "Total Fees", value: `${fmtNear(data.total_fees || 0)} N`, color: t.green },
          { label: "PnL", value: fmtUsd(totalPnl), color: totalPnl >= 0 ? t.green : t.red },
        ].map(s => (
          <div key={s.label} style={{ background: t.bgSurface, borderRadius: 10, padding: "12px 14px", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: t.textDim, marginBottom: 2 }}>{s.label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: s.color, fontFamily: "'JetBrains Mono', monospace" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Warning banner */}
      <div style={{
        padding: "8px 12px", borderRadius: 8, background: `${t.amber}10`,
        border: `1px solid ${t.amber}33`, marginBottom: 16,
        fontSize: 11, color: t.amber, display: "flex", alignItems: "center", gap: 6,
      }}>
        <AlertTriangle size={12} />
        Pre-bonding: no selling. Post-bonding: single sell burns 70% of your tokens.
      </div>

      {/* Coins table */}
      <div style={{ overflowX: "auto" }}>
        {data.coins.map(c => (
          <div key={c.id} style={{
            display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
            borderRadius: 10, background: t.bgSurface, marginBottom: 6,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.white }}>{c.name}</div>
              <div style={{ fontSize: 11, color: ORANGE, fontWeight: 700 }}>${c.ticker}</div>
            </div>
            <div style={{ textAlign: "right", fontSize: 12, color: t.textMuted, minWidth: 60 }}>
              <div style={{ fontWeight: 600, color: t.white }}>{fmtUsd(c.mcap_usd)}</div>
              <div>MCap</div>
            </div>
            <div style={{ textAlign: "right", fontSize: 12, color: t.textMuted, minWidth: 60 }}>
              <div style={{ fontWeight: 600, color: t.white }}>{fmtTokens(c.your_holdings)}</div>
              <div>Holdings</div>
            </div>
            <div style={{ textAlign: "right", fontSize: 12, minWidth: 60 }}>
              <div style={{ fontWeight: 600, color: t.green }}>{fmtNear(c.claimable_fees)} N</div>
              <div style={{ color: t.textDim }}>Fees</div>
            </div>
            <button onClick={() => handleClaim(c.id, c.curve_contract)} disabled={claiming === c.id || !Number(c.claimable_fees)} style={{
              padding: "6px 14px", borderRadius: 8, fontSize: 11, fontWeight: 700,
              background: Number(c.claimable_fees) ? `${t.green}18` : t.bgSurface,
              color: Number(c.claimable_fees) ? t.green : t.textDim,
              border: `1px solid ${Number(c.claimable_fees) ? t.green + "44" : t.border}`,
              cursor: Number(c.claimable_fees) ? "pointer" : "not-allowed",
              opacity: claiming === c.id ? 0.5 : 1,
            }}>
              {claiming === c.id ? "..." : "Claim"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── CurveInfoPanel ─────────────────────────────────────────────────────

function CurveInfoPanel({ coinId }) {
  const t = useTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!coinId) return;
    setLoading(true);
    api(`/api/newscoin/${coinId}/curve`)
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [coinId]);

  if (loading) return (
    <div style={{ textAlign: "center", padding: 16, color: t.textDim }}>
      <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
    </div>
  );

  if (!data) return (
    <div style={{ fontSize: 12, color: t.textDim, textAlign: "center", padding: 16 }}>
      Curve data unavailable
    </div>
  );

  const pendingUpdate = data.pending_update;
  const cooldown = data.cooldown_remaining_s || 0;

  return (
    <div style={{ ...cardStyle(t), padding: "14px 16px", marginTop: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: t.white, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
        <BarChart3 size={14} color={ORANGE} /> Curve Parameters
      </div>

      {/* Segments */}
      {data.segments && (
        <div style={{ marginBottom: 10 }}>
          {data.segments.map((seg, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", fontSize: 11, color: t.textMuted,
              padding: "4px 0", borderBottom: i < data.segments.length - 1 ? `1px solid ${t.border}` : "none",
            }}>
              <span>Segment {i + 1}: {seg.type || "linear"}</span>
              <span style={{ color: t.textDim }}>{seg.range || ""}</span>
            </div>
          ))}
        </div>
      )}

      {/* Last update */}
      {data.last_update && (
        <div style={{ fontSize: 11, color: t.textDim, marginBottom: 6 }}>
          Last update: {timeAgo(data.last_update)}
        </div>
      )}

      {/* Cooldown */}
      {cooldown > 0 && (
        <div style={{ fontSize: 11, color: t.amber, display: "flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
          <Timer size={11} /> Cooldown: {Math.ceil(cooldown / 60)}m remaining
        </div>
      )}

      {/* Pending update */}
      {pendingUpdate && (
        <div style={{
          padding: "8px 10px", borderRadius: 8, background: `${t.amber}10`,
          border: `1px solid ${t.amber}33`, fontSize: 11, color: t.amber, marginTop: 8,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 2 }}>Pending Update</div>
          <div>Trigger: {pendingUpdate.trigger || "metric threshold"}</div>
          {pendingUpdate.executes_at && (
            <div>Executes: {timeAgo(pendingUpdate.executes_at)} remaining</div>
          )}
          {pendingUpdate.transition_pct != null && (
            <div style={{ marginTop: 4 }}>
              <div style={{ height: 4, borderRadius: 2, background: t.bgSurface, overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 2, width: `${pendingUpdate.transition_pct}%`,
                  background: t.amber,
                }} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── CoinRow ────────────────────────────────────────────────────────────

function CoinRow({ coin, onClick }) {
  const t = useTheme();
  const change = Number(coin.change_24h || 0);
  const isUp = change >= 0;
  const lc = lifecycleFor(coin);

  return (
    <div
      onClick={() => onClick(coin)}
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
        ...cardStyle(t), marginBottom: 6, cursor: "pointer",
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = `${ORANGE}66`; e.currentTarget.style.background = t.bgCardHover || t.bgSurface; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.background = t.bgCard; }}
    >
      {/* Left: headline + ticker */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, color: t.white, fontWeight: 600, overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {coin.headline || coin.name}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: ORANGE }}>${coin.ticker}</span>
          <span style={{ fontSize: 10, color: t.textDim }}>{timeAgo(coin.created_at || coin.timestamp)}</span>
          <span style={{
            fontSize: 9, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
            padding: "1px 6px", borderRadius: 6,
            background: `${lc.color}18`, color: lc.color, border: `1px solid ${lc.color}44`,
          }}>{lc.label}</span>
        </div>
      </div>

      {/* MCap badge */}
      <div style={{ textAlign: "right", minWidth: 55 }}>
        <Badge color={ORANGE} style={{ fontSize: 10 }}>{fmtUsd(coin.mcap_usd)}</Badge>
      </div>

      {/* 24h change */}
      <div style={{
        fontSize: 12, fontWeight: 700, minWidth: 55, textAlign: "right",
        color: isUp ? t.green : t.red,
        display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2,
      }}>
        {isUp ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
        {fmtPct(change)}
      </div>

      {/* Volume */}
      <div style={{ textAlign: "right", minWidth: 50, fontSize: 11, color: t.textDim }}>
        <div style={{ fontWeight: 600, color: t.textMuted }}>{fmtNear(coin.volume_24h)}</div>
        <div style={{ fontSize: 9 }}>VOL</div>
      </div>

      {/* Sparkline */}
      <Sparkline data={coin.sparkline || []} width={50} height={20} color={isUp ? t.green : t.red} />
    </div>
  );
}

// ── Main: NewsCoinPage ─────────────────────────────────────────────────

const TABS = [
  { key: "trending", label: "Trending", icon: Flame },
  { key: "new", label: "New", icon: Clock },
  { key: "top", label: "Top", icon: Award },
  { key: "expiring", label: "Expiring", icon: Timer },
  { key: "holdings", label: "Holdings", icon: Briefcase },
];

export default function NewsCoinPage() {
  const t = useTheme();
  const { connected, address: wallet, selector } = useWallet();
  const [tab, setTab] = useState("trending");
  const [coins, setCoins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const [selectedCoin, setSelectedCoin] = useState(null);
  const [selectedPost, setSelectedPost] = useState(null);
  const [terminalCoinId, setTerminalCoinId] = useState(null);
  // Track viewport so we can route desktop clicks → full terminal while
  // keeping the existing CoinModal slide-up sheet for mobile.
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== "undefined" ? window.matchMedia("(min-width: 900px)").matches : true
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 900px)");
    const handler = (e) => setIsDesktop(e.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);
  const sentinelRef = useRef(null);
  const loadingRef = useRef(false);
  const PAGE_SIZE = 20;

  const fetchCoins = useCallback(async (pageNum, append = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!append) setLoading(true);
    try {
      // Try backend indexer first (has mcap/volume/sparkline data).
      let list = [];
      try {
        const params = new URLSearchParams({ filter: tab, offset: String(pageNum * PAGE_SIZE), limit: String(PAGE_SIZE) });
        if (wallet) params.set("wallet", wallet);
        const data = await api(`/api/newscoin/list?${params}`);
        list = Array.isArray(data?.coins) ? data.coins : Array.isArray(data) ? data : [];
      } catch (err) {
        // Backend down or missing — we'll rely entirely on on-chain data.
        if (!err?.backendDown) console.warn("NewsCoin backend error:", err?.message || err);
      }

      // Always merge in on-chain coins from the factory so newly-minted coins
      // show up immediately even if the backend indexer hasn't seen them yet.
      try {
        const { getAllCoinsOnChain } = await import("@/lib/newscoin");
        const onchain = await getAllCoinsOnChain({
          fromIndex: pageNum * PAGE_SIZE,
          limit: PAGE_SIZE,
        });
        // Merge by coinAddress OR storyId — backend rows may use tx hashes
        // as contractAddress until the indexer catches up.
        const seenAddr = new Set(list.map(c => c.coinAddress || c.contractAddress).filter(Boolean));
        const seenStory = new Set(list.map(c => String(c.storyId)).filter(Boolean));
        for (const c of onchain) {
          if (seenAddr.has(c.coinAddress)) continue;
          if (seenStory.has(String(c.storyId))) continue;
          list.push(c);
        }
      } catch (chainErr) {
        console.warn("NewsCoin on-chain fetch error:", chainErr?.message || chainErr);
      }

      // Sort: newest first for "new", mcap desc for "top", otherwise keep mixed.
      if (tab === "new") {
        list.sort((a, b) => {
          const ai = a._index ?? 0;
          const bi = b._index ?? 0;
          return bi - ai;
        });
      }

      if (append) {
        setCoins(prev => {
          const seen = new Set(prev.map(c => c.coinAddress || c.id));
          return [...prev, ...list.filter(c => !seen.has(c.coinAddress || c.id))];
        });
      } else {
        setCoins(list);
      }
      setHasMore(list.length >= PAGE_SIZE);
    } catch (err) {
      console.warn("NewsCoin fetch error:", err?.message || err);
      if (!append) setCoins([]);
      setHasMore(false);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [tab, wallet]);

  // Reset on tab change
  useEffect(() => {
    setPage(0);
    setCoins([]);
    setHasMore(true);
    fetchCoins(0, false);
  }, [tab, wallet]);

  // Load more
  const loadMore = useCallback(() => {
    if (!hasMore || loadingRef.current) return;
    const next = page + 1;
    setPage(next);
    fetchCoins(next, true);
  }, [page, hasMore, fetchCoins]);

  // Infinite scroll sentinel
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) loadMore();
    }, { rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  const openCoin = (coin) => {
    // Always route into the full NewsCoinTerminal — it stacks on mobile
    // (chart full-width + order panel as a slide-up drawer), so the old
    // CoinModal slide-up sheet is no longer the mobile fallback. Having
    // one code path means every platform gets candles, trades, and the
    // buy/sell flow identically.
    setTerminalCoinId(coin.id || coin.coinAddress);
  };

  // Deep-link support: accept either ?id= / ?token= in the location
  // query (e.g. from YourDeploysPanel right-rail links) OR in the hash
  // route's query (#?id=... from push notifications). Opens the
  // terminal on that coin for any viewport.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const read = () => {
      const tryOpen = (id) => { if (id) setTerminalCoinId(id); };
      // Top-level query (static-export normal links)
      try {
        const qs = new URLSearchParams(window.location.search);
        tryOpen(qs.get("id") || qs.get("token"));
      } catch {}
      // Hash query (legacy hash-routed deep links)
      const h = window.location.hash || "";
      const qIdx = h.indexOf("?");
      if (qIdx !== -1) {
        try {
          const params = new URLSearchParams(h.slice(qIdx + 1));
          tryOpen(params.get("id") || params.get("token"));
        } catch {}
      }
    };
    read();
    window.addEventListener("hashchange", read);
    window.addEventListener("popstate", read);
    return () => {
      window.removeEventListener("hashchange", read);
      window.removeEventListener("popstate", read);
    };
  }, []);

  // If the terminal is open, render it full-bleed in place of the list.
  if (terminalCoinId) {
    return (
      <NewsCoinTerminal
        coins={coins}
        initialCoinId={terminalCoinId}
        onBack={() => setTerminalCoinId(null)}
      />
    );
  }

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "16px 12px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <Coins size={22} color={ORANGE} />
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: t.white }}>NewsCoin</div>
          <div style={{ fontSize: 12, color: t.textMuted }}>Trade the news. Every story is a market.</div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{
        display: "flex", gap: 4, marginBottom: 16, overflowX: "auto",
        padding: "3px", background: t.bgSurface, borderRadius: 12,
      }}>
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          const needsWallet = key === "holdings" && !connected;
          return (
            <button
              key={key}
              onClick={() => {
                if (needsWallet) return;
                setTab(key);
              }}
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                padding: "8px 12px", borderRadius: 9, fontSize: 12, fontWeight: 700,
                background: active ? `${ORANGE}20` : "transparent",
                color: active ? ORANGE : needsWallet ? t.textDim : t.textMuted,
                border: active ? `1px solid ${ORANGE}44` : "1px solid transparent",
                cursor: needsWallet ? "not-allowed" : "pointer",
                transition: "all 0.2s", whiteSpace: "nowrap",
                opacity: needsWallet ? 0.5 : 1,
              }}
            >
              <Icon size={13} />
              {label}
              {needsWallet && <Lock size={10} />}
            </button>
          );
        })}
      </div>

      {/* Holdings tab: show creator dashboard */}
      {tab === "holdings" && connected && (
        <div style={{ marginBottom: 16 }}>
          <CreatorDashboard wallet={wallet} />
          <div style={{ height: 1, background: t.border, margin: "16px 0" }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: t.white, marginBottom: 10 }}>Your Holdings</div>
        </div>
      )}

      {/* Coin list */}
      {loading && coins.length === 0 ? (
        <div style={{ textAlign: "center", padding: 48, color: t.textDim }}>
          <Loader2 size={24} style={{ animation: "spin 1s linear infinite", marginBottom: 12 }} />
          <div style={{ fontSize: 13 }}>Loading coins...</div>
        </div>
      ) : coins.length === 0 ? (
        <div style={{
          textAlign: "center", padding: 48, color: t.textDim,
          ...cardStyle(t), borderStyle: "dashed",
        }}>
          <Coins size={32} color={t.textDim} style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: t.textMuted, marginBottom: 4 }}>
            {tab === "holdings" ? "No holdings yet" : "No coins found"}
          </div>
          <div style={{ fontSize: 12 }}>
            {tab === "holdings"
              ? "Buy coins on trending stories to see them here."
              : "Coin a story from IronFeed to create the first one!"
            }
          </div>
        </div>
      ) : (
        <>
          {coins.map(coin => (
            <CoinRow key={coin.id} coin={coin} onClick={openCoin} />
          ))}

          {/* Sentinel for infinite scroll */}
          <div ref={sentinelRef} style={{ height: 1 }} />

          {loadingRef.current && hasMore && (
            <div style={{ textAlign: "center", padding: 16, color: t.textDim }}>
              <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
            </div>
          )}

          {!hasMore && coins.length > 0 && (
            <div style={{ textAlign: "center", padding: 16, fontSize: 12, color: t.textDim }}>
              End of list
            </div>
          )}
        </>
      )}

      {/* CoinModal */}
      {selectedCoin && (
        <CoinModal
          coin={selectedCoin}
          post={selectedPost}
          wallet={wallet}
          selector={selector}
          onClose={() => { setSelectedCoin(null); setSelectedPost(null); }}
        />
      )}

      {/* Global keyframes */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}
