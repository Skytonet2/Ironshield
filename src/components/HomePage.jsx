"use client";
import { Shield, Wallet, Trophy, Lock, TrendingUp, Zap, Brain, Vote } from "lucide-react";
import { Badge, Btn, Section } from "./Primitives";
import { useTheme, useWallet } from "@/lib/contexts";

export default function HomePage({ setPage, openWallet }) {
  const t = useTheme();
  const { connected } = useWallet();

  const stats = [
    { n: "2,800+", l: "Communities Powered" },
    { n: "24/7",   l: "Autonomous Operation" },
    { n: "$NEAR",  l: "Real Yield to Stakers" },
    { n: "100%",   l: "On-Chain Governance" },
  ];

  const features = [
    {
      icon: Brain,
      title: "AI Agent Intelligence",
      desc: "IronClaw operates autonomously inside Telegram and Discord — summarizing alpha, researching tokens, verifying claims, and monitoring your portfolio in real time.",
      color: t.accent,
    },
    {
      icon: Shield,
      title: "Community Protection",
      desc: "Every message scanned. Phishing links, impersonators, and coordinated attacks stopped before they reach your community — without lifting a finger.",
      color: t.green,
    },
    {
      icon: Vote,
      title: "Token Holder Governance",
      desc: "Stake $IRONCLAW and vote on IronClaw's missions, AI prompts, and capabilities. The community controls the agent — fully on-chain, fully autonomous.",
      color: "#ff6b00",
    },
    {
      icon: TrendingUp,
      title: "Stake & Earn Real Yield",
      desc: "Protocol revenue from IronShield subscriptions flows directly to stakers. No inflation — real fees, real yield, distributed every block.",
      color: t.amber,
    },
  ];

  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <div style={{
        minHeight: "92vh", display: "flex", alignItems: "center", position: "relative",
        background: `radial-gradient(ellipse at 20% 0%, ${t.accent}14 0%, transparent 55%),
                     radial-gradient(ellipse at 80% 100%, #ff6b0009 0%, transparent 50%)`,
      }}>
        <Section style={{ padding: "130px 24px 80px" }}>
          <div style={{ maxWidth: 720 }}>
            <Badge color={t.green}>LIVE ON NEAR PROTOCOL</Badge>

            <h1 style={{ fontSize: 58, fontWeight: 800, color: t.white, lineHeight: 1.08, marginTop: 20, letterSpacing: "-1.5px" }}>
              The AI Agent<br />
              <span style={{ color: t.accent }}>Built for Web3</span><br />
              Communities.
            </h1>

            <p style={{ fontSize: 17, color: t.textMuted, marginTop: 20, lineHeight: 1.7, maxWidth: 560 }}>
              IronClaw is an autonomous AI agent that lives inside your Telegram and Discord.
              It protects, researches, summarizes, and executes — governed entirely by $IRONCLAW token holders on NEAR Protocol.
            </p>

            {/* Capability pills */}
            <div style={{ display: "flex", gap: 8, marginTop: 24, flexWrap: "wrap" }}>
              {["Security", "Alpha Research", "Token Analysis", "Portfolio Tracking", "Claim Verification", "Community Governance"].map((pill, i) => (
                <span key={i} style={{
                  fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 20,
                  background: i === 5 ? "rgba(255,107,0,0.12)" : `${t.accent}12`,
                  border: `1px solid ${i === 5 ? "rgba(255,107,0,0.3)" : t.accent + "30"}`,
                  color: i === 5 ? "#ff6b00" : t.accent,
                }}>{pill}</span>
              ))}
            </div>

            <div style={{ display: "flex", gap: 14, marginTop: 36, flexWrap: "wrap" }}>
              <Btn primary onClick={() => setPage("Staking")} style={{ fontSize: 15, padding: "14px 32px" }}>
                <Shield size={16} /> Stake & Earn
              </Btn>
              {!connected
                ? <Btn onClick={openWallet} style={{ fontSize: 15, padding: "14px 32px" }}>
                    <Wallet size={16} /> Connect Wallet
                  </Btn>
                : <Btn onClick={() => setPage("Governance")} style={{ fontSize: 15, padding: "14px 32px", borderColor: "#ff6b0044", color: "#ff6b00" }}>
                    <Vote size={16} /> Vote on Missions
                  </Btn>
              }
            </div>
          </div>

          {/* Stats */}
          <div style={{ marginTop: 64, display: "flex", gap: 32, flexWrap: "wrap" }}>
            {stats.map((s, i) => (
              <div key={i} style={{ borderLeft: `2px solid ${t.accent}33`, paddingLeft: 18 }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: t.white, fontFamily: "'JetBrains Mono', monospace" }}>{s.n}</div>
                <div style={{ fontSize: 13, color: t.textMuted }}>{s.l}</div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* ── What IronClaw Does ────────────────────────────────── */}
      <Section>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <Badge>PLATFORM</Badge>
          <h2 style={{ fontSize: 34, fontWeight: 700, color: t.white, marginTop: 12 }}>One Agent. Every Use Case.</h2>
          <p style={{ fontSize: 15, color: t.textMuted, marginTop: 8, maxWidth: 480, margin: "8px auto 0" }}>
            IronClaw operates across security, intelligence, and governance — all inside the chats you already use.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
          {features.map((f, i) => (
            <div key={i}
              style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14, padding: 28, transition: "all 0.3s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = f.color; e.currentTarget.style.transform = "translateY(-4px)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.transform = ""; }}
            >
              <div style={{ background: `${f.color}18`, borderRadius: 10, width: 46, height: 46, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                <f.icon size={22} color={f.color} />
              </div>
              <div style={{ fontSize: 17, fontWeight: 600, color: t.white, marginBottom: 8 }}>{f.title}</div>
              <div style={{ fontSize: 14, color: t.textMuted, lineHeight: 1.65 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── How It Works ─────────────────────────────────────── */}
      <Section style={{ borderTop: `1px solid ${t.border}` }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <Badge color="#ff6b00">AUTONOMOUS GOVERNANCE</Badge>
          <h2 style={{ fontSize: 34, fontWeight: 700, color: t.white, marginTop: 12 }}>You Control the Agent</h2>
          <p style={{ fontSize: 15, color: t.textMuted, marginTop: 8, maxWidth: 500, margin: "8px auto 0" }}>
            Token holders vote on what IronClaw does. Winning proposals update the AI automatically — no team intervention needed.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          {[
            { step: "01", title: "Stake $IRONCLAW",    desc: "Lock tokens to earn yield and gain voting power proportional to your stake.", color: t.accent },
            { step: "02", title: "Submit a Proposal",  desc: "Propose a new mission, AI prompt update, or capability change for IronClaw.", color: "#9b5de5" },
            { step: "03", title: "Community Votes",    desc: "72-hour voting window. Voting power equals staked amount. 51% to pass.", color: "#ff6b00" },
            { step: "04", title: "IronClaw Executes",  desc: "Passed proposals update IronClaw's behavior automatically, on-chain, no middlemen.", color: t.green },
          ].map((s, i) => (
            <div key={i} style={{ background: t.bgCard, border: `1px solid ${s.color}22`, borderLeft: `3px solid ${s.color}`, borderRadius: 12, padding: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: s.color, letterSpacing: 2, marginBottom: 10 }}>STEP {s.step}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: t.white, marginBottom: 8 }}>{s.title}</div>
              <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.6 }}>{s.desc}</div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div style={{ textAlign: "center", marginTop: 40 }}>
          <Btn primary onClick={() => setPage("Governance")} style={{ fontSize: 15, padding: "14px 36px", background: "#ff6b00" }}>
            <Vote size={16} /> Open Governance
          </Btn>
        </div>
      </Section>

      {/* ── IronClaw Commands ─────────────────────────────────── */}
      <Section style={{ borderTop: `1px solid ${t.border}` }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <Badge color={t.accent}>TELEGRAM + DISCORD</Badge>
          <h2 style={{ fontSize: 34, fontWeight: 700, color: t.white, marginTop: 12 }}>Ask IronClaw Anything</h2>
          <p style={{ fontSize: 15, color: t.textMuted, marginTop: 8 }}>Works inside your existing chats. No app switching required.</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
          {[
            { cmd: "/research PEPE",        desc: "Full token report — metrics, risks, trust score, red flags", color: t.accent },
            { cmd: "/summary @alphacalls",  desc: "Summarize any public Telegram group in 30 seconds", color: t.green },
            { cmd: "/verify [claim]",       desc: "Fact-check any claim made in your chat against live data", color: t.amber },
            { cmd: "/portfolio",            desc: "View your multi-wallet portfolio with 24h P&L", color: "#9b5de5" },
            { cmd: "Auto: link scanning",   desc: "Every URL in protected groups scanned silently in real time", color: t.accent },
            { cmd: "Auto: wallet alerts",   desc: "Flagged wallet addresses detected and warned before any funds move", color: t.green },
          ].map((c, i) => (
            <div key={i} style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12, padding: 20, display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div style={{ background: `${c.color}15`, borderRadius: 8, padding: "6px 10px", flexShrink: 0 }}>
                <Zap size={14} color={c.color} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: c.color, fontFamily: "'JetBrains Mono', monospace", marginBottom: 5 }}>{c.cmd}</div>
                <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>{c.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ── Tokenomics ───────────────────────────────────────── */}
      <Section style={{ borderTop: `1px solid ${t.border}` }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <Badge color={t.accent}>TOKENOMICS</Badge>
          <h2 style={{ fontSize: 34, fontWeight: 700, color: t.white, marginTop: 12 }}>The $IRONCLAW Token</h2>
          <p style={{ fontSize: 15, color: t.textMuted, marginTop: 8 }}>Sustainable architecture built for long-term protocol growth.</p>
        </div>
        <div className="grid-wrap-2" style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: 48, alignItems: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", position: "relative" }}>
            <style>{`@keyframes spin-chart { 100% { transform: rotate(270deg); } }`}</style>
            <div style={{ position: "relative", width: 280, height: 280 }}>
              <svg width="100%" height="100%" viewBox="0 0 42 42" style={{ transform: "rotate(-90deg)", animation: "spin-chart 40s linear infinite", borderRadius: "50%", filter: "drop-shadow(0 0 20px rgba(0,0,0,0.5))" }}>
                <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#e8581a" strokeWidth="6" strokeDasharray="35 65" strokeDashoffset="0" />
                <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#2eb87a" strokeWidth="6" strokeDasharray="20 80" strokeDashoffset="-35" />
                <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#d4a843" strokeWidth="6" strokeDasharray="15 85" strokeDashoffset="-55" />
                <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#5a9fd4" strokeWidth="6" strokeDasharray="10 90" strokeDashoffset="-70" />
                <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#8b6fc4" strokeWidth="6" strokeDasharray="12 88" strokeDashoffset="-80" />
                <circle cx="21" cy="21" r="15.91549430918954" fill="transparent" stroke="#3a4a5c" strokeWidth="6" strokeDasharray="8 92" strokeDashoffset="-92" />
              </svg>
              <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: 180, height: 180, background: t.bg, borderRadius: "50%", zIndex: 1, boxShadow: `inset 0 0 20px ${t.border}` }} />
              <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 2, textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: t.white }}>$IRON</div>
                <div style={{ fontSize: 10, color: t.textDim }}>CLAW</div>
              </div>
            </div>
          </div>
          <div>
            {[
              { val: "35%", label: "Community & Staking Rewards", note: "Emitted over 60 months, halving at Year 2 + Year 4", color: "#e8581a" },
              { val: "20%", label: "Treasury",                    note: "12-month cliff · 48-month linear vest · multisig",  color: "#2eb87a" },
              { val: "15%", label: "Team & Advisors",             note: "12-month cliff · 36-month linear vest · milestone gates", color: "#d4a843" },
              { val: "12%", label: "Public Sale",                 note: "15% at TGE · remainder over 12 months",            color: "#8b6fc4" },
              { val: "10%", label: "Liquidity",                   note: "20% at TGE for DEX · remainder over 24 months",    color: "#5a9fd4" },
              { val: "8%",  label: "Private / Seed",              note: "6-month cliff · 24-month linear vest",             color: "#3a4a5c" },
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
          {[
            { label: "TOTAL SUPPLY", value: "1,000,000,000", mono: true },
            { label: "SUPPLY TYPE",  value: "Fixed · No Mint" },
            { label: "EMISSION",     value: "5 Years Declining" },
          ].map((c, i) => (
            <div key={i} style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12, padding: 24, textAlign: "center" }}>
              <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 8, fontWeight: 600, letterSpacing: 1 }}>{c.label}</div>
              <div style={{ fontSize: c.mono ? 20 : 20, fontWeight: 800, color: t.white, fontFamily: c.mono ? "'JetBrains Mono', monospace" : "inherit" }}>{c.value}</div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
