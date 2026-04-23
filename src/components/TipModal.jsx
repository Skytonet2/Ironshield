"use client";
// Tip modal + tip history drawer for IronFeed posts.
// Multi-token: NEAR + any NEP-141 the tipper holds. Amount presets are
// denominated in the selected token. USD equivalent is shown beneath.
//
// Flow:
//   1. User picks token (defaults to NEAR).
//   2. User picks amount preset or enters custom.
//   3. User optionally ticks "Anonymous".
//   4. Submit → 3-step status (Signing → Processing → Confirmed).
//
// Under the hood: callTipPost() signs (or mocks) the on-chain transfer,
// then POST /api/tips persists the row and returns the tip record.

import { useEffect, useMemo, useState } from "react";
import { X, Zap, Loader2, Check, EyeOff, ChevronDown, ExternalLink } from "lucide-react";
import { useTheme } from "@/lib/contexts";
import { fetchWalletTokens, callTipPost, formatTokenAmount, NATIVE_NEAR } from "@/lib/tokens";

import { API_BASE as API } from "@/lib/apiBase";

const PRESETS = [5, 25, 100];

function shortWallet(w = "") {
  return w.length > 18 ? `${w.slice(0, 8)}…${w.slice(-6)}` : w;
}

function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/* ─────────────────────────── TipModal ─────────────────────────── */
export function TipModal({ post, wallet, selector, openWallet, onClose, onTipped }) {
  const t = useTheme();
  const [tokens, setTokens]   = useState([]);
  const [loadingTokens, setLoadingTokens] = useState(true);
  const [selected, setSelected] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [amount, setAmount]   = useState("");
  const [anonymous, setAnon]  = useState(false);
  const [step, setStep]       = useState("idle"); // idle|signing|processing|confirmed|error
  const [err, setErr]         = useState("");
  const [txHash, setTxHash]   = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!wallet) { setLoadingTokens(false); return; }
      try {
        const list = await fetchWalletTokens(wallet);
        if (cancelled) return;
        setTokens(list);
        setSelected(list[0] || null);
      } catch (e) {
        if (!cancelled) setErr(`Couldn't load wallet tokens: ${e.message}`);
      } finally {
        if (!cancelled) setLoadingTokens(false);
      }
    })();
    return () => { cancelled = true; };
  }, [wallet]);

  const usdPreview = useMemo(() => {
    if (!selected || !Number(amount)) return 0;
    return Number(amount) * (selected.priceUsd || 0);
  }, [amount, selected]);

  const tooMuch = selected && Number(amount) > selected.balanceHuman;

  const submit = async () => {
    if (!wallet) { openWallet?.(); return; }
    if (!selected)      { setErr("Pick a token first"); return; }
    if (!Number(amount) || Number(amount) <= 0) { setErr("Enter an amount"); return; }
    if (tooMuch) { setErr(`Insufficient ${selected.symbol} balance`); return; }

    setErr("");
    setStep("signing");
    try {
      const recipient = post.author?.wallet_address || post.author?.wallet;
      if (!recipient) throw new Error("Post author wallet unknown");
      const { txHash: hash, amountBase } = await callTipPost({
        selector, accountId: wallet,
        postId: post.id,
        token: selected,
        amount: Number(amount),
        anonymous,
        recipient,
      });
      setTxHash(hash);
      setStep("processing");

      const r = await fetch(`${API}/api/tips`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-wallet": wallet },
        body: JSON.stringify({
          postId: post.id,
          tokenContract: selected.contractId,
          tokenSymbol:   selected.symbol,
          tokenDecimals: selected.decimals,
          amountBase,
          amountHuman:   Number(amount),
          amountUsd:     usdPreview,
          anonymous,
          txHash: hash,
        }),
      });
      // Some hosts (e.g. Cloudflare Pages SPA fallback) return an HTML page
      // for unknown routes. Detect and surface a clean error instead of the
      // raw "<!DOCTYPE … is not valid JSON" parse failure.
      const ctype = r.headers.get("content-type") || "";
      if (!ctype.includes("application/json")) {
        setStep("error");
        setErr(r.status === 404
          ? "Backend not reachable — tip API not deployed at this URL."
          : `Backend returned non-JSON response (HTTP ${r.status}). Check NEXT_PUBLIC_BACKEND_URL.`);
        return;
      }
      const data = await r.json().catch(() => null);
      if (!r.ok || !data) {
        setStep("error");
        setErr(data?.error || `Tip save failed (HTTP ${r.status})`);
        return;
      }
      setStep("confirmed");
      onTipped?.({ ...data.tip, amountUsd: usdPreview });
    } catch (e) {
      setStep("error");
      const m = e?.message || String(e);
      if (/reject|cancel|denied|user closed/i.test(m)) setErr("Transaction rejected in wallet");
      else setErr(m);
    }
  };

  const canSubmit = step === "idle" && !loadingTokens && selected && Number(amount) > 0 && !tooMuch;

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={e => e.stopPropagation()} style={{
        background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 16,
        width: "100%", maxWidth: 480, maxHeight: "90vh", overflow: "auto",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: `1px solid ${t.border}` }}>
          <h3 style={{ margin: 0, color: t.white, fontSize: 17, display: "flex", alignItems: "center", gap: 8 }}>
            <Zap size={18} color={t.amber} fill={t.amber} /> Send tip
          </h3>
          <button onClick={onClose} style={iconBtn(t)}><X size={18} /></button>
        </div>

        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Recipient */}
          <div style={{ fontSize: 12, color: t.textMuted }}>
            Tipping <span style={{ color: t.white, fontWeight: 700 }}>
              @{post.author?.username || shortWallet(post.author?.wallet_address || "")}
            </span>
          </div>

          {!wallet && (
            <div style={{ padding: 12, borderRadius: 10, background: `${t.amber}14`, color: t.amber, fontSize: 13 }}>
              Connect your wallet to send a tip.
              <button onClick={openWallet} style={{ ...primaryBtn(t), marginTop: 10, width: "100%" }}>
                Connect wallet
              </button>
            </div>
          )}

          {wallet && (
            <>
              {/* Token picker */}
              <div>
                <label style={labelStyle(t)}>Token</label>
                <TokenPicker
                  t={t}
                  tokens={tokens}
                  loading={loadingTokens}
                  selected={selected}
                  onSelect={(tok) => { setSelected(tok); setAmount(""); setPickerOpen(false); }}
                  open={pickerOpen}
                  setOpen={setPickerOpen}
                />
              </div>

              {/* Presets */}
              <div>
                <label style={labelStyle(t)}>Amount</label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 8 }}>
                  {PRESETS.map(v => (
                    <button key={v}
                      onClick={() => setAmount(String(v))}
                      disabled={step !== "idle"}
                      style={presetBtn(t, String(v) === amount)}>
                      {v} {selected?.symbol || ""}
                      <div style={{ fontSize: 10, color: t.textDim, fontWeight: 500, marginTop: 2 }}>
                        ≈ ${(v * (selected?.priceUsd || 0)).toFixed(2)}
                      </div>
                    </button>
                  ))}
                </div>
                <input
                  type="number" min="0" step="any"
                  placeholder="Custom amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={step !== "idle"}
                  style={{
                    width: "100%", padding: "10px 14px", background: t.bgSurface,
                    border: `1px solid ${tooMuch ? t.red : t.border}`,
                    color: t.text, borderRadius: 10, outline: "none", fontSize: 14, boxSizing: "border-box",
                  }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11 }}>
                  <span style={{ color: tooMuch ? t.red : t.textMuted }}>
                    Balance: {formatTokenAmount(selected?.balanceHuman || 0)} {selected?.symbol || ""}
                  </span>
                  <span style={{ color: t.textMuted }}>
                    ≈ ${usdPreview.toFixed(2)} USD
                  </span>
                </div>
              </div>

              {/* Anonymous toggle */}
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "10px 12px",
                borderRadius: 10, background: t.bgSurface, border: `1px solid ${t.border}` }}>
                <input type="checkbox" checked={anonymous} onChange={e => setAnon(e.target.checked)}
                  disabled={step !== "idle"} style={{ width: 16, height: 16 }} />
                <EyeOff size={14} color={t.textMuted} />
                <div>
                  <div style={{ color: t.text, fontSize: 13, fontWeight: 600 }}>Tip anonymously</div>
                  <div style={{ color: t.textDim, fontSize: 11 }}>
                    Your wallet stays hidden in public tip history.
                  </div>
                </div>
              </label>

              {/* Status */}
              {step !== "idle" && (
                <StatusSteps t={t} step={step} txHash={txHash} />
              )}

              {err && (
                <div style={{ padding: 10, borderRadius: 10, background: `${t.red}14`, color: t.red, fontSize: 12 }}>
                  {err}
                </div>
              )}

              {/* Actions */}
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={onClose} disabled={step === "signing" || step === "processing"}
                  style={secondaryBtn(t)}>
                  {step === "confirmed" ? "Close" : "Cancel"}
                </button>
                {step !== "confirmed" && (
                  <button onClick={submit} disabled={!canSubmit}
                    style={{ ...primaryBtn(t), opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "not-allowed" }}>
                    {step === "signing" || step === "processing"
                      ? <Loader2 size={14} className="ix-spin" />
                      : `Send tip`}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── Token picker ───────────────────────── */
function TokenPicker({ t, tokens, loading, selected, onSelect, open, setOpen }) {
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", padding: "10px 14px", background: t.bgSurface,
          border: `1px solid ${t.border}`, color: t.text, borderRadius: 10,
          fontSize: 14, display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer",
        }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {selected?.iconUrl
            ? <img src={selected.iconUrl} alt="" style={{ width: 22, height: 22, borderRadius: "50%" }} />
            : <div style={{ width: 22, height: 22, borderRadius: "50%", background: t.accent, display: "grid", placeItems: "center", color: "#fff", fontWeight: 800, fontSize: 10 }}>
                {selected?.symbol?.[0] || "?"}
              </div>}
          <span style={{ fontWeight: 700 }}>{selected?.symbol || (loading ? "Loading…" : "Select token")}</span>
          <span style={{ color: t.textDim, fontSize: 12 }}>
            {selected ? `${formatTokenAmount(selected.balanceHuman)} avail` : ""}
          </span>
        </span>
        <ChevronDown size={16} color={t.textMuted} />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 20,
          background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 10,
          maxHeight: 280, overflow: "auto", boxShadow: "0 10px 30px rgba(0,0,0,0.45)",
        }}>
          {loading && <div style={{ padding: 14, color: t.textMuted, fontSize: 13 }}>Loading tokens…</div>}
          {!loading && tokens.length === 0 && (
            <div style={{ padding: 14, color: t.textMuted, fontSize: 13 }}>No tippable tokens in wallet.</div>
          )}
          {tokens.map(tok => (
            <button key={tok.contractId} onClick={() => onSelect(tok)}
              style={{
                width: "100%", padding: "10px 12px", background: selected?.contractId === tok.contractId ? t.bgSurface : "none",
                border: "none", color: t.text, cursor: "pointer", textAlign: "left",
                display: "flex", alignItems: "center", gap: 10, borderBottom: `1px solid ${t.border}`,
              }}>
              {tok.iconUrl
                ? <img src={tok.iconUrl} alt="" style={{ width: 24, height: 24, borderRadius: "50%" }} />
                : <div style={{ width: 24, height: 24, borderRadius: "50%", background: t.accent,
                    display: "grid", placeItems: "center", color: "#fff", fontWeight: 800, fontSize: 11 }}>
                    {tok.symbol?.[0] || "?"}
                  </div>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{tok.symbol}</div>
                <div style={{ fontSize: 11, color: t.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {tok.contractId === NATIVE_NEAR ? "Native" : tok.contractId}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, color: t.text }}>{formatTokenAmount(tok.balanceHuman)}</div>
                <div style={{ fontSize: 10, color: t.textDim }}>
                  ≈ ${(tok.usdValue || 0).toFixed(2)}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────── 3-step status indicator ───────────────────── */
function StatusSteps({ t, step, txHash }) {
  const stages = [
    { key: "signing",    label: "Signing"    },
    { key: "processing", label: "Processing" },
    { key: "confirmed",  label: "Confirmed"  },
  ];
  const idx = stages.findIndex(s => s.key === step);
  return (
    <div style={{ padding: 12, borderRadius: 10, background: t.bgSurface, border: `1px solid ${t.border}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        {stages.map((s, i) => {
          const done    = i < idx || step === "confirmed";
          const current = i === idx && step !== "confirmed";
          const color   = done ? t.green : current ? t.accent : t.textDim;
          return (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
              <div style={{
                width: 22, height: 22, borderRadius: "50%",
                background: done ? t.green : current ? `${t.accent}33` : "transparent",
                border: `2px solid ${color}`,
                display: "grid", placeItems: "center",
              }}>
                {done ? <Check size={12} color="#fff" /> :
                 current ? <Loader2 size={12} className="ix-spin" color={t.accent} /> :
                 <span style={{ fontSize: 10, color }}>{i + 1}</span>}
              </div>
              <span style={{ fontSize: 12, color, fontWeight: 600 }}>{s.label}</span>
              {i < stages.length - 1 && <div style={{ flex: 1, height: 2, background: done ? t.green : t.border, borderRadius: 1 }} />}
            </div>
          );
        })}
      </div>
      {step === "confirmed" && txHash && (
        <div style={{ marginTop: 10, fontSize: 11, color: t.textMuted, display: "flex", alignItems: "center", gap: 4 }}>
          tx: <code style={{ color: t.text }}>{txHash.slice(0, 16)}…</code>
          {!txHash.startsWith("mock_") && (
            <a href={`https://nearblocks.io/txns/${txHash}`} target="_blank" rel="noopener noreferrer"
              style={{ color: t.accent, marginLeft: 4 }}>
              <ExternalLink size={11} />
            </a>
          )}
          {txHash.startsWith("mock_") && <span style={{ color: t.textDim }}>(mocked)</span>}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── Tip history drawer ─────────────────────── */
export function TipHistoryDrawer({ post, onClose, openTipModal }) {
  const t = useTheme();
  const [data, setData]       = useState({ tips: [], count: 0, totalUsd: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API}/api/tips/post/${post.id}`);
        const json = await r.json();
        if (!cancelled) setData(json);
      } catch (e) {
        console.warn("[tips] history fetch failed:", e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [post.id]);

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={e => e.stopPropagation()} style={{
        position: "fixed", right: 0, top: 0, bottom: 0, width: "100%", maxWidth: 420,
        background: t.bgCard, borderLeft: `1px solid ${t.border}`,
        display: "flex", flexDirection: "column",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: `1px solid ${t.border}` }}>
          <div>
            <h3 style={{ margin: 0, color: t.white, fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <Zap size={16} color={t.amber} fill={t.amber} /> Tip history
            </h3>
            <div style={{ color: t.textMuted, fontSize: 11, marginTop: 2 }}>
              {data.count} tip{data.count === 1 ? "" : "s"} · ${Number(data.totalUsd || 0).toFixed(2)} USD total
            </div>
          </div>
          <button onClick={onClose} style={iconBtn(t)}><X size={18} /></button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
          {loading && <div style={{ color: t.textMuted, fontSize: 13, textAlign: "center", padding: 20 }}>Loading…</div>}
          {!loading && data.tips.length === 0 && (
            <div style={{ color: t.textMuted, fontSize: 13, textAlign: "center", padding: 20 }}>
              No tips yet. Be the first?
            </div>
          )}
          {data.tips.map(tip => (
            <div key={tip.id} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
              borderBottom: `1px solid ${t.border}`,
            }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%",
                background: tip.anonymous ? t.bgSurface : t.accent,
                display: "grid", placeItems: "center", color: "#fff", fontWeight: 800, fontSize: 13 }}>
                {tip.anonymous ? <EyeOff size={14} color={t.textMuted} /> : (tip.tipper?.displayName || tip.tipper?.username || "?")[0]?.toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: t.text, fontSize: 13, fontWeight: 600 }}>
                  {tip.anonymous ? "Anonymous" : (tip.tipper?.displayName || `@${tip.tipper?.username}` || shortWallet(tip.tipper?.wallet || ""))}
                </div>
                <div style={{ color: t.textDim, fontSize: 11 }}>{timeAgo(tip.createdAt)} ago</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ color: t.amber, fontSize: 13, fontWeight: 700 }}>
                  {formatTokenAmount(tip.amountHuman)} {tip.tokenSymbol}
                </div>
                <div style={{ color: t.textDim, fontSize: 11 }}>≈ ${Number(tip.amountUsd).toFixed(2)}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: 12, borderTop: `1px solid ${t.border}` }}>
          <button onClick={() => { onClose(); openTipModal?.(); }} style={{ ...primaryBtn(t), width: "100%" }}>
            <Zap size={14} /> Send a tip
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Styles ─────────────────────────── */
const overlayStyle = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)",
  zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "flex-end",
};

function iconBtn(t) {
  return { background: "none", border: "none", color: t.textMuted, cursor: "pointer" };
}
function labelStyle(t) {
  return { display: "block", fontSize: 12, color: t.textMuted, marginBottom: 6, fontWeight: 600 };
}
function primaryBtn(t) {
  return {
    flex: 1, padding: "10px 14px", background: t.accent, color: "#fff",
    border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 700,
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  };
}
function secondaryBtn(t) {
  return {
    flex: 1, padding: "10px 14px", background: "transparent", color: t.text,
    border: `1px solid ${t.border}`, borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600,
  };
}
function presetBtn(t, active) {
  return {
    padding: "10px 8px", background: active ? `${t.amber}22` : t.bgSurface,
    border: `1px solid ${active ? t.amber : t.border}`,
    color: active ? t.amber : t.text, borderRadius: 10, cursor: "pointer",
    fontSize: 13, fontWeight: 700, textAlign: "center",
  };
}
