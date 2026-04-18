"use client";
import { Shield, Wallet, Vote, Cpu, Coins, Feather } from "lucide-react";
import { Badge, Btn, Section } from "./Primitives";
import { useTheme, useWallet } from "@/lib/contexts";

import {
  IlliaQuote,
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
                : <Btn onClick={() => setPage("Feed")} style={{ fontSize: 15, padding: "14px 32px", borderColor: `${t.accent}66`, color: t.accent }}>
                    <Feather size={16} /> IronFeed
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

      {/* Tokenomics + agent model now live in Docs. */}

      {/* ─── Final CTA: join the community, launch the bot ─── */}
      <FinalCTA />
    </div>
  );
}
