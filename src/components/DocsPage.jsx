"use client";
import { Badge, Section } from "./Primitives";
import { useTheme } from "@/lib/contexts";
import { Shield, Bot, Lock, Vote, Coins, BarChart3, AlertTriangle, Zap, Globe, Users } from "lucide-react";
import { TechArchitecture, WhatIsIronClaw, TokenomicsDeep, LaunchScope } from "./IronClawSections";

const MASCOT_IMG = "/mascot.png";

export default function DocsPage() {
  const t = useTheme();

  const sections = [
    {
      id: "overview",
      icon: <Shield size={20} color={t.accent} />,
      title: "What is IronShield?",
      content: [
        "IronShield is a decentralized AI security and intelligence platform built on NEAR Protocol. At its core is IronClaw: an autonomous AI agent that operates inside Telegram and Discord communities, providing real-time threat detection, token research, portfolio tracking, and governance: all controlled by token holders on-chain.",
        "Unlike traditional security tools that require constant manual oversight, IronClaw is always-on, always-learning, and community-governed. Every mission it runs, every prompt it follows, and every capability it unlocks is decided by $IRONCLAW stakers through on-chain proposals.",
      ],
    },
    {
      id: "ironclaw",
      icon: <Bot size={20} color={t.accent} />,
      title: "IronClaw AI Agent",
      content: [
        "IronClaw is the autonomous AI agent at the heart of IronShield. Powered by NEAR AI, it operates 24/7 inside your community chats without any manual intervention.",
      ],
      features: [
        { label: "/research [token]", desc: "Full token report: price, market cap, liquidity, audit status, risk flags, and trust score" },
        { label: "/summary [group]", desc: "Summarize any public Telegram group's recent conversation into key points, tokens mentioned, and red flags" },
        { label: "/verify [claim]", desc: "Fact-check any claim against live data: returns verdict (Verified/False/Unverified) with sources" },
        { label: "/portfolio", desc: "Multi-wallet portfolio view with 24h P&L, token breakdown, and risk alerts" },
        { label: "/scan [url/wallet]", desc: "Scan any URL or wallet address against known phishing, scam, and malicious databases" },
        { label: "/alert [token] [condition]", desc: "Set price alerts: get notified when a token hits your target via DM" },
        { label: "Auto: Link Scanning", desc: "Every URL shared in protected groups is silently scanned in real time" },
        { label: "Auto: Wallet Alerts", desc: "Flagged wallet addresses detected and warned before funds move" },
      ],
    },
    {
      id: "security",
      icon: <Lock size={20} color={t.accent} />,
      title: "Security Engine",
      content: [
        "IronShield's security engine runs continuously across all protected communities. It maintains a growing database of flagged URLs, malicious wallet addresses, known phishing patterns, and scam signatures.",
        "When a threat is detected: whether it's a phishing link, an impersonator, or a flagged wallet: IronClaw acts immediately: the message is flagged, the community is warned, and the threat is logged for future reference. Community members can also submit reports via the /report command or the Telegram bot.",
      ],
      stats: [
        { label: "Phishing Detection", value: "Real-time URL scanning against known threat databases" },
        { label: "Wallet Screening", value: "Cross-reference addresses with flagged wallet registries" },
        { label: "Impersonation Detection", value: "Pattern matching against admin names and profile signatures" },
        { label: "Community Reporting", value: "Crowdsourced threat intel via /report command" },
      ],
    },
    {
      id: "governance",
      icon: <Vote size={20} color={t.accent} />,
      title: "On-Chain Governance",
      content: [
        "IronShield is fully governed by its token holders. Anyone who stakes $IRONCLAW tokens gains voting power proportional to their stake. Governance proposals can modify IronClaw's behavior in real-time: no team intervention required.",
      ],
      steps: [
        { step: "01", title: "Stake $IRONCLAW", desc: "Lock tokens in the staking contract to earn yield and gain voting power." },
        { step: "02", title: "Submit a Proposal", desc: "Propose a new mission, AI prompt update, or capability change. Types include: prompt_update, mission_update, config_change, and general." },
        { step: "03", title: "Community Votes", desc: "72-hour voting window. Voting power equals staked amount across all pools. 51% quorum required to pass." },
        { step: "04", title: "Auto-Execution", desc: "Passed proposals are executed on-chain. A governance listener picks up the event and updates IronClaw's active prompt or mission file automatically." },
      ],
    },
    {
      id: "staking",
      icon: <Coins size={20} color={t.accent} />,
      title: "Staking & Yield",
      content: [
        "IronShield uses a MasterChef-style staking mechanism designed for NEAR Protocol. Once the $IRONCLAW token launches, stakers will earn real yield from protocol revenue: not inflation.",
        "Revenue from IronShield subscriptions, premium features, and ecosystem fees flows into the reward pool. Rewards are distributed per-block proportional to each staker's share of the pool. Stakers can also earn bonus points through contests and community participation.",
      ],
      stats: [
        { label: "Contract", value: "TBA: will be deployed at launch" },
        { label: "Reward Source", value: "Protocol revenue (real yield, not inflation)" },
        { label: "Distribution", value: "Per-block, proportional to stake" },
        { label: "Governance Power", value: "Voting power = total staked across all pools" },
      ],
    },
    {
      id: "contests",
      icon: <BarChart3 size={20} color={t.accent} />,
      title: "Contests & Earn",
      content: [
        "IronShield runs community contests (missions) where participants can earn points and climb the leaderboard. Missions range from bug bounties and security reports to content creation and community engagement.",
        "When you participate in a contest, you submit proof of your work (a link, screenshot, or description). Submissions are reviewed by admins. Approved submissions earn you points that determine your tier and leaderboard rank.",
      ],
      steps: [
        { step: "01", title: "Browse Missions", desc: "Visit the Earn page to see active contests with descriptions, rewards, and difficulty levels." },
        { step: "02", title: "Submit Proof", desc: "Click Participate, provide a proof link (URL to your work), optional notes, and an optional screenshot." },
        { step: "03", title: "Admin Review", desc: "Submissions are reviewed. Approved entries earn points; rejected ones include feedback." },
        { step: "04", title: "Climb the Leaderboard", desc: "Points accumulate across all contests. Higher scores unlock tiers: Bronze, Silver, Gold, Diamond." },
      ],
      callout: "Submissions are stored in the IronShield database and accessible via the admin panel (Dashboard Settings in the footer) and the backend API at /api/contests/:id (includes all submissions with user data).",
    },
    {
      id: "architecture",
      icon: <Zap size={20} color={t.accent} />,
      title: "Technical Architecture",
      content: [
        "IronShield is a full-stack decentralized application combining a static frontend hosted on IPFS via NEAR's web4, a Node.js backend with PostgreSQL, a Telegram bot, and a Rust smart contract on NEAR mainnet.",
      ],
      stats: [
        { label: "Frontend", value: "Next.js 16 + React 19, static export to IPFS via web4-deploy" },
        { label: "Backend API", value: "Express.js on port 3001: contests, leaderboard, governance, security endpoints" },
        { label: "Database", value: "PostgreSQL: users, wallets, contests, submissions, proposals, votes, flagged URLs/wallets" },
        { label: "AI Engine", value: "NEAR AI Cloud API (cloud-api.near.ai): LLaMA 3.1 70B for all agent tasks" },
        { label: "Telegram Bot", value: "node-telegram-bot-api: polling mode for dev, webhook for production" },
        { label: "Smart Contract", value: "Rust (near-sdk v5.1.0): MasterChef staking, NEP-141 rewards, on-chain governance (deploying at launch)" },
        { label: "Hosting", value: "IPFS via NEARFS, served at ironshield.near.page" },
        { label: "Governance Listener", value: "Polls chain for executed proposals, auto-updates agent prompt/mission" },
      ],
    },
    {
      id: "tokenomics",
      icon: <Globe size={20} color={t.accent} />,
      title: "$IRONCLAW Token",
      content: [
        "$IRONCLAW is the native NEP-141 token of the IronShield ecosystem on NEAR Protocol. It serves three core functions: governance voting power, staking yield, and access to premium features.",
        "Token holders who stake $IRONCLAW earn real yield from protocol revenue and gain proportional voting power in governance. The token is the backbone of the community-controlled AI agent model.",
      ],
      stats: [
        { label: "Standard", value: "NEP-141 (NEAR fungible token)" },
        { label: "Chain", value: "NEAR Protocol (mainnet)" },
        { label: "Utility", value: "Governance votes, staking yield, premium access" },
        { label: "Contract", value: "TBA: deploying at token launch" },
      ],
    },
    {
      id: "community",
      icon: <Users size={20} color={t.accent} />,
      title: "Community & Links",
      content: [
        "IronShield is built by and for the NEAR community. Join us to participate in governance, earn rewards through contests, and help protect Web3 communities.",
      ],
      links: [
        { label: "Telegram Community", url: "https://t.me/IronClawHQ" },
        { label: "X (Twitter)", url: "https://x.com/_IronClaw" },
        { label: "IronShield Bot", url: "https://t.me/IronShieldCore_bot" },
        { label: "NEAR Protocol", url: "https://near.org" },
        { label: "Live App", url: "https://ironshield.near.page" },
      ],
    },
  ];

  return (
    <>
    <Section style={{ paddingTop: 100, paddingBottom: 60 }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <Badge>DOCUMENTATION</Badge>
        <h1 style={{ fontSize: 36, fontWeight: 800, color: t.white, marginTop: 12 }}>
          IronShield <span style={{ color: t.accent }}>Docs</span>
        </h1>
        <p style={{ fontSize: 15, color: t.textMuted, marginTop: 10, maxWidth: 560, margin: "10px auto 0" }}>
          Everything you need to know about IronShield, IronClaw, governance, staking, and the ecosystem.
        </p>
      </div>

      {/* Table of Contents */}
      <div style={{
        background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 16,
        padding: "20px 28px", marginBottom: 40, maxWidth: 700, margin: "0 auto 40px",
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: t.accent, letterSpacing: 1, marginBottom: 12 }}>TABLE OF CONTENTS</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              style={{
                fontSize: 13, color: t.textMuted, textDecoration: "none",
                padding: "6px 14px", borderRadius: 8, border: `1px solid ${t.border}`,
                background: t.bgSurface, transition: "all 0.2s", cursor: "pointer",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = t.accent; e.currentTarget.style.color = t.accent; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.color = t.textMuted; }}
            >
              {s.title}
            </a>
          ))}
        </div>
      </div>

      {/* Sections */}
      <div style={{ maxWidth: 800, margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 }}>
        {sections.map((s) => (
          <div
            key={s.id}
            id={s.id}
            style={{
              background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 16,
              padding: 32, transition: "border-color 0.3s",
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = `${t.accent}44`}
            onMouseLeave={e => e.currentTarget.style.borderColor = t.border}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, background: `${t.accent}15`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {s.icon}
              </div>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: t.white, margin: 0 }}>{s.title}</h2>
            </div>

            {s.content.map((p, i) => (
              <p key={i} style={{ fontSize: 14, color: t.textMuted, lineHeight: 1.75, margin: i === 0 ? 0 : "12px 0 0" }}>{p}</p>
            ))}

            {/* Command features list */}
            {s.features && (
              <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
                {s.features.map((f, i) => (
                  <div key={i} style={{
                    display: "flex", gap: 14, alignItems: "flex-start",
                    padding: "12px 16px", borderRadius: 10, background: t.bgSurface,
                    border: `1px solid ${t.border}`,
                  }}>
                    <code style={{
                      fontSize: 12, fontWeight: 700, color: t.accent, whiteSpace: "nowrap",
                      fontFamily: "'JetBrains Mono', monospace", flexShrink: 0, minWidth: 160,
                    }}>{f.label}</code>
                    <span style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>{f.desc}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Steps */}
            {s.steps && (
              <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                {s.steps.map((st, i) => (
                  <div key={i} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: "50%", flexShrink: 0,
                      background: `${t.accent}18`, border: `1px solid ${t.accent}44`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, fontWeight: 800, color: t.accent, fontFamily: "'JetBrains Mono', monospace",
                    }}>{st.step}</div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: t.white }}>{st.title}</div>
                      <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.6, marginTop: 2 }}>{st.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Stats / key-value pairs */}
            {s.stats && (
              <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
                {s.stats.map((st, i) => (
                  <div key={i} style={{
                    padding: "12px 16px", borderRadius: 10, background: t.bgSurface,
                    border: `1px solid ${t.border}`,
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: t.accent, letterSpacing: 0.5, marginBottom: 4 }}>{st.label}</div>
                    <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>{st.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Links */}
            {s.links && (
              <div style={{ marginTop: 20, display: "flex", flexWrap: "wrap", gap: 10 }}>
                {s.links.map((l, i) => (
                  <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" style={{
                    fontSize: 13, fontWeight: 600, color: t.accent, textDecoration: "none",
                    padding: "10px 20px", borderRadius: 10, background: `${t.accent}12`,
                    border: `1px solid ${t.accent}33`, transition: "all 0.2s",
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = `${t.accent}22`; }}
                    onMouseLeave={e => { e.currentTarget.style.background = `${t.accent}12`; }}
                  >{l.label}</a>
                ))}
              </div>
            )}

            {/* Callout box */}
            {s.callout && (
              <div style={{
                marginTop: 20, padding: "14px 18px", borderRadius: 10,
                background: `${t.amber}10`, border: `1px solid ${t.amber}33`,
                display: "flex", gap: 10, alignItems: "flex-start",
              }}>
                <AlertTriangle size={16} color={t.amber} style={{ flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: 13, color: t.amber, lineHeight: 1.6 }}>{s.callout}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>

    {/* ─── The agent model / specializations ─── */}
    <WhatIsIronClaw />

    {/* ─── Tech architecture: governance, agent core, revenue layers ─── */}
    <TechArchitecture />

    {/* ─── Tokenomics deep dive ─── */}
    <TokenomicsDeep />

    {/* ─── Launch scope ─── */}
    <LaunchScope />
    </>
  );
}
