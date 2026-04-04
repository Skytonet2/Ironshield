"use client";
import { Shield, Wallet, Trophy, Lock, TrendingUp } from "lucide-react";
import { Badge, Btn, Section } from "./Primitives";
import { useTheme, useWallet } from "@/lib/contexts";

export default function HomePage({ setPage, openWallet }) {
  const t = useTheme(); const { connected } = useWallet();
  const stats = [
    { n: "14,200+", l: "Threats Blocked" }, { n: "2,800+", l: "Communities Protected" },
    { n: "$0", l: "Lost to Hacks", sub: "via IronShield" }, { n: "99.2%", l: "Detection Accuracy" },
  ];
  return (
    <div>
      <div style={{ minHeight: "92vh", display: "flex", alignItems: "center", position: "relative", background: `radial-gradient(ellipse at 20% 0%, ${t.accent}14 0%, transparent 55%), radial-gradient(ellipse at 80% 100%, ${t.green}09 0%, transparent 50%)` }}>
        <Section style={{ padding: "130px 24px 80px" }}>
          <div style={{ maxWidth: 700 }}>
            <Badge color={t.green}>✦ LIVE ON NEAR PROTOCOL</Badge>
            <h1 style={{ fontSize: 58, fontWeight: 800, color: t.white, lineHeight: 1.08, marginTop: 20, letterSpacing: "-1.5px" }}>
              AI Security.<br /><span style={{ color: t.accent }}>On-Chain.</span><br />Unstoppable.
            </h1>
            <p style={{ fontSize: 17, color: t.textMuted, marginTop: 20, lineHeight: 1.7, maxWidth: 540 }}>
              IronShield is an autonomous AI security agent protecting Telegram and Discord communities from scams, phishing, and rug pulls — powered by IronClaw on NEAR.
            </p>
            <div style={{ display: "flex", gap: 14, marginTop: 36, flexWrap: "wrap" }}>
              <Btn primary onClick={() => setPage("Staking")} style={{ fontSize: 15, padding: "14px 32px" }}><Shield size={16} /> Stake & Earn</Btn>
              {!connected
                ? <Btn onClick={openWallet} style={{ fontSize: 15, padding: "14px 32px" }}><Wallet size={16} /> Connect Wallet</Btn>
                : <Btn onClick={() => setPage("Earn")} style={{ fontSize: 15, padding: "14px 32px" }}><Trophy size={16} /> View Missions</Btn>
              }
            </div>
          </div>
          <div style={{ marginTop: 64, display: "flex", gap: 32, flexWrap: "wrap" }}>
            {stats.map((s, i) => (
              <div key={i} style={{ borderLeft: `2px solid ${t.accent}33`, paddingLeft: 18 }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: t.white, fontFamily: "'JetBrains Mono', monospace" }}>{s.n}</div>
                <div style={{ fontSize: 13, color: t.textMuted }}>{s.l}</div>
                {s.sub && <div style={{ fontSize: 11, color: t.green }}>{s.sub}</div>}
              </div>
            ))}
          </div>
        </Section>
      </div>
      <Section>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <Badge>HOW IT WORKS</Badge>
          <h2 style={{ fontSize: 34, fontWeight: 700, color: t.white, marginTop: 12 }}>The IronClaw Ecosystem</h2>
          <p style={{ fontSize: 15, color: t.textMuted, marginTop: 8 }}>Every product feeds the same fee system. Every launch creates a new wave.</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
          {[
            { icon: Shield, title: "AI Threat Detection", desc: "Real-time analysis of every message. Phishing, rugpulls, and impersonators blocked before they strike.", color: t.accent },
            { icon: Lock, title: "Stake & Govern", desc: "Lock your tokens to earn real protocol yield. Vote on AI behavior, treasury, and missions.", color: t.green },
            { icon: Trophy, title: "Earn Missions", desc: "Complete community tasks, submit proof-of-work, and earn $IRONCLAW directly to your wallet.", color: t.amber },
            { icon: TrendingUp, title: "Buy & Sell", desc: "Trade $IRONCLAW on NEAR with deep liquidity through Ref Finance integration.", color: t.accent },
          ].map((f, i) => (
            <div key={i} style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14, padding: 28, transition: "all 0.3s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = f.color; e.currentTarget.style.transform = "translateY(-4px)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.transform = ""; }}>
              <div style={{ background: `${f.color}18`, borderRadius: 10, width: 46, height: 46, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                <f.icon size={22} color={f.color} />
              </div>
              <div style={{ fontSize: 17, fontWeight: 600, color: t.white, marginBottom: 8 }}>{f.title}</div>
              <div style={{ fontSize: 14, color: t.textMuted, lineHeight: 1.65 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </Section>
      <Section style={{ borderTop: `1px solid ${t.border}` }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <Badge color={t.accent}>TOKENOMICS</Badge>
          <h2 style={{ fontSize: 34, fontWeight: 700, color: t.white, marginTop: 12 }}>The $IRON Token</h2>
          <p style={{ fontSize: 15, color: t.textMuted, marginTop: 8 }}>Sustainable architecture built for long-term protocol security.</p>
        </div>
        <div className="grid-wrap-2" style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 48, alignItems: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", position: "relative" }}>
            <style>{`
              @keyframes spin-chart { 100% { transform: rotate(270deg); } }
            `}</style>
            <div style={{ position: "relative", width: 280, height: 280 }}>
              <svg width="100%" height="100%" viewBox="0 0 42 42" style={{ transform: "rotate(-90deg)", animation: "spin-chart 40s linear infinite", borderRadius: "50%", filter: "drop-shadow(0 0 20px rgba(0,0,0,0.5))" }}>
                <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#e8581a" strokeWidth="6" strokeDasharray="35 65" strokeDashoffset="0"></circle>
                <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#2eb87a" strokeWidth="6" strokeDasharray="20 80" strokeDashoffset="-35"></circle>
                <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#d4a843" strokeWidth="6" strokeDasharray="15 85" strokeDashoffset="-55"></circle>
                <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#5a9fd4" strokeWidth="6" strokeDasharray="10 90" strokeDashoffset="-70"></circle>
                <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#8b6fc4" strokeWidth="6" strokeDasharray="12 88" strokeDashoffset="-80"></circle>
                <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#3a4a5c" strokeWidth="6" strokeDasharray="8 92" strokeDashoffset="-92"></circle>
              </svg>
              <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 180, height: 180, background: t.bg, borderRadius: "50%", zIndex: 1, boxShadow: `inset 0 0 20px ${t.border}` }} />
              <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 2, textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: t.white }}>$IRON</div>
              </div>
            </div>
          </div>
          <div>
            {[
              { val: "35%", label: "Community & Staking Rewards", note: "Emitted over 60 months, halving at Year 2 + Year 4", color: "#e8581a" },
              { val: "20%", label: "Treasury", note: "12-month cliff · 48-month linear vest · multisig", color: "#2eb87a" },
              { val: "15%", label: "Team & Advisors", note: "12-month cliff · 36-month linear vest · milestone gates", color: "#d4a843" },
              { val: "12%", label: "Public Sale", note: "15% at TGE · remainder over 12 months", color: "#8b6fc4" },
              { val: "10%", label: "Liquidity", note: "20% at TGE for DEX · remainder over 24 months", color: "#5a9fd4" },
              { val: "8%", label: "Private / Seed", note: "6-month cliff · 24-month linear vest", color: "#3a4a5c" },
            ].map((tok, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
                <div style={{ width: 14, height: 14, borderRadius: 3, background: tok.color, marginRight: 14, flexShrink: 0 }} />
                <div style={{ width: 45, fontWeight: 800, color: t.white }}>{tok.val}</div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: t.white, marginBottom: 2 }}>{tok.label}</div>
                  <div style={{ fontSize: 13, color: t.textDim }}>{tok.note}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginTop: 40 }}>
          <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12, padding: 24, textAlign: "center" }}>
            <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 8, fontWeight: 600, letterSpacing: 1 }}>TOTAL SUPPLY</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: t.white, fontFamily: "'JetBrains Mono', monospace" }}>1,000,000,000</div>
          </div>
          <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12, padding: 24, textAlign: "center" }}>
            <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 8, fontWeight: 600, letterSpacing: 1 }}>SUPPLY TYPE</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: t.white }}>Fixed <span style={{ color: t.textDim }}>· No Mint</span></div>
          </div>
          <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12, padding: 24, textAlign: "center" }}>
            <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 8, fontWeight: 600, letterSpacing: 1 }}>EMISSION WINDOW</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: t.white }}>5 Years <span style={{ color: t.textDim }}>Declining</span></div>
          </div>
        </div>
      </Section>
    </div>
  );
}
