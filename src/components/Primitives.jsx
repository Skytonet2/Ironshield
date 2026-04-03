"use client";
import { useTheme, useWallet } from "@/lib/contexts";
import { ArrowUpRight, ArrowDownRight, EyeOff, Lock, Wallet, ChevronRight, X } from "lucide-react";
import { useState } from "react";

export function Btn({ children, primary, onClick, style = {}, disabled = false }) {
  const t = useTheme();
  const base = primary
    ? { background: `linear-gradient(135deg, ${t.accent}, #1d4ed8)`, color: "#fff", border: "none", boxShadow: `0 0 24px ${t.accent}44` }
    : { background: "transparent", color: t.text, border: `1px solid ${t.border}` };
  return (
    <button disabled={disabled} onClick={onClick} style={{
      ...base, padding: "11px 26px", borderRadius: 10, fontSize: 14, fontWeight: 600,
      cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1,
      transition: "all 0.25s", display: "inline-flex", alignItems: "center", gap: 8, ...style
    }}
    onMouseEnter={e => { if (!disabled) { e.currentTarget.style.transform = "translateY(-2px)"; if (primary) e.currentTarget.style.boxShadow = `0 0 36px ${t.accent}66`; }}}
    onMouseLeave={e => { e.currentTarget.style.transform = ""; if (primary) e.currentTarget.style.boxShadow = `0 0 24px ${t.accent}44`; }}
    >{children}</button>
  );
}

export function Badge({ children, color, style = {} }) {
  const t = useTheme(); const c = color || t.accent;
  return <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: `${c}20`, color: c, textTransform: "uppercase", letterSpacing: 0.6, ...style }}>{children}</span>;
}

export function Section({ children, style = {} }) {
  return <div style={{ maxWidth: 1600, margin: "0 auto", padding: "60px 24px", ...style }}>{children}</div>;
}

export function StatCard({ icon: Icon, label, value, change, positive, color, blur = false }) {
  const t = useTheme(); const c = color || t.accent;
  return (
    <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14, padding: "22px 24px", transition: "all 0.3s", position: "relative", overflow: "hidden" }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = c; e.currentTarget.style.boxShadow = `0 0 24px ${c}22`; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.boxShadow = "none"; }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div style={{ background: `${c}18`, borderRadius: 10, padding: 9 }}><Icon size={18} color={c} /></div>
        {change && <div style={{ fontSize: 12, color: positive ? t.green : t.red, display: "flex", alignItems: "center", gap: 3 }}>
          {positive ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{change}
        </div>}
      </div>
      {blur ? (
        <div style={{ position: "relative" }}>
          <div style={{ filter: "blur(8px)", userSelect: "none" }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: t.white, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
            <div style={{ fontSize: 13, color: t.textMuted, marginTop: 4 }}>{label}</div>
          </div>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
            <EyeOff size={14} color={t.amber} />
            <span style={{ fontSize: 10, color: t.amber, fontWeight: 700, letterSpacing: 0.5 }}>NOT LIVE</span>
          </div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 26, fontWeight: 700, color: t.white, fontFamily: "'JetBrains Mono', monospace" }}>{value}</div>
          <div style={{ fontSize: 13, color: t.textMuted, marginTop: 4 }}>{label}</div>
        </>
      )}
    </div>
  );
}

export function MiniBar({ data, color, height = 60 }) {
  const t = useTheme(); const c = color || t.accent;
  const max = Math.max(...data);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height }}>
      {data.map((v, i) => (
        <div key={i} style={{ flex: 1, height: `${(v / max) * 100}%`, background: `linear-gradient(to top, ${c}, ${c}55)`, borderRadius: "3px 3px 0 0", minHeight: 3 }} />
      ))}
    </div>
  );
}

export function BlurBox({ children, label = "Not Live Yet", style = {} }) {
  const t = useTheme();
  return (
    <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", ...style }}>
      <div style={{ filter: "blur(7px)", pointerEvents: "none", userSelect: "none" }}>{children}</div>
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", gap: 6, background: `${t.bg}88`, backdropFilter: "blur(2px)",
        borderRadius: 12, border: `1px dashed ${t.amber}44`
      }}>
        <EyeOff size={16} color={t.amber} />
        <span style={{ fontSize: 11, fontWeight: 800, color: t.amber, letterSpacing: 1, textTransform: "uppercase" }}>{label}</span>
      </div>
    </div>
  );
}

export function WalletGate({ children, openWallet }) {
  const t = useTheme(); const { connected } = useWallet();
  if (connected) return children;
  return (
    <div style={{ position: "relative", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ filter: "blur(10px)", pointerEvents: "none", userSelect: "none" }}>{children}</div>
      <div style={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", gap: 12, background: `${t.bg}cc`, backdropFilter: "blur(4px)"
      }}>
        <Lock size={28} color={t.accent} />
        <div style={{ fontSize: 15, fontWeight: 700, color: t.white }}>Connect Your Wallet</div>
        <div style={{ fontSize: 13, color: t.textMuted }}>View your position and stake</div>
        <Btn primary onClick={openWallet}><Wallet size={14} /> Connect Wallet</Btn>
      </div>
    </div>
  );
}

const NEAR_WALLETS = [
  { name: "NEAR Wallet", id: "near-wallet", icon: "🟢", desc: "Official NEAR wallet", color: "#00c08b" },
  { name: "MyNearWallet", id: "my-near-wallet", icon: "🔵", desc: "web.mynearwallet.com", color: "#3b82f6" },
  { name: "Meteor Wallet", id: "meteor-wallet", icon: "⚡", desc: "meteor.toml", color: "#f59e0b" },
  { name: "HERE Wallet", id: "here-wallet", icon: "📍", desc: "herewallet.app", color: "#10b981" },
  { name: "Sender Wallet", id: "sender-wallet", icon: "📨", desc: "senderwallet.io", color: "#8b5cf6" },
];

export function WalletModal({ onClose, onConnect }) {
  const t = useTheme(); const [connecting, setConnecting] = useState(null);
  const connect = (wallet) => {
    setConnecting(wallet.id);
    setTimeout(() => {
      onConnect({ address: "ironshield.near", wallet: wallet.name });
    }, 1400);
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(6px)" }}>
      <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 20, padding: 32, width: 420, maxWidth: "90vw", boxShadow: `0 24px 80px rgba(0,0,0,0.5)` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: t.white }}>Connect Wallet</div>
            <div style={{ fontSize: 13, color: t.textMuted, marginTop: 3 }}>Select your NEAR wallet to continue</div>
          </div>
          <button onClick={onClose} style={{ background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: t.textMuted }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {NEAR_WALLETS.map(w => (
            <button key={w.id} onClick={() => connect(w)} disabled={!!connecting} style={{
              display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", borderRadius: 12,
              border: `1px solid ${connecting === w.id ? w.color : t.border}`,
              background: connecting === w.id ? `${w.color}12` : t.bgSurface,
              cursor: connecting ? "wait" : "pointer", transition: "all 0.2s", textAlign: "left"
            }}
            onMouseEnter={e => { if (!connecting) { e.currentTarget.style.borderColor = w.color; e.currentTarget.style.background = `${w.color}10`; }}}
            onMouseLeave={e => { if (connecting !== w.id) { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.background = t.bgSurface; }}}
            >
              <div style={{ width: 38, height: 38, borderRadius: 10, background: `${w.color}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{w.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: t.white }}>{w.name}</div>
                <div style={{ fontSize: 12, color: t.textDim }}>{w.desc}</div>
              </div>
              {connecting === w.id
                ? <div style={{ width: 18, height: 18, border: `2px solid ${w.color}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.6s linear infinite" }} />
                : <ChevronRight size={16} color={t.textDim} />
              }
            </button>
          ))}
        </div>
        <div style={{ marginTop: 20, padding: "12px 14px", background: t.bgSurface, borderRadius: 10, fontSize: 12, color: t.textDim, lineHeight: 1.6 }}>
          🔒 <strong style={{ color: t.textMuted }}>Non-custodial.</strong> We never store your keys. Connection is handled via NEAR Wallet Selector.
        </div>
      </div>
    </div>
  );
}
