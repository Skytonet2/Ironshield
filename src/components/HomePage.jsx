"use client";
import { Shield, Wallet, Vote, Cpu, Coins } from "lucide-react";
import { Badge, Btn, Section } from "./Primitives";
import { useTheme, useWallet } from "@/lib/contexts";

import {
  IlliaQuote,
  WhatIsIronClaw,
  FinalCTA,
} from "./IronClawSections";

export default function HomePage({ setPage, openWallet }) {
  const t = useTheme();
  const { connected } = useWallet();

  /* Hero stat counters: mirror the thesis: autonomous, token-governed, revenue-generating. */
  const stats = [
    { n: "24/7",  l: "Autonomous Operation" },
    { n: "100%",  l: "On-Chain Governance" },
    { n: "$NEAR", l: "Real Revenue to Stakers" },
    { n: "1 BN",  l: "Fixed $IRONCLAW Supply" },
  ];

  /* Three badges capture the core product thesis per the IronClaw spec. */
  const heroBadges = [
    { label: "Autonomous",         color: t.accent,  icon: Cpu },
    { label: "Token Governed",     color: "#9b5de5", icon: Vote },
    { label: "Revenue Generating", color: t.green,   icon: Coins },
  ];

  return (
    <div>
      {/* ─────────────────────────────────────────────
          HERO :  community-governed autonomous agent
          ───────────────────────────────────────────── */}
      <div style={{
        minHeight: "92vh", display: "flex", alignItems: "center", position: "relative",
        background: `radial-gradient(ellipse at 20% 0%, ${t.accent}14 0%, transparent 55%),
                     radial-gradient(ellipse at 80% 100%, #9b5de509 0%, transparent 50%)`,
      }}>
        <Section style={{ padding: "130px 24px 80px" }}>
          <div style={{ maxWidth: 780 }}>
            <Badge color={t.green}>LIVE ON NEAR PROTOCOL</Badge>

            <h1 style={{ fontSize: 58, fontWeight: 800, color: t.white, lineHeight: 1.08, marginTop: 20, letterSpacing: "-1.5px" }}>
              IronClaw <br />
              <span style={{ color: t.accent }}>Community-Governed</span><br />
              Autonomous Agent.
            </h1>

            <p style={{ fontSize: 18, color: t.textMuted, marginTop: 22, lineHeight: 1.7, maxWidth: 620 }}>
              The NEAR ecosystem's AI agent. <span style={{ color: t.white, fontWeight: 600 }}>Governed by holders.</span>{" "}
              <span style={{ color: t.white, fontWeight: 600 }}>Funded by missions.</span>{" "}
              <span style={{ color: t.white, fontWeight: 600 }}>Defended by data.</span>
            </p>

            {/* Thesis badges */}
            <div style={{ display: "flex", gap: 10, marginTop: 26, flexWrap: "wrap" }}>
              {heroBadges.map((b, i) => (
                <div key={i} style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  background: `${b.color}14`,
                  border: `1px solid ${b.color}44`,
                  color: b.color,
                  padding: "8px 16px", borderRadius: 999,
                  fontSize: 13, fontWeight: 700, letterSpacing: 0.3,
                }}>
                  <b.icon size={14} />
                  {b.label}
                </div>
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
                : <Btn onClick={() => setPage("Governance")} style={{ fontSize: 15, padding: "14px 32px", borderColor: "#9b5de544", color: "#9b5de5" }}>
                    <Vote size={16} /> Vote on Missions
                  </Btn>
              }
            </div>
          </div>

          {/* Stats rail */}
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

      {/* ─── Illia quote: anchors the entire thesis ─── */}
      <IlliaQuote />

      {/* ─── What Is IronClaw: 3 principles + 6 specializations ─── */}
      <WhatIsIronClaw />

      {/* ─────────────────────────────────────────────
          TOKENOMICS OVERVIEW :  supply split + donut
          Deep-dive (fees, staking tiers, governance params)
          lives on the Staking page.
          ───────────────────────────────────────────── */}
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
              <div style={{ fontSize: 20, fontWeight: 800, color: t.white, fontFamily: c.mono ? "'JetBrains Mono', monospace" : "inherit" }}>{c.value}</div>
            </div>
          ))}
        </div>

        {/* Pointer: deep-dive lives on Staking page */}
        <div style={{ textAlign: "center", marginTop: 32 }}>
          <Btn onClick={() => setPage("Staking")} style={{ fontSize: 13, padding: "10px 22px" }}>
            View Full Tokenomics on Staking →
          </Btn>
        </div>
      </Section>

      {/* ─── Final CTA: join the community, launch the bot ─── */}
      <FinalCTA />
    </div>
  );
}
