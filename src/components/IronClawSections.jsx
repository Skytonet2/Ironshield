"use client";
/* IronClaw landing-page sections.
   All sections share the existing dark/light theme, Btn/Badge/Section primitives,
   and the lucide-react icon set already used elsewhere on the site. */
import { useState } from "react";
import {
  Shield, Brain, Vote, TrendingUp, Wallet, Lock, Zap, Cpu, Database, Network,
  Crosshair, Search, Coins, FileText, Bug, Compass, DollarSign, Repeat,
  HandCoins, Award, Sparkles, Users, Layers, ServerCog, GitBranch, ScrollText,
  CheckCircle2, ArrowRight, BookOpen, MessageSquare, Code2, ExternalLink,
  Quote, Activity, ShieldCheck, Flame,
} from "lucide-react";
import { Badge, Btn, Section } from "./Primitives";
import { useTheme } from "@/lib/contexts";

/* ─────────────────────────────────────────────────────────────────
   1. HERO ADDITION — Illia quote block (rendered under the existing hero)
   ───────────────────────────────────────────────────────────────── */
export function IlliaQuote() {
  const t = useTheme();
  return (
    <Section style={{ paddingTop: 8, paddingBottom: 32 }}>
      <div style={{
        background: `linear-gradient(135deg, ${t.bgCard}, ${t.bgSurface})`,
        border: `1px solid ${t.accent}33`,
        borderLeft: `4px solid ${t.accent}`,
        borderRadius: 16,
        padding: "28px 32px",
        display: "flex",
        gap: 20,
        alignItems: "flex-start",
        maxWidth: 920,
        margin: "0 auto",
        boxShadow: `0 8px 32px rgba(0,0,0,0.25)`,
      }}>
        <div style={{ flexShrink: 0, background: `${t.accent}18`, borderRadius: 12, padding: 12 }}>
          <Quote size={22} color={t.accent} />
        </div>
        <div>
          <p style={{ fontSize: 17, fontStyle: "italic", color: t.text, lineHeight: 1.6, margin: 0 }}>
            "A true IronClaw must launch in fully autonomous mode and give governance to token holders — deciding on missions and prompt updating."
          </p>
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 2, background: t.accent }} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.white }}>Illia Polosukhin</div>
              <div style={{ fontSize: 11, color: t.textDim, letterSpacing: 0.4 }}>CO-FOUNDER · NEAR PROTOCOL</div>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   2. WHAT IS IRONCLAW — 3 principles + 6 specialization cards
   ───────────────────────────────────────────────────────────────── */
export function WhatIsIronClaw() {
  const t = useTheme();
  const [active, setActive] = useState(0);

  const principles = [
    {
      icon: Crosshair,
      title: "Mission-Based Operation",
      desc: "The community assigns targets and objectives. The agent receives clear directives directly from token holders — security audits, alpha hunting, content production, and beyond.",
      color: t.accent,
    },
    {
      icon: Cpu,
      title: "Fully Autonomous Execution",
      desc: "No manual hand-holding. The agent executes approved missions independently, around the clock, and reports back with on-chain proof of work.",
      color: t.green,
    },
    {
      icon: Vote,
      title: "Community Prompt Control",
      desc: "Token holders vote on prompt updates. Agent behavior evolves under transparent, on-chain prompt versioning — governed, not dictated.",
      color: "#9b5de5",
    },
  ];

  const specs = [
    { icon: ShieldCheck, name: "Security Auditor",  desc: "Scam detection, rug protection, honeypot identification across NEAR dApps and tokens.", color: t.green },
    { icon: Search,      name: "Alpha Hunter",      desc: "Researches protocols, finds opportunities, and surfaces high-conviction insights to the community.", color: t.accent },
    { icon: Coins,       name: "Treasury Manager",  desc: "Manages community funds with risk parameters voted by holders. Performance is on-chain.", color: t.amber },
    { icon: FileText,    name: "Content Engine",    desc: "Produces ecosystem reports, threads, and explainers based on governance-approved direction.", color: "#9b5de5" },
    { icon: Bug,         name: "Bounty Coordinator",desc: "Hunts bugs and inefficiencies across the NEAR dApp landscape and coordinates fixes.", color: "#ff6b00" },
    { icon: Compass,     name: "Deal Flow Scout",   desc: "Surfaces early-stage projects, grant opportunities, and partnership openings before they go public.", color: "#0ea5e9" },
  ];

  return (
    <Section style={{ borderTop: `1px solid ${t.border}` }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <Badge color={t.accent}>THE AGENT MODEL</Badge>
        <h2 style={{ fontSize: 36, fontWeight: 800, color: t.white, marginTop: 12, letterSpacing: "-0.5px" }}>
          What Is IronClaw?
        </h2>
        <p style={{ fontSize: 15, color: t.textMuted, marginTop: 10, maxWidth: 640, margin: "10px auto 0", lineHeight: 1.65 }}>
          A community-governed autonomous agent operating on three core principles. The agent takes its
          orders from holders, executes without intermediaries, and evolves through on-chain governance.
        </p>
      </div>

      {/* 3 principles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18, marginBottom: 56 }}>
        {principles.map((p, i) => (
          <div key={i} style={{
            background: t.bgCard,
            border: `1px solid ${t.border}`,
            borderTop: `3px solid ${p.color}`,
            borderRadius: 14,
            padding: 26,
            transition: "all 0.3s",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = p.color; e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.borderTop = `3px solid ${p.color}`; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.transform = ""; e.currentTarget.style.borderTop = `3px solid ${p.color}`; }}
          >
            <div style={{ background: `${p.color}18`, borderRadius: 10, width: 46, height: 46, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
              <p.icon size={22} color={p.color} />
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: t.white, marginBottom: 8 }}>{p.title}</div>
            <div style={{ fontSize: 14, color: t.textMuted, lineHeight: 1.65 }}>{p.desc}</div>
          </div>
        ))}
      </div>

      {/* 6 specializations */}
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <Badge color="#9b5de5">SPECIALIZATIONS</Badge>
        <h3 style={{ fontSize: 22, fontWeight: 700, color: t.white, marginTop: 10 }}>Six modes. One agent.</h3>
        <p style={{ fontSize: 13, color: t.textDim, marginTop: 6 }}>The community decides which modes IronClaw runs and when.</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
        {specs.map((s, i) => (
          <div key={i}
            onClick={() => setActive(i)}
            style={{
              background: active === i ? `${s.color}10` : t.bgCard,
              border: `1px solid ${active === i ? s.color : t.border}`,
              borderRadius: 12, padding: 20, cursor: "pointer", transition: "all 0.25s",
              display: "flex", gap: 14, alignItems: "flex-start",
            }}
            onMouseEnter={e => { if (active !== i) { e.currentTarget.style.borderColor = `${s.color}88`; e.currentTarget.style.transform = "translateY(-2px)"; }}}
            onMouseLeave={e => { if (active !== i) { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.transform = ""; }}}
          >
            <div style={{ background: `${s.color}18`, borderRadius: 10, padding: 9, flexShrink: 0 }}>
              <s.icon size={18} color={s.color} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.white, marginBottom: 4 }}>{s.name}</div>
              <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.55 }}>{s.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   3. REVENUE STREAMS — 5 cards
   ───────────────────────────────────────────────────────────────── */
export function RevenueStreams() {
  const t = useTheme();
  const streams = [
    {
      icon: Repeat, title: "Service Fees", tag: "Recurring", color: t.accent,
      bullets: [
        "Communities pay to add IronClaw (security, alpha, moderation)",
        "Tiered pricing: Free basic tier → Paid premium features",
        "Monthly / annual subscription model",
      ],
    },
    {
      icon: TrendingUp, title: "Performance Cut", tag: "Aligned", color: t.green,
      bullets: [
        "Agent finds alpha → users trade → small % of profit flows back",
        "Treasury management → management fee on AUM",
        "Real alignment: agent only earns if it performs",
      ],
    },
    {
      icon: Award, title: "Protocol Grants & Bounties", tag: "Sustainable", color: t.amber,
      bullets: [
        "NEAR ecosystem pays for specific missions",
        "Education campaigns, security audits, onboarding",
        "Agent acts as an ecosystem mercenary for hire",
      ],
    },
    {
      icon: Database, title: "Data & API Access", tag: "Moat Builder", color: "#9b5de5",
      bullets: [
        "Scam pattern databases · sentiment history",
        "Deal flow records · security audit logs",
        "Protocols and traders pay for API access — data compounds",
      ],
    },
    {
      icon: Sparkles, title: "Attention Monetization", tag: "Scalable", color: "#ff6b00",
      bullets: [
        "Agent builds audience through content and reports",
        "Sponsored missions from protocols",
        "“This alpha report brought to you by Protocol X”",
      ],
    },
  ];

  return (
    <Section style={{ borderTop: `1px solid ${t.border}` }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <Badge color={t.green}>REVENUE</Badge>
        <h2 style={{ fontSize: 36, fontWeight: 800, color: t.white, marginTop: 12, letterSpacing: "-0.5px" }}>
          Where the Money Comes In
        </h2>
        <p style={{ fontSize: 15, color: t.textMuted, marginTop: 10, maxWidth: 640, margin: "10px auto 0", lineHeight: 1.65 }}>
          Five revenue streams, all flowing through the on-chain Treasury Contract. No team take-rate, no
          off-chain skimming — every dollar is auditable.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
        {streams.map((s, i) => (
          <div key={i} style={{
            background: t.bgCard,
            border: `1px solid ${t.border}`,
            borderRadius: 14, padding: 26, transition: "all 0.3s", position: "relative", overflow: "hidden",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = s.color; e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = `0 12px 32px ${s.color}22`; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "none"; }}
          >
            <div style={{ position: "absolute", top: -40, right: -40, width: 120, height: 120, background: `radial-gradient(circle, ${s.color}22, transparent 70%)`, borderRadius: "50%" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, position: "relative" }}>
              <div style={{ background: `${s.color}18`, borderRadius: 10, width: 46, height: 46, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <s.icon size={22} color={s.color} />
              </div>
              <span style={{
                fontSize: 10, fontWeight: 800, padding: "4px 10px", borderRadius: 20,
                background: `${s.color}18`, color: s.color, textTransform: "uppercase", letterSpacing: 0.6,
                border: `1px solid ${s.color}44`,
              }}>{s.tag}</span>
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: t.white, marginBottom: 12, position: "relative" }}>{s.title}</div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, position: "relative" }}>
              {s.bullets.map((b, j) => (
                <li key={j} style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.6, marginBottom: 6, paddingLeft: 16, position: "relative" }}>
                  <span style={{ position: "absolute", left: 0, top: 6, width: 6, height: 6, borderRadius: "50%", background: s.color }} />
                  {b}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   4. HOW USERS EARN — 2x2 grid
   ───────────────────────────────────────────────────────────────── */
export function HowUsersEarn() {
  const t = useTheme();
  const earnings = [
    {
      icon: HandCoins, letter: "A", title: "Revenue Share", category: "Passive", color: t.accent,
      desc: "A share of all protocol revenue flows directly to stakers. Hold the token, earn yield generated by the agent's real economic activity.",
    },
    {
      icon: Zap, letter: "B", title: "Work-to-Earn", category: "Active", color: t.green,
      desc: "Improve prompts, flag false positives, contribute training data — get paid in tokens. The agent gets smarter, contributors get rewarded.",
    },
    {
      icon: Vote, letter: "C", title: "Governance Yield", category: "Governance", color: "#9b5de5",
      desc: "Active voters earn more than passive holders. A participation multiplier on base yield incentivizes high-quality governance decisions.",
    },
    {
      icon: Crosshair, letter: "D", title: "Mission Staking", category: "Conviction", color: "#ff6b00",
      desc: "Stake on missions you believe in. Mission succeeds → multiplier on your stake. Mission fails → stake gets slashed. Skin in the game.",
    },
  ];

  return (
    <Section style={{ borderTop: `1px solid ${t.border}` }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <Badge color={t.amber}>EARN</Badge>
        <h2 style={{ fontSize: 36, fontWeight: 800, color: t.white, marginTop: 12, letterSpacing: "-0.5px" }}>
          Four Ways Holders Earn
        </h2>
        <p style={{ fontSize: 15, color: t.textMuted, marginTop: 10, maxWidth: 600, margin: "10px auto 0", lineHeight: 1.65 }}>
          Passive, active, governance, and conviction-based earning paths. Pick your style — the protocol rewards every kind of participation.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 18 }}>
        {earnings.map((e, i) => (
          <div key={i} style={{
            background: `linear-gradient(135deg, ${e.color}10, ${t.bgCard})`,
            border: `1px solid ${e.color}33`,
            borderRadius: 16, padding: 28, position: "relative", overflow: "hidden",
            transition: "all 0.3s",
          }}
            onMouseEnter={el => { el.currentTarget.style.transform = "translateY(-4px)"; el.currentTarget.style.borderColor = e.color; el.currentTarget.style.boxShadow = `0 12px 32px ${e.color}33`; }}
            onMouseLeave={el => { el.currentTarget.style.transform = ""; el.currentTarget.style.borderColor = `${e.color}33`; el.currentTarget.style.boxShadow = "none"; }}
          >
            <div style={{ position: "absolute", top: 16, right: 18, fontSize: 56, fontWeight: 900, color: `${e.color}25`, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}>
              {e.letter}
            </div>
            <div style={{ background: `${e.color}25`, borderRadius: 12, width: 50, height: 50, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 18 }}>
              <e.icon size={24} color={e.color} />
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: t.white, marginBottom: 6 }}>{e.title}</div>
            <span style={{
              display: "inline-block",
              fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
              background: `${e.color}22`, color: e.color, textTransform: "uppercase", letterSpacing: 0.6,
              marginBottom: 12,
            }}>{e.category}</span>
            <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.65 }}>{e.desc}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   5. THE MOAT — vertical list
   ───────────────────────────────────────────────────────────────── */
export function TheMoat() {
  const t = useTheme();
  const moats = [
    {
      icon: Database, title: "Data Moat", color: t.accent,
      points: [
        "Historical intel that can't be copied by forks",
        "Scam patterns accumulated across thousands of incidents",
        "Sentiment history, deal outcomes, audit logs",
        "Every day of operation = more defensibility",
      ],
    },
    {
      icon: Award, title: "Reputation", color: t.green,
      points: [
        "Trust built over time across the ecosystem",
        "Verified track record of successful missions",
        "Social proof from community testimonials",
        "Brand recognition across NEAR",
      ],
    },
    {
      icon: Network, title: "Network Integrations", color: t.amber,
      points: [
        "Deep hooks into Telegram and Discord groups",
        "Protocol partnerships and API integrations",
        "Switching costs that compound over time",
        "Network effects from a growing user base",
      ],
    },
    {
      icon: Users, title: "Active Governance", color: "#9b5de5",
      points: [
        "A community that actually shows up to vote",
        "Forks get the code — not the people",
        "Governance culture can't be cloned",
        "Institutional knowledge held by holders",
      ],
    },
  ];

  return (
    <Section style={{ borderTop: `1px solid ${t.border}` }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <Badge color="#9b5de5">DEFENSIBILITY</Badge>
        <h2 style={{ fontSize: 36, fontWeight: 800, color: t.white, marginTop: 12, letterSpacing: "-0.5px" }}>
          Why Forks Can't Win
        </h2>
        <p style={{ fontSize: 15, color: t.textMuted, marginTop: 10, maxWidth: 620, margin: "10px auto 0", lineHeight: 1.65 }}>
          The contracts are open-source. The code can be forked. None of that matters — the moat is everywhere the code isn't.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 920, margin: "0 auto" }}>
        {moats.map((m, i) => (
          <div key={i} style={{
            background: t.bgCard,
            border: `1px solid ${t.border}`,
            borderLeft: `4px solid ${m.color}`,
            borderRadius: 14, padding: "24px 28px",
            display: "flex", gap: 22, alignItems: "flex-start",
            transition: "all 0.3s",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = m.color; e.currentTarget.style.borderLeft = `4px solid ${m.color}`; e.currentTarget.style.transform = "translateX(4px)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.borderLeft = `4px solid ${m.color}`; e.currentTarget.style.transform = ""; }}
          >
            <div style={{ background: `${m.color}18`, borderRadius: 12, width: 54, height: 54, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <m.icon size={26} color={m.color} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 19, fontWeight: 800, color: t.white, marginBottom: 12 }}>{m.title}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 8 }}>
                {m.points.map((p, j) => (
                  <div key={j} style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.55, paddingLeft: 14, position: "relative" }}>
                    <CheckCircle2 size={12} color={m.color} style={{ position: "absolute", left: 0, top: 4 }} />
                    {p}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   6. GOVERNANCE FLOW — horizontal flow diagram
   ───────────────────────────────────────────────────────────────── */
export function GovernanceFlow() {
  const t = useTheme();
  const steps = [
    { icon: Coins,    title: "Hold Token",      desc: "Acquire $IRONCLAW to participate in the agent's governance.", color: t.accent },
    { icon: Vote,     title: "Vote on Missions", desc: "Propose and vote on the agent's objectives and targets.",     color: t.green },
    { icon: ScrollText, title: "Update Prompts", desc: "Govern agent behavior through on-chain prompt proposals.",   color: "#9b5de5" },
    { icon: Cpu,      title: "Agent Executes",   desc: "Approved missions execute autonomously, with on-chain proof.", color: "#ff6b00" },
    { icon: HandCoins,title: "Revenue Flows",    desc: "Earnings distributed to stakers, contributors, and proposers.", color: t.amber },
  ];

  return (
    <Section style={{ borderTop: `1px solid ${t.border}` }}>
      <div style={{ textAlign: "center", marginBottom: 56 }}>
        <Badge color={t.green}>GOVERNANCE LOOP</Badge>
        <h2 style={{ fontSize: 36, fontWeight: 800, color: t.white, marginTop: 12, letterSpacing: "-0.5px" }}>
          The Closed-Loop Cycle
        </h2>
        <p style={{ fontSize: 15, color: t.textMuted, marginTop: 10, maxWidth: 620, margin: "10px auto 0", lineHeight: 1.65 }}>
          Hold → vote → update → execute → earn → repeat. Every step is on-chain. Every revenue flow comes back to the holders who steered the agent.
        </p>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", alignItems: "stretch", gap: 0, position: "relative" }}>
        {steps.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}>
            <div style={{
              width: 180, padding: "20px 16px", textAlign: "center",
              background: t.bgCard, border: `1px solid ${s.color}44`, borderRadius: 14,
              transition: "all 0.3s",
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = s.color; e.currentTarget.style.transform = "translateY(-4px)"; e.currentTarget.style.boxShadow = `0 8px 24px ${s.color}33`; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = `${s.color}44`; e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "none"; }}
            >
              <div style={{ background: `${s.color}18`, borderRadius: "50%", width: 54, height: 54, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                <s.icon size={24} color={s.color} />
              </div>
              <div style={{ fontSize: 11, color: s.color, fontWeight: 800, letterSpacing: 1, marginBottom: 6 }}>STEP {i + 1}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.white, marginBottom: 6 }}>{s.title}</div>
              <div style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.5 }}>{s.desc}</div>
            </div>
            {i < steps.length - 1 && (
              <div style={{ display: "flex", alignItems: "center", padding: "0 8px" }}>
                <ArrowRight size={20} color={t.textDim} />
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ textAlign: "center", marginTop: 28, fontSize: 12, color: t.textDim, fontFamily: "'JetBrains Mono', monospace" }}>
        ↻ Repeats every governance cycle
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   7. TECHNICAL ARCHITECTURE
   ───────────────────────────────────────────────────────────────── */
export function TechArchitecture() {
  const t = useTheme();
  const layers = [
    {
      icon: Vote, title: "Governance Layer", subtitle: "On-Chain", color: t.accent,
      components: [
        { name: "Mission Registry Contract", desc: "Active missions, voting state, completion criteria" },
        { name: "Prompt DAO Contract",       desc: "Prompt versions, voting on updates, execution triggers" },
        { name: "Staking Contract",          desc: "Token staking, delegation, reward distribution" },
      ],
    },
    {
      icon: Brain, title: "Agent Core", subtitle: "Off-Chain · On-Chain Anchored", color: "#9b5de5",
      components: [
        { name: "LLM Engine",        desc: "Base model with custom system prompts" },
        { name: "Mission Executor",  desc: "Parses approved missions, executes autonomously" },
        { name: "Reporting Module",  desc: "Logs outputs, results, and metrics back on-chain" },
        { name: "Prompt Manager",    desc: "Pulls active prompt version from on-chain governance" },
      ],
    },
    {
      icon: Coins, title: "Revenue Layer", subtitle: "On-Chain", color: t.green,
      components: [
        { name: "Treasury Contract",  desc: "Holds protocol revenue, manages distributions" },
        { name: "Fee Splitter",       desc: "Automates revenue share to stakers, contributors, treasury" },
        { name: "API Gateway Contract", desc: "Manages paid data access, rate limiting" },
      ],
    },
  ];

  const flow = [
    { n: "1", label: "Mission Proposal", icon: ScrollText, color: t.accent, lines: [
      "User submits mission proposal with parameters",
      "Token holders vote (quorum + approval threshold)",
      "Approved missions enter Mission Registry",
    ]},
    { n: "2", label: "Agent Execution", icon: Cpu, color: "#9b5de5", lines: [
      "Agent polls Mission Registry for active tasks",
      "Fetches current prompt version from Prompt DAO",
      "Executes mission autonomously",
      "Logs results on-chain (hash + summary)",
    ]},
    { n: "3", label: "Revenue Distribution", icon: HandCoins, color: t.green, lines: [
      "Revenue enters Treasury Contract",
      "Fee Splitter allocates per tokenomics",
      "40 % stakers · 25 % contributors · 20 % reserves · 15 % proposers",
    ]},
    { n: "4", label: "Prompt Updates", icon: GitBranch, color: t.amber, lines: [
      "Community submits prompt improvement proposals",
      "Token-weighted voting with time-lock",
      "Approved prompts deployed after delay",
      "Agent pulls new prompt on next execution cycle",
    ]},
  ];

  const security = [
    { icon: Lock, title: "On-Chain Security", color: t.accent, items: [
      "Multi-sig on treasury operations (3-of-5 minimum)",
      "Time-locks on prompt updates (48-hour minimum delay)",
      "Quorum requirements & vote escrow against governance attacks",
    ]},
    { icon: ServerCog, title: "Off-Chain Security", color: t.green, items: [
      "Agent runs in isolated execution environment",
      "No direct wallet access — only signs pre-approved tx types",
      "Rate limiting on external API calls and audit logging",
    ]},
    { icon: ShieldCheck, title: "Prompt Safety", color: "#9b5de5", items: [
      "Prompt proposals reviewed by security council pre-vote",
      "Automated + manual harmful-prompt detection",
      "Rollback mechanism for compromised prompts",
    ]},
  ];

  return (
    <Section style={{ borderTop: `1px solid ${t.border}` }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <Badge color={t.accent}>ARCHITECTURE</Badge>
        <h2 style={{ fontSize: 36, fontWeight: 800, color: t.white, marginTop: 12, letterSpacing: "-0.5px" }}>
          How It's Built
        </h2>
        <p style={{ fontSize: 15, color: t.textMuted, marginTop: 10, maxWidth: 640, margin: "10px auto 0", lineHeight: 1.65 }}>
          Three layers — governance, agent, revenue — connected by on-chain anchors. Off-chain only where speed
          matters; on-chain everywhere trust matters.
        </p>
      </div>

      {/* Architecture diagram - 3 layer cards with flow arrows */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20, marginBottom: 56 }}>
        {layers.map((l, i) => (
          <div key={i} style={{
            background: `linear-gradient(180deg, ${l.color}10, ${t.bgCard})`,
            border: `1px solid ${l.color}44`,
            borderRadius: 16, padding: 26, position: "relative",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
              <div style={{ background: `${l.color}25`, borderRadius: 12, width: 50, height: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <l.icon size={24} color={l.color} />
              </div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: t.white }}>{l.title}</div>
                <div style={{ fontSize: 11, color: l.color, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase" }}>{l.subtitle}</div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {l.components.map((c, j) => (
                <div key={j} style={{ background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.white, marginBottom: 3, fontFamily: "'JetBrains Mono', monospace" }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.5 }}>{c.desc}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Execution Flow */}
      <div style={{ marginBottom: 56 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <Badge color={t.green}>EXECUTION FLOW</Badge>
          <h3 style={{ fontSize: 22, fontWeight: 700, color: t.white, marginTop: 10 }}>From proposal to payout</h3>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
          {flow.map((f, i) => (
            <div key={i} style={{
              background: t.bgCard,
              border: `1px solid ${t.border}`,
              borderTop: `3px solid ${f.color}`,
              borderRadius: 12, padding: 22,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{ background: `${f.color}20`, color: f.color, borderRadius: 10, width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", fontSize: 16 }}>
                  {f.n}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: t.white }}>{f.label}</div>
                </div>
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {f.lines.map((line, j) => (
                  <li key={j} style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.55, paddingLeft: 16, position: "relative", marginBottom: 6 }}>
                    <span style={{ position: "absolute", left: 0, top: 7, width: 5, height: 5, borderRadius: "50%", background: f.color }} />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Security Model */}
      <div>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <Badge color="#ff6b00">SECURITY MODEL</Badge>
          <h3 style={{ fontSize: 22, fontWeight: 700, color: t.white, marginTop: 10 }}>Defense in depth</h3>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
          {security.map((s, i) => (
            <div key={i} style={{
              background: t.bgCard,
              border: `1px solid ${s.color}44`,
              borderRadius: 12, padding: 22,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{ background: `${s.color}18`, borderRadius: 10, width: 42, height: 42, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <s.icon size={20} color={s.color} />
                </div>
                <div style={{ fontSize: 15, fontWeight: 800, color: t.white }}>{s.title}</div>
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {s.items.map((item, j) => (
                  <li key={j} style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.55, paddingLeft: 18, position: "relative", marginBottom: 6 }}>
                    <CheckCircle2 size={11} color={s.color} style={{ position: "absolute", left: 0, top: 4 }} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   8. TOKENOMICS DEEP DIVE — revenue split, fees, governance params
   ───────────────────────────────────────────────────────────────── */
export function TokenomicsDeep() {
  const t = useTheme();
  const revenueSplit = [
    { pct: 40, label: "Staker Rewards",      desc: "Pro-rata to staked $IRONCLAW", color: t.accent },
    { pct: 25, label: "Contributor Rewards", desc: "Work-to-earn: prompt improvements, data, bug reports", color: t.green },
    { pct: 20, label: "Treasury Reserves",   desc: "DAO-controlled for ops, dev, emergencies", color: "#9b5de5" },
    { pct: 15, label: "Mission Proposers",   desc: "Bonus for successful mission completion", color: "#ff6b00" },
  ];

  const fees = [
    { service: "Premium Group Subscription", fee: "$50–500 / month", split: "100% Treasury → split per model" },
    { service: "API Access (Data)",          fee: "$0.001 per call",  split: "100% Treasury → split per model" },
    { service: "Performance Fee (Alpha/Treasury)", fee: "10% of profits", split: "100% Treasury → split per model" },
    { service: "Sponsored Missions",         fee: "Negotiated",       split: "70% Treasury · 30% direct to stakers" },
  ];

  const govParams = [
    { param: "Proposal Threshold",        value: "100,000 $IRONCLAW (0.01%)", changeable: "Governance vote" },
    { param: "Quorum",                    value: "4% of circulating supply",  changeable: "Governance vote" },
    { param: "Approval Threshold",        value: "60% of votes",              changeable: "Governance vote" },
    { param: "Voting Period",             value: "5 days",                    changeable: "Governance vote" },
    { param: "Time-lock (Prompt Updates)",value: "48 hours",                  changeable: "Governance vote" },
    { param: "Time-lock (Treasury)",      value: "72 hours",                  changeable: "Multi-sig + Governance" },
  ];

  return (
    <Section style={{ borderTop: `1px solid ${t.border}` }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <Badge color={t.accent}>TOKENOMICS DEEP DIVE</Badge>
        <h2 style={{ fontSize: 36, fontWeight: 800, color: t.white, marginTop: 12, letterSpacing: "-0.5px" }}>
          Money Flow, Fees & Parameters
        </h2>
        <p style={{ fontSize: 15, color: t.textMuted, marginTop: 10, maxWidth: 640, margin: "10px auto 0", lineHeight: 1.65 }}>
          Every dollar of revenue, every governance lever, every parameter — fully spec'd and on-chain.
        </p>
      </div>

      {/* Revenue Distribution Bar */}
      <div style={{ marginBottom: 56 }}>
        <h3 style={{ fontSize: 19, fontWeight: 700, color: t.white, marginBottom: 18, textAlign: "center" }}>
          Revenue Distribution Model
        </h3>
        <div style={{ display: "flex", height: 56, borderRadius: 12, overflow: "hidden", border: `1px solid ${t.border}`, marginBottom: 18 }}>
          {revenueSplit.map((r, i) => (
            <div key={i} style={{
              flex: r.pct,
              background: `linear-gradient(180deg, ${r.color}, ${r.color}dd)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontWeight: 800, fontSize: 16,
              fontFamily: "'JetBrains Mono', monospace",
              borderRight: i < revenueSplit.length - 1 ? "1px solid rgba(0,0,0,0.25)" : "none",
            }}>
              {r.pct}%
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          {revenueSplit.map((r, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 14px", background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 10 }}>
              <div style={{ width: 12, height: 12, borderRadius: 3, background: r.color, marginTop: 4, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.white }}>{r.pct}% · {r.label}</div>
                <div style={{ fontSize: 11, color: t.textDim, lineHeight: 1.5 }}>{r.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Fee Structure Table */}
      <div style={{ marginBottom: 56 }}>
        <h3 style={{ fontSize: 19, fontWeight: 700, color: t.white, marginBottom: 18, textAlign: "center" }}>
          Fee Structure
        </h3>
        <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1.4fr", padding: "14px 22px", background: t.bgSurface, borderBottom: `1px solid ${t.border}`, fontSize: 11, fontWeight: 800, color: t.textDim, letterSpacing: 0.6, textTransform: "uppercase" }}>
            <div>Service</div>
            <div>Fee</div>
            <div>Distribution</div>
          </div>
          {fees.map((f, i) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "1.6fr 1fr 1.4fr", padding: "16px 22px",
              borderBottom: i < fees.length - 1 ? `1px solid ${t.border}` : "none",
              fontSize: 13, alignItems: "center",
            }}>
              <div style={{ color: t.white, fontWeight: 600 }}>{f.service}</div>
              <div style={{ color: t.accent, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{f.fee}</div>
              <div style={{ color: t.textMuted }}>{f.split}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Staking Mechanics */}
      <div style={{ marginBottom: 56 }}>
        <h3 style={{ fontSize: 19, fontWeight: 700, color: t.white, marginBottom: 18, textAlign: "center" }}>
          Staking Mechanics
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
          {[
            { title: "Base Staking", color: t.accent, points: [
              "Stake $IRONCLAW to earn share of protocol revenue",
              "No lock-up required for base staking",
              "Rewards accrue in real-time, claimable anytime",
            ]},
            { title: "Boosted Staking", color: t.green, points: [
              "Active governance participants earn a multiplier",
              "Voting in 80%+ of proposals → 1.5× multiplier",
              "Submitting approved proposals → additional bonus",
            ]},
            { title: "Mission Staking", color: "#ff6b00", points: [
              "Stake on specific missions you believe will succeed",
              "Mission succeeds → earn up to 3× on staked amount",
              "Mission fails → lose stake (redistributed to treasury)",
            ]},
          ].map((s, i) => (
            <div key={i} style={{
              background: t.bgCard, border: `1px solid ${s.color}44`,
              borderRadius: 12, padding: 22,
            }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: s.color, marginBottom: 12, letterSpacing: 0.3 }}>{s.title}</div>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {s.points.map((p, j) => (
                  <li key={j} style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.6, paddingLeft: 16, position: "relative", marginBottom: 6 }}>
                    <span style={{ position: "absolute", left: 0, top: 7, width: 5, height: 5, borderRadius: "50%", background: s.color }} />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Governance Parameters Table */}
      <div style={{ marginBottom: 56 }}>
        <h3 style={{ fontSize: 19, fontWeight: 700, color: t.white, marginBottom: 18, textAlign: "center" }}>
          Governance Parameters
        </h3>
        <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1.4fr 1.2fr", padding: "14px 22px", background: t.bgSurface, borderBottom: `1px solid ${t.border}`, fontSize: 11, fontWeight: 800, color: t.textDim, letterSpacing: 0.6, textTransform: "uppercase" }}>
            <div>Parameter</div>
            <div>Value</div>
            <div>Changeable By</div>
          </div>
          {govParams.map((g, i) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "1.6fr 1.4fr 1.2fr", padding: "14px 22px",
              borderBottom: i < govParams.length - 1 ? `1px solid ${t.border}` : "none",
              fontSize: 13, alignItems: "center",
            }}>
              <div style={{ color: t.white, fontWeight: 600 }}>{g.param}</div>
              <div style={{ color: t.green, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{g.value}</div>
              <div style={{ color: t.textMuted, fontSize: 12 }}>{g.changeable}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Deflationary Mechanisms */}
      <div>
        <h3 style={{ fontSize: 19, fontWeight: 700, color: t.white, marginBottom: 18, textAlign: "center" }}>
          Deflationary Mechanisms
        </h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
          {[
            { icon: Flame, title: "Buyback & Burn", color: "#ff6b00", points: [
              "5% of treasury revenue used for market buybacks",
              "Bought tokens are burned permanently",
              "Reduces supply over time",
            ]},
            { icon: Activity, title: "Mission Slash Burns", color: "#ef4444", points: [
              "Failed mission stakes are 50% burned",
              "Remaining 50% returns to treasury",
              "Creates a cost for low-quality mission proposals",
            ]},
          ].map((d, i) => (
            <div key={i} style={{
              background: `linear-gradient(135deg, ${d.color}10, ${t.bgCard})`,
              border: `1px solid ${d.color}44`,
              borderRadius: 14, padding: 24,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <div style={{ background: `${d.color}25`, borderRadius: 12, width: 46, height: 46, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <d.icon size={22} color={d.color} />
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: t.white }}>{d.title}</div>
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {d.points.map((p, j) => (
                  <li key={j} style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.6, paddingLeft: 16, position: "relative", marginBottom: 6 }}>
                    <span style={{ position: "absolute", left: 0, top: 7, width: 5, height: 5, borderRadius: "50%", background: d.color }} />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   9. LAUNCH SCOPE — feature checklist
   ───────────────────────────────────────────────────────────────── */
export function LaunchScope() {
  const t = useTheme();
  const groups = [
    {
      title: "Core Infrastructure", icon: Layers, color: t.accent,
      items: [
        "Smart contracts on NEAR mainnet (Mission Registry, Prompt DAO, Staking, Treasury, Fee Splitter)",
        "Agent infrastructure fully operational",
        "LLM engine integrated with custom prompt system",
        "On-chain anchoring for all agent actions",
      ],
    },
    {
      title: "Governance System", icon: Vote, color: "#9b5de5",
      items: [
        "Token-weighted voting live",
        "Mission proposal and approval flow",
        "Prompt update governance with time-locks",
        "Quorum and threshold enforcement",
      ],
    },
    {
      title: "Revenue & Earnings", icon: Coins, color: t.green,
      items: [
        "Staking and revenue distribution live",
        "Work-to-earn contribution rewards",
        "Governance yield multipliers",
        "Mission staking with success/slash mechanics",
      ],
    },
    {
      title: "Agent Capabilities", icon: Brain, color: t.amber,
      items: [
        "All 6 specializations available (Security, Alpha, Treasury, Content, Bounty, Deal Flow)",
        "Autonomous mission execution",
        "Reporting and logging on-chain",
        "Premium features and API access",
      ],
    },
    {
      title: "Ecosystem", icon: Network, color: "#0ea5e9",
      items: [
        "Data API for protocols and traders",
        "Telegram + Discord integration for groups",
        "Documentation and developer resources",
        "Community channels (Telegram, Discord, X)",
      ],
    },
    {
      title: "Security", icon: ShieldCheck, color: "#ff6b00",
      items: [
        "Multi-sig treasury (3-of-5)",
        "Time-locks on sensitive operations",
        "Prompt safety review system",
        "Audit logging and rollback mechanisms",
      ],
    },
  ];

  return (
    <Section style={{ borderTop: `1px solid ${t.border}` }}>
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <Badge color={t.green}>LAUNCH SCOPE</Badge>
        <h2 style={{ fontSize: 36, fontWeight: 800, color: t.white, marginTop: 12, letterSpacing: "-0.5px" }}>
          Everything Ships at Launch
        </h2>
        <p style={{ fontSize: 15, color: t.textMuted, marginTop: 10, maxWidth: 620, margin: "10px auto 0", lineHeight: 1.65 }}>
          No phased rollout. No "coming soon." The full agent, full governance, full revenue stack — live on day one.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 18 }}>
        {groups.map((g, i) => (
          <div key={i} style={{
            background: t.bgCard,
            border: `1px solid ${t.border}`,
            borderRadius: 14, padding: 24,
            transition: "all 0.3s",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = g.color; e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = `0 8px 24px ${g.color}22`; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "none"; }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, paddingBottom: 14, borderBottom: `1px solid ${t.border}` }}>
              <div style={{ background: `${g.color}18`, borderRadius: 10, width: 42, height: 42, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <g.icon size={20} color={g.color} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, color: t.white }}>{g.title}</div>
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {g.items.map((item, j) => (
                <li key={j} style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.55, paddingLeft: 22, position: "relative", marginBottom: 9 }}>
                  <CheckCircle2 size={14} color={g.color} style={{ position: "absolute", left: 0, top: 3 }} />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────────────────────────────────────────────────────────
   10. FINAL CTA
   ───────────────────────────────────────────────────────────────── */
export function FinalCTA() {
  const t = useTheme();
  return (
    <Section style={{ borderTop: `1px solid ${t.border}` }}>
      <div style={{
        background: `linear-gradient(135deg, ${t.accent}18, #9b5de518, ${t.bgCard})`,
        border: `1px solid ${t.accent}44`,
        borderRadius: 24, padding: "56px 32px",
        textAlign: "center", position: "relative", overflow: "hidden",
        maxWidth: 1100, margin: "0 auto",
      }}>
        {/* Decorative glows */}
        <div style={{ position: "absolute", top: -100, left: -100, width: 300, height: 300, background: `radial-gradient(circle, ${t.accent}33, transparent 70%)`, borderRadius: "50%", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: -100, right: -100, width: 300, height: 300, background: `radial-gradient(circle, #9b5de533, transparent 70%)`, borderRadius: "50%", pointerEvents: "none" }} />

        <div style={{ position: "relative" }}>
          <Badge color={t.accent}>JOIN THE COMMUNITY</Badge>
          <h2 style={{ fontSize: 42, fontWeight: 800, color: t.white, marginTop: 14, letterSpacing: "-1px", lineHeight: 1.15 }}>
            Take the Agent Live with Us.
          </h2>
          <p style={{ fontSize: 16, color: t.textMuted, marginTop: 14, maxWidth: 620, margin: "14px auto 0", lineHeight: 1.65 }}>
            IronClaw is community-governed from day one. The earliest holders steer the agent, shape its missions,
            and earn from every dollar it brings in.
          </p>

          <div style={{ display: "flex", gap: 14, marginTop: 36, flexWrap: "wrap", justifyContent: "center" }}>
            <a href="https://t.me/IronClawHQ" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
              <Btn primary style={{ fontSize: 15, padding: "15px 32px" }}>
                <MessageSquare size={16} /> Join the Community
              </Btn>
            </a>
            <a href="https://t.me/IronShieldCore_bot" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
              <Btn style={{ fontSize: 15, padding: "15px 32px" }}>
                <ExternalLink size={16} /> Launch IronClaw Bot
              </Btn>
            </a>
          </div>

          <div style={{ display: "flex", gap: 24, marginTop: 32, flexWrap: "wrap", justifyContent: "center", fontSize: 13 }}>
            <a href="https://x.com/_IronClaw" target="_blank" rel="noopener noreferrer" style={{ color: t.textMuted, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ExternalLink size={13} /> X (Twitter)
            </a>
            <a href="https://github.com" target="_blank" rel="noopener noreferrer" style={{ color: t.textMuted, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Code2 size={13} /> View on GitHub
            </a>
            <span style={{ color: t.textMuted, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <BookOpen size={13} /> Read the Docs
            </span>
          </div>
        </div>
      </div>
    </Section>
  );
}
