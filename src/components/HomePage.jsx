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
    </div>
  );
}
