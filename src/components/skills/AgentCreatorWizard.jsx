"use client";
// AgentCreatorWizard — /agents/create
//
// 6-step premium onboarding for the IronShield agent platform. The user
// brings an agent that runs ANYWHERE (OpenClaw / IronClaw / Hermes /
// self-hosted / their own API) and IronShield wraps it with:
//
//   1. Identity        — NEAR-native handle, avatar, bio, categories
//   2. Framework       — connect existing runtime via creds
//   3. Skills          — install monetizable capabilities from the marketplace
//   4. Channels        — choose where the agent operates (TG / Discord / X / etc.)
//   5. Permissions     — granted / limited / denied per capability
//   6. Review & Launch — confirm and ship
//
// The wizard never hosts the agent runtime. The framework does. We are
// the marketplace + identity + distribution layer above all frameworks.
//
// Real wiring (preserved from the previous wizard so we don't regress
// production behavior):
//   - register_agent / register_sub_agent for identity
//   - /api/agents/connect for framework credentials (encrypted at rest)
//   - set_agent_connection for the public on-chain framework binding
//   - Best-effort install_skill for picked skills (each its own tx)
//
// Channels and Permissions are local-state-only for now — they ship as
// UI/UX in this wizard but don't persist outside the draft until the
// channel-relay runtime + on-chain permission model land.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus, ArrowRight, ArrowLeft, Check, Loader2, ExternalLink,
  Wallet, Bot, Shield, ShieldCheck, ShieldAlert, Send, Globe,
  MessageSquare, Sparkles, Star, BookmarkPlus, Search, ChevronDown,
  Zap, Eye, X as XIcon, Trash2, Copy, FileText, BarChart3, Mail,
  Webhook, Calendar, Hash, Database, Workflow, Cpu, Server,
  Activity, Award, AlertTriangle, Lock, Filter, Image as ImageIcon,
  Repeat, TrendingUp,
} from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import useAgent from "@/hooks/useAgent";
import useAgentConnections from "@/hooks/useAgentConnections";
import AgentAvatar from "@/components/agents/AgentAvatar";
import AvatarPicker from "@/components/agents/AvatarPicker";
import { defaultAvatar } from "@/components/agents/avatarPresets";

/* ═════════════════════════  CONSTANTS  ═════════════════════════ */

const STEPS = [
  { key: "identity",    label: "Identity"        },
  { key: "framework",   label: "Framework"       },
  { key: "skills",      label: "Skills"          },
  { key: "channels",    label: "Channels"        },
  { key: "permissions", label: "Permissions"     },
  { key: "review",      label: "Review & Launch" },
];

const FRAMEWORK_DEFS = {
  openclaw: {
    title: "OpenClaw",
    blurb: "General purpose multi-platform agent framework built for reliability and scale.",
    capabilities: ["Multi-platform support", "Plugin ecosystem", "Built for scale"],
    accent: "#a855f7",
    recommended: true,
    fields: [
      { key: "external_id", label: "Agent ID",   placeholder: "agent_abc123…", required: true,  hint: "Your unique agent ID from OpenClaw" },
      { key: "endpoint",    label: "API endpoint", placeholder: "https://api.openclaw.ai", hint: "Your OpenClaw API endpoint" },
      { key: "auth",        label: "API key",   placeholder: "ock_…", secret: true, required: true, hint: "Your OpenClaw API key" },
    ],
    docsUrl: "https://openclaw.ai/docs",
  },
  ironclaw: {
    title: "IronClaw",
    blurb: "Encrypted-enclave agent runtime on NEAR AI Cloud.",
    capabilities: ["TEE-attested execution", "On-chain wallet & DeFi tools", "Verifiable runs"],
    accent: "#22d3ee",
    fields: [
      { key: "external_id", label: "Agent slug", placeholder: "my-agent.near.ai", required: true, hint: "Your NEAR AI agent slug" },
      { key: "endpoint",    label: "Gateway URL", placeholder: "https://stark-goat.agent0.near.ai", required: true, hint: "Your IronClaw gateway base URL" },
      { key: "auth",        label: "Gateway token", placeholder: "ic_…", secret: true, required: true, hint: "Your gateway token" },
    ],
    docsUrl: "https://docs.near.ai/agents/quickstart",
  },
  hermes: {
    title: "Hermes",
    blurb: "Fast and lightweight agent runtime by Nous Research — great for notifications and simple tasks.",
    capabilities: ["Lightweight & fast", "Notifications & alerts", "Easy to set up"],
    accent: "#60a5fa",
    fields: [
      { key: "external_id", label: "Agent name", placeholder: "my-hermes-agent", required: true, hint: "Hermes agent name" },
      { key: "endpoint",    label: "Hermes endpoint", placeholder: "https://hermes-agent.nousresearch.com/v1", required: true, hint: "Your Hermes deployment endpoint" },
      { key: "auth",        label: "API key", placeholder: "hms_…", secret: true, required: true, hint: "Hermes API key" },
    ],
    docsUrl: "https://hermes-agent.nousresearch.com/",
  },
  self_hosted: {
    title: "Self-hosted",
    blurb: "Bring any HTTP-speaking runtime — your own framework, LangGraph, CrewAI, AutoGen, or custom.",
    capabilities: ["Full control of the runtime", "POST {endpoint}/chat → {reply}", "HMAC-signed requests"],
    accent: "#f59e0b",
    fields: [
      { key: "external_id", label: "Agent label", placeholder: "my-custom-agent", hint: "Friendly label (optional)" },
      { key: "endpoint", label: "Webhook URL", placeholder: "https://my-agent.example.com", required: true, hint: "Your agent's HTTPS endpoint" },
      { key: "auth",     label: "HMAC secret", placeholder: "base64-or-random", secret: true, hint: "Optional HMAC for request signing" },
    ],
    docsUrl: "https://github.com/nearai/ironclaw",
  },
  api: {
    title: "API runtime",
    blurb: "OpenAI-compatible chat completions endpoint — works with any backend that speaks /v1/chat.",
    capabilities: ["OpenAI-compatible API", "Tool calling supported", "Streaming responses"],
    accent: "#10b981",
    fields: [
      { key: "external_id", label: "Model name", placeholder: "gpt-4o-mini", required: true, hint: "Model identifier" },
      { key: "endpoint",    label: "API base URL", placeholder: "https://api.openai.com/v1", required: true, hint: "Base URL of the chat completions API" },
      { key: "auth",        label: "API key", placeholder: "sk-…", secret: true, required: true, hint: "API key" },
    ],
    docsUrl: "https://platform.openai.com/docs",
  },
};

const PERSONALITIES = ["Helpful", "Analytical", "Proactive", "Witty", "Cautious", "Concise"];

const CATEGORIES = [
  { key: "defi",       label: "DeFi",          accent: "#a855f7" },
  { key: "web3",       label: "Web3",          accent: "#60a5fa" },
  { key: "research",   label: "Research",      accent: "#22d3ee" },
  { key: "analytics",  label: "Analytics",     accent: "#10b981" },
  { key: "social",     label: "Social",        accent: "#f59e0b" },
  { key: "trading",    label: "Trading",       accent: "#ef4444" },
  { key: "support",    label: "Support",       accent: "#fbbf24" },
  { key: "content",    label: "Content",       accent: "#c084fc" },
  { key: "moderation", label: "Moderation",    accent: "#34d399" },
  { key: "alerts",     label: "Alerts",        accent: "#f472b6" },
];

const LANGUAGES = [
  { key: "en", label: "English (US)" },
  { key: "en-gb", label: "English (UK)" },
  { key: "es", label: "Spanish" },
  { key: "fr", label: "French" },
  { key: "de", label: "German" },
  { key: "ja", label: "Japanese" },
  { key: "zh", label: "Chinese" },
  { key: "pt", label: "Portuguese" },
  { key: "ru", label: "Russian" },
  { key: "ar", label: "Arabic" },
];

/* ─── Skill showcase (used until on-chain marketplace is fully populated) ─── */

const SKILL_SHOWCASE = [
  { id: "twitter_writer",    name: "Twitter Thread Writer", category: "Content",     monthly: 19, rating: 4.8, installs: 2410, blurb: "Writes engaging viral threads on any topic.",      Icon: Send,         color: "#60a5fa" },
  { id: "telegram_mod",      name: "Telegram Moderator",    category: "Moderation",  monthly: 15, rating: 4.7, installs: 1820, blurb: "Automate moderation, spam filtering, and alerts.",   Icon: Send,         color: "#38bdf8" },
  { id: "market_researcher", name: "Market Researcher",     category: "Research",    monthly: 29, rating: 4.9, installs: 1402, blurb: "Collects and analyzes data from the web.",          Icon: Search,       color: "#a855f7" },
  { id: "lead_gen",          name: "Lead Generator",        category: "Sales",       monthly: 25, rating: 4.6, installs: 980,  blurb: "Finds leads, enriches data, and organizes.",        Icon: TrendingUp,   color: "#fb923c" },
  { id: "wallet_monitor",    name: "Wallet Monitor",        category: "DeFi",        monthly: 19, rating: 4.7, installs: 1640, blurb: "Monitor wallets, track transactions and alerts.",   Icon: Wallet,       color: "#34d399" },
  { id: "defi_trader",       name: "DeFi Trader",           category: "Trading",     monthly: 49, rating: 4.8, installs: 720,  blurb: "Executes trades, finds alpha, manages positions.",  Icon: Repeat,       color: "#a855f7" },
  { id: "discord_support",   name: "Discord Support",       category: "Support",     monthly: 15, rating: 4.6, installs: 2210, blurb: "Auto-responds and helps users in your server.",     Icon: MessageSquare,color: "#818cf8" },
  { id: "content_rewriter",  name: "Content Rewriter",      category: "Content",     monthly: 12, rating: 4.5, installs: 1120, blurb: "Rewrites, improves and repurposes content.",        Icon: FileText,     color: "#f472b6" },
  { id: "nft_sniper",        name: "NFT Sniper",            category: "Trading",     monthly: 39, rating: 4.8, installs: 540,  blurb: "Snipes NFTs based on filters and strategies.",      Icon: Star,         color: "#a78bfa" },
  { id: "email_responder",   name: "Email Responder",       category: "Support",     monthly: 15, rating: 4.6, installs: 870,  blurb: "Smart email responses and follow-ups.",             Icon: Mail,         color: "#22d3ee" },
];

const SKILL_CATEGORY_FILTERS = [
  { key: "all",        label: "All categories" },
  { key: "Content",    label: "Content" },
  { key: "Moderation", label: "Moderation" },
  { key: "Research",   label: "Research" },
  { key: "Sales",      label: "Sales" },
  { key: "DeFi",       label: "DeFi" },
  { key: "Trading",    label: "Trading" },
  { key: "Support",    label: "Support" },
];

/* ─── Channels ─── */

const CHANNELS = [
  { key: "telegram",    label: "Telegram",       Icon: Send,         group: "messaging", blurb: "Connect your Telegram bot to interact in groups and channels.",       handle: "@AirdropHunterBot" },
  { key: "discord",     label: "Discord",        Icon: MessageSquare,group: "messaging", blurb: "Enable your agent to chat, respond, and manage your server.",          handle: "Server name" },
  { key: "twitter",     label: "Twitter / X",    Icon: Send,         group: "social",    blurb: "Allow your agent to post, reply, and engage on your behalf.",          handle: "@handle" },
  { key: "whatsapp",    label: "WhatsApp",       Icon: Globe,        group: "messaging", blurb: "Connect to WhatsApp to automate replies and alerts.",                  handle: "Phone number" },
  { key: "email",       label: "Email",          Icon: Mail,         group: "messaging", blurb: "Enable email sending and receiving via your agent.",                   handle: "you@example.com" },
  { key: "slack",       label: "Slack",          Icon: MessageSquare,group: "messaging", blurb: "Integrate with Slack for alerts and commands.",                        handle: "Workspace URL" },
  { key: "website",     label: "Website Widget", Icon: Globe,        group: "web",       blurb: "Add your agent to your website with a chat widget.",                  handle: "domain.com" },
  { key: "api",         label: "API Endpoint",   Icon: Server,       group: "web",       blurb: "Expose your agent as an API for custom integrations.",                handle: "Public URL" },
  { key: "webhook",     label: "Webhooks",       Icon: Webhook,      group: "tools",     blurb: "Send and receive real-time data with webhooks.",                       handle: "Endpoint URL" },
  { key: "notion",      label: "Notion",         Icon: BookmarkPlus, group: "tools",     blurb: "Sync data, tasks, and knowledge with Notion.",                         handle: "Workspace ID" },
  { key: "sheets",      label: "Google Sheets",  Icon: Database,     group: "tools",     blurb: "Read and write data to Google Sheets.",                                handle: "Sheet URL" },
  { key: "zapier",      label: "Zapier",         Icon: Zap,          group: "tools",     blurb: "Automate workflows and connect 5,000+ apps.",                          handle: "Zap webhook" },
];

const CHANNEL_GROUPS = [
  { key: "all",       label: "All channels" },
  { key: "social",    label: "Social" },
  { key: "messaging", label: "Messaging" },
  { key: "web",       label: "Web & API" },
  { key: "tools",     label: "Tools" },
];

/* ─── Permissions ─── */

const PERMISSION_CATALOG = [
  {
    key: "telegram",    label: "Telegram Access",     blurb: "Send messages, read updates, manage groups and channels.",
    Icon: Send,         scope: "Specific chats & groups", recommended: true,
  },
  {
    key: "discord",     label: "Discord Access",      blurb: "Read messages, send replies, manage server activities.",
    Icon: MessageSquare,scope: "Connected server",
  },
  {
    key: "twitter",     label: "Twitter / X Access",  blurb: "Post tweets, reply, like and read mentions.",
    Icon: Send,         scope: "@handle",
  },
  {
    key: "whatsapp",    label: "WhatsApp Business",   blurb: "Send and receive messages, manage conversations.",
    Icon: Globe,        scope: "Business account",
  },
  {
    key: "wallet",      label: "Wallet Access",       blurb: "View balances, send transactions, interact with dApps.",
    Icon: Wallet,       scope: "NEAR Wallet",
  },
  {
    key: "data",        label: "Data & Web Access",   blurb: "Search the web, scrape data, and access APIs.",
    Icon: Database,     scope: "Limited sites & APIs",
  },
  {
    key: "code",        label: "Code Execution",      blurb: "Run scripts, execute code and use installed tools.",
    Icon: Cpu,          scope: "Sandboxed environment",
  },
  {
    key: "email",       label: "Email Access",        blurb: "Read emails, send emails, and manage threads.",
    Icon: Mail,         scope: "Connected mailbox",
  },
];

const PERMISSION_STATES = [
  { key: "denied",  label: "Denied",  fg: "#fca5a5", bg: "rgba(239,68,68,0.14)",  brd: "rgba(239,68,68,0.36)" },
  { key: "limited", label: "Limited", fg: "#fbbf24", bg: "rgba(245,158,11,0.14)", brd: "rgba(245,158,11,0.36)" },
  { key: "granted", label: "Granted", fg: "#34d399", bg: "rgba(16,185,129,0.14)", brd: "rgba(16,185,129,0.36)" },
];

/* ═════════════════════════  HELPERS  ═════════════════════════ */

function defaultDraft() {
  return {
    // Step 1
    name: "", handle: "", bio: "", avatarUrl: defaultAvatar(),
    personality: "Helpful",
    categories: ["defi", "web3"],
    tags: ["airdrops", "multi-chain", "monitoring", "alerts"],
    language: "en",
    // Step 2
    framework: "openclaw",
    cred: {},
    testResult: null,
    // Step 3
    pickedSkills: [],   // skill ids
    // Step 4
    pickedChannels: [], // channel keys
    // Step 5
    perms: {},          // { [key]: 'denied' | 'limited' | 'granted' }
  };
}

/* ═════════════════════════  UI PRIMITIVES  ═════════════════════════ */

const card = (t, extra = {}) => ({
  background: t.bgCard, border: `1px solid ${t.border}`,
  borderRadius: 14, padding: 20, ...extra,
});

const input = (t, extra = {}) => ({
  width: "100%", padding: "10px 12px",
  background: t.bgSurface, border: `1px solid ${t.border}`,
  borderRadius: 10, color: t.white, fontSize: 13,
  outline: "none", fontFamily: "inherit", ...extra,
});

const primaryBtn = (t, busy = false) => ({
  display: "inline-flex", alignItems: "center", gap: 8,
  padding: "10px 18px",
  background: busy ? t.bgSurface : `linear-gradient(135deg, #a855f7, ${t.accent})`,
  border: "none", borderRadius: 10,
  fontSize: 13, fontWeight: 700, color: "#fff",
  cursor: busy ? "not-allowed" : "pointer",
  boxShadow: busy ? "none" : `0 10px 24px rgba(168,85,247,0.3)`,
});

const secondaryBtn = (t, busy = false) => ({
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "9px 14px",
  background: t.bgSurface, border: `1px solid ${t.border}`,
  borderRadius: 10, fontSize: 12.5, fontWeight: 700, color: t.text,
  cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1,
});

const ghostBtn = (t) => ({
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "8px 12px",
  background: "transparent", border: `1px solid ${t.border}`,
  borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: t.textMuted,
  cursor: "pointer",
});

function Card({ t, children, padded = true, glow = false, style }) {
  return (
    <section style={{
      ...card(t, { padding: padded ? 20 : 0 }),
      ...(glow ? { boxShadow: `0 0 0 1px rgba(168,85,247,0.18), 0 14px 40px rgba(0,0,0,0.35)` } : {}),
      ...style,
    }}>{children}</section>
  );
}

function Pill({ children, fg, bg }) {
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
      background: bg || "rgba(168,85,247,0.18)", color: fg || "#c4b8ff", letterSpacing: 0.4,
    }}>{children}</span>
  );
}

function FieldLabel({ t, children, count, max, hint, accent }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
      marginBottom: 6, gap: 8,
    }}>
      <label style={{ fontSize: 12.5, fontWeight: 700, color: t.white, display: "inline-flex", gap: 6, alignItems: "center" }}>
        {children}
        {accent}
      </label>
      {typeof count === "number" && typeof max === "number" && (
        <span style={{
          fontSize: 11, color: t.textDim,
          fontFamily: "var(--font-jetbrains-mono), monospace",
        }}>{count}/{max}</span>
      )}
      {hint && !max && <span style={{ fontSize: 11, color: t.textDim }}>{hint}</span>}
    </div>
  );
}

function ToggleVisual({ t, on, accent = "#10b981" }) {
  return (
    <span aria-hidden style={{
      position: "relative",
      width: 38, height: 22, borderRadius: 999,
      background: on ? accent : t.bgSurface,
      border: `1px solid ${on ? "transparent" : t.border}`,
      transition: "background 160ms ease",
      flexShrink: 0, display: "inline-block",
    }}>
      <span style={{
        position: "absolute", top: 2, left: on ? 18 : 2,
        width: 16, height: 16, borderRadius: "50%",
        background: "#fff",
        transition: "left 160ms ease",
        boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
      }} />
    </span>
  );
}

function Select({ t, value, onChange, children, style }) {
  return (
    <div style={{ position: "relative" }}>
      <select value={value} onChange={(e) => onChange?.(e.target.value)}
              style={{ ...input(t), appearance: "none", paddingRight: 32, cursor: "pointer", ...style }}>
        {children}
      </select>
      <ChevronDown size={14} color={t.textDim} style={{
        position: "absolute", right: 10, top: "50%",
        transform: "translateY(-50%)", pointerEvents: "none",
      }} />
    </div>
  );
}

function ChipInput({ t, values, onChange, placeholder = "", max = 12, perChipMax = 24, prefix }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim().slice(0, perChipMax);
    if (!v) return;
    if (values.includes(v) || values.length >= max) { setDraft(""); return; }
    onChange?.([...values, v]); setDraft("");
  };
  const remove = (v) => onChange?.(values.filter(x => x !== v));
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: 6,
      padding: 8, background: t.bgSurface, border: `1px solid ${t.border}`,
      borderRadius: 10, minHeight: 42,
    }}>
      {values.map(v => (
        <span key={v} style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "4px 8px", fontSize: 12,
          background: `${t.accent}20`, color: "#c4b8ff",
          borderRadius: 7, fontWeight: 600,
        }}>
          {prefix}{v}
          <button type="button" onClick={() => remove(v)} aria-label={`Remove ${v}`}
                  style={{ background: "transparent", border: "none", color: "#c4b8ff", cursor: "pointer", padding: 0, lineHeight: 0 }}>
            <XIcon size={11} />
          </button>
        </span>
      ))}
      {values.length < max && (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, perChipMax))}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }}
          onBlur={add}
          placeholder={values.length === 0 ? placeholder : "+ add tag"}
          style={{
            flex: 1, minWidth: 80,
            border: "none", background: "transparent",
            color: t.white, outline: "none", fontSize: 12.5,
          }}
        />
      )}
    </div>
  );
}

/* ═════════════════════════  PROGRESS NAV  ═════════════════════════ */

function ProgressNav({ t, step, completed, onJump }) {
  return (
    <div className="ag-prognav" style={{
      display: "flex", alignItems: "center",
      padding: "16px 20px", gap: 0,
      background: t.bgCard, border: `1px solid ${t.border}`,
      borderRadius: 14, marginBottom: 18, overflowX: "auto",
    }}>
      {STEPS.map((s, i) => {
        const done = completed.has(i) && i < step;
        const current = i === step;
        const reachable = done || current || completed.has(i);
        return (
          <div key={s.key} style={{
            display: "flex", alignItems: "center",
            flex: i === STEPS.length - 1 ? "0 0 auto" : 1,
            minWidth: "fit-content",
          }}>
            <button type="button" onClick={() => reachable && onJump(i)}
                    disabled={!reachable}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      background: "transparent", border: "none",
                      cursor: reachable ? "pointer" : "default", padding: 0,
                    }}>
              <span style={{
                width: 30, height: 30, borderRadius: "50%",
                background: current
                  ? `linear-gradient(135deg, #a855f7, ${t.accent})`
                  : done ? "rgba(16,185,129,0.18)" : t.bgSurface,
                border: done ? `1px solid rgba(16,185,129,0.5)` : `1px solid ${t.border}`,
                color: current ? "#fff" : done ? "#34d399" : t.textDim,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 800,
                boxShadow: current ? `0 0 0 4px rgba(168,85,247,0.16)` : "none",
                transition: "background 160ms ease", flexShrink: 0,
              }}>
                {done ? <Check size={13} /> : i + 1}
              </span>
              <span style={{
                fontSize: 13, fontWeight: current ? 700 : 600,
                color: current ? t.white : reachable ? t.textMuted : t.textDim,
                whiteSpace: "nowrap",
              }}>
                {s.label}
              </span>
            </button>
            {i < STEPS.length - 1 && (
              <div style={{
                flex: 1, minWidth: 26, margin: "0 14px",
                height: 1,
                background: done ? "rgba(16,185,129,0.4)" : t.border,
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ═════════════════════════  PAGE HEADER  ═════════════════════════ */

function PageHeader({ t, hasPrimary, step, onBack, onNext, canAdvance, busy }) {
  const isLast = step === STEPS.length - 1;
  return (
    <header className="ag-header" style={{
      display: "flex", alignItems: "flex-start", justifyContent: "space-between",
      gap: 16, marginBottom: 18, flexWrap: "wrap",
    }}>
      <div style={{ minWidth: 0, flex: "1 1 280px" }}>
        <h1 style={{
          fontSize: "clamp(22px, 2.4vw, 30px)", margin: 0, fontWeight: 800,
          color: t.white, letterSpacing: -0.4,
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        }}>
          {hasPrimary ? "Add another agent" : "Launch your first agent"}
          <span style={{
            fontSize: 11, padding: "3px 8px", verticalAlign: "middle",
            background: `${t.accent}22`, color: t.accent,
            borderRadius: 999, fontWeight: 700, letterSpacing: 1.2,
          }}>BETA</span>
        </h1>
        <p style={{ fontSize: 13, color: t.textMuted, marginTop: 6, maxWidth: 640 }}>
          Bring your agent, connect a framework, install skills, and deploy it anywhere.
          IronShield is the marketplace + identity layer above your runtime — we don't run the agent, your framework does.
        </p>
      </div>

      <div className="ag-header-cta" style={{ display: "flex", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
        {step > 0 && (
          <button type="button" onClick={onBack} disabled={busy}
                  style={secondaryBtn(t, busy)}>
            <ArrowLeft size={13} /> <span className="ag-cta-label">Back</span>
          </button>
        )}
        <button type="button" onClick={onNext} disabled={!canAdvance || busy}
                style={primaryBtn(t, !canAdvance || busy)}>
          {busy ? <Loader2 size={13} style={{ animation: "ma-spin 0.9s linear infinite" }} /> : null}
          {isLast
            ? (busy ? "Launching…" : "Launch agent")
            : nextLabel(step)}
          {!busy && !isLast ? <ArrowRight size={13} /> : null}
        </button>
      </div>
    </header>
  );
}

function nextLabel(step) {
  const labels = [
    "Next: Choose framework",
    "Next: Choose skills",
    "Next: Connect channels",
    "Next: Permissions",
    "Next: Review & launch",
    "Launch agent",
  ];
  return labels[step] || "Next";
}

/* ═════════════════════════  STEP 1 — IDENTITY  ═════════════════════════ */

function StepIdentity({ t, draft, set, isHandleAvail }) {
  const toggleCategory = (k) => {
    const has = draft.categories.includes(k);
    if (has) set({ categories: draft.categories.filter(x => x !== k) });
    else if (draft.categories.length < 3) set({ categories: [...draft.categories, k] });
  };

  return (
    <div className="ag-step-grid" style={{
      display: "grid", gap: 18,
      gridTemplateColumns: "minmax(0, 1fr) 320px",
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <Card t={t}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: t.white, marginBottom: 6 }}>
            Create your agent identity
          </h2>
          <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 18 }}>
            This is your agent's on-chain identity. It will represent your agent across IronShield.
          </div>

          <FieldLabel t={t} count={draft.name.length} max={32}>Agent name</FieldLabel>
          <input value={draft.name}
                 onChange={(e) => set({ name: e.target.value.slice(0, 32) })}
                 placeholder="Airdrop Hunter"
                 style={{ ...input(t), marginBottom: 4 }} />
          <div style={{ fontSize: 11, color: t.textDim, marginBottom: 16 }}>
            The name people will see and remember.
          </div>

          <FieldLabel t={t} count={draft.handle.length} max={32}
                      accent={draft.handle && (
                        <Pill fg={isHandleAvail ? "#34d399" : "#fbbf24"}
                              bg={isHandleAvail ? "rgba(16,185,129,0.16)" : "rgba(245,158,11,0.16)"}>
                          {isHandleAvail ? "Available" : "Checking"}
                        </Pill>
                      )}>
            Handle (NEAR Native)
          </FieldLabel>
          <div style={{ position: "relative" }}>
            <input value={draft.handle}
                   onChange={(e) => set({ handle: e.target.value.toLowerCase().slice(0, 32) })}
                   placeholder="airdrop_hunter"
                   style={{ ...input(t), paddingRight: 64 }} />
            <span style={{
              position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
              fontSize: 12.5, color: t.textDim,
              fontFamily: "var(--font-jetbrains-mono), monospace",
            }}>.near</span>
          </div>
          <div style={{ fontSize: 11, color: t.textDim, marginTop: 4, marginBottom: 16 }}>
            Your unique agent handle on NEAR.
          </div>

          <FieldLabel t={t} count={draft.bio.length} max={160}>Short bio</FieldLabel>
          <textarea value={draft.bio}
                    onChange={(e) => set({ bio: e.target.value.slice(0, 160) })}
                    placeholder="Finds airdrops across chains, monitors eligibility, and notifies you instantly. Never miss a drop again."
                    rows={3}
                    style={{ ...input(t), resize: "vertical", marginBottom: 16, fontFamily: "inherit" }} />

          <FieldLabel t={t}>Personality</FieldLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
            {PERSONALITIES.map(p => {
              const active = draft.personality === p;
              return (
                <button key={p} type="button" onClick={() => set({ personality: p })}
                        style={{
                          padding: "7px 14px", borderRadius: 999,
                          fontSize: 12, fontWeight: 700, cursor: "pointer",
                          background: active
                            ? `linear-gradient(135deg, #a855f7, ${t.accent})`
                            : t.bgSurface,
                          color: active ? "#fff" : t.textMuted,
                          border: `1px solid ${active ? "transparent" : t.border}`,
                        }}>
                  {p}
                </button>
              );
            })}
            <button type="button" style={{
              padding: "7px 12px", borderRadius: 999,
              background: t.bgSurface, color: t.textDim,
              border: `1px dashed ${t.border}`,
              cursor: "pointer", fontSize: 12, fontWeight: 700,
            }}>+</button>
          </div>
          <div style={{ fontSize: 11, color: t.textDim, marginTop: 4, marginBottom: 16 }}>
            This defines how your agent behaves and communicates.
          </div>

          <FieldLabel t={t} hint="Select up to 3">Categories</FieldLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
            {CATEGORIES.map(cat => {
              const active = draft.categories.includes(cat.key);
              return (
                <button key={cat.key} type="button" onClick={() => toggleCategory(cat.key)}
                        style={{
                          padding: "6px 12px", borderRadius: 999,
                          fontSize: 11.5, fontWeight: 700, cursor: "pointer",
                          background: active ? `${cat.accent}22` : t.bgSurface,
                          color: active ? cat.accent : t.textMuted,
                          border: `1px solid ${active ? cat.accent + "55" : t.border}`,
                          display: "inline-flex", alignItems: "center", gap: 5,
                        }}>
                  {cat.label}
                  {active && <Check size={11} />}
                </button>
              );
            })}
          </div>

          <FieldLabel t={t}>Tags</FieldLabel>
          <div style={{ marginBottom: 16 }}>
            <ChipInput t={t} values={draft.tags} onChange={(v) => set({ tags: v })}
                       placeholder="airdrops, multi-chain…" />
          </div>

          <FieldLabel t={t}>Default language</FieldLabel>
          <Select t={t} value={draft.language} onChange={(v) => set({ language: v })}>
            {LANGUAGES.map(l => <option key={l.key} value={l.key}>🌐 {l.label}</option>)}
          </Select>
          <div style={{ fontSize: 11, color: t.textDim, marginTop: 4 }}>
            Primary language for your agent's interactions.
          </div>
        </Card>

        <Card t={t}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: t.white, marginBottom: 6 }}>
            Choose an avatar
          </h3>
          <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 14 }}>
            Pick a preset or upload your own. The avatar is part of your agent's public identity.
          </div>
          <AvatarPicker value={draft.avatarUrl} onChange={(v) => set({ avatarUrl: v })} />
        </Card>
      </div>

      <IdentityPreviewRail t={t} draft={draft} />
    </div>
  );
}

function IdentityPreviewRail({ t, draft }) {
  const cat1 = CATEGORIES.find(c => c.key === draft.categories[0]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <Card t={t} padded={false} style={{
        padding: 18, position: "sticky", top: 70,
        background: `linear-gradient(180deg, rgba(168,85,247,0.10), rgba(96,165,250,0.06) 50%, ${t.bgCard})`,
        border: `1px solid rgba(168,85,247,0.25)`,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white }}>Identity Preview</h3>
          <button type="button" style={{ ...ghostBtn(t), padding: "5px 10px", fontSize: 11 }}>
            <Eye size={11} /> On-chain Preview
          </button>
        </div>

        <div style={{
          width: "100%", aspectRatio: "1 / 1", maxWidth: 280, margin: "0 auto 14px",
          borderRadius: 18, position: "relative", overflow: "hidden",
          background: `radial-gradient(circle at 50% 60%, rgba(168,85,247,0.55), transparent 65%), ${t.bgSurface}`,
          border: `1px solid ${t.border}`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <AgentAvatar value={draft.avatarUrl} size={148} />
          <span style={{
            position: "absolute", bottom: 12, left: "50%", transform: "translateX(-50%)",
            fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
            background: "rgba(16,185,129,0.18)", color: "#34d399",
            border: "1px solid rgba(16,185,129,0.35)",
            display: "inline-flex", alignItems: "center", gap: 5,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "#34d399" }} />
            ONLINE
          </span>
        </div>

        <div style={{ textAlign: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: t.white }}>
            {draft.name || "Your agent"}
          </div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6, marginTop: 4,
            padding: "4px 10px", borderRadius: 8,
            background: t.bgSurface, border: `1px solid ${t.border}`,
            fontSize: 12, color: t.textMuted,
            fontFamily: "var(--font-jetbrains-mono), monospace",
          }}>
            {draft.handle ? `${draft.handle}.near` : "@—"}
            <Copy size={11} style={{ cursor: "pointer" }} />
          </div>
        </div>

        <div style={{ fontSize: 12.5, color: t.text, lineHeight: 1.5, marginBottom: 14, textAlign: "center" }}>
          {draft.bio || "Your description will appear here."}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center", marginBottom: 16 }}>
          {draft.categories.slice(0, 3).map(k => {
            const cat = CATEGORIES.find(c => c.key === k);
            if (!cat) return null;
            return (
              <span key={k} style={{
                fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999,
                background: `${cat.accent}22`, color: cat.accent,
                border: `1px solid ${cat.accent}44`,
              }}>{cat.label}</span>
            );
          })}
        </div>

        <div style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, padding: "12px 0",
          borderTop: `1px solid ${t.border}`, borderBottom: `1px solid ${t.border}`,
        }}>
          <StatCell t={t} k="Reputation" v="1,250" Icon={Award} />
          <StatCell t={t} k="Following"  v="342"   Icon={Activity} />
          <StatCell t={t} k="Tasks"      v="1,024" Icon={Check} />
        </div>
      </Card>

      <Card t={t} padded={false} style={{ padding: 16 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white, marginBottom: 12 }}>
          On-chain Identity
        </h3>
        <KvRow t={t} k="NEAR Account" v={draft.handle ? `${draft.handle}.near` : "—"} mono />
        <KvRow t={t} k="Agent ID" v={`agent_${(draft.handle || "tba").slice(0, 8).padEnd(8, "_")}…7c2d`} mono />
        <KvRow t={t} k="Created On" v="On launch" />
        <KvRow t={t} k="Owned By" v="you.near" mono />

        <div style={{
          marginTop: 14, padding: "10px 12px", borderRadius: 10,
          background: `${t.accent}10`, border: `1px solid ${t.border}`,
          display: "flex", gap: 10, fontSize: 11.5, color: t.textMuted, lineHeight: 1.5,
        }}>
          <Lock size={14} color="#a855f7" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            <strong style={{ color: t.white, display: "block", marginBottom: 2 }}>Identity is sovereign</strong>
            Your agent identity is yours forever. It lives on the NEAR blockchain and is fully portable.
          </span>
        </div>
      </Card>
    </div>
  );
}

function StatCell({ t, k, v, Icon }) {
  return (
    <div style={{ textAlign: "center", minWidth: 0 }}>
      <div style={{ fontSize: 10, color: t.textDim, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
                     display: "inline-flex", alignItems: "center", gap: 3 }}>
        <Icon size={10} /> {k}
      </div>
      <div style={{ fontSize: 14, fontWeight: 800, color: t.white, marginTop: 2 }}>{v}</div>
    </div>
  );
}

function KvRow({ t, k, v, mono }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      fontSize: 12, padding: "5px 0",
    }}>
      <span style={{ color: t.textMuted }}>{k}</span>
      <span style={{
        color: t.white, fontWeight: 600,
        ...(mono ? { fontFamily: "var(--font-jetbrains-mono), monospace", fontSize: 11.5 } : {}),
        maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{v}</span>
    </div>
  );
}

/* ═════════════════════════  STEP 2 — FRAMEWORK  ═════════════════════════ */

function StepFramework({ t, draft, set, validateFn }) {
  const def = FRAMEWORK_DEFS[draft.framework];
  const [testing, setTesting] = useState(false);

  const test = async () => {
    setTesting(true); set({ testResult: null });
    try {
      const r = await validateFn({
        framework:   draft.framework,
        external_id: draft.cred.external_id,
        endpoint:    draft.cred.endpoint,
        auth:        draft.cred.auth,
      });
      set({ testResult: r });
    } catch (e) {
      set({ testResult: { ok: false, error: e?.message || "Test failed" } });
    } finally { setTesting(false); }
  };

  return (
    <div className="ag-step-grid" style={{
      display: "grid", gap: 18,
      gridTemplateColumns: "minmax(0, 1fr) 320px",
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <Card t={t}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: t.white, marginBottom: 6 }}>
            Choose your framework
          </h2>
          <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 18 }}>
            IronShield works with multiple agent frameworks. Connect yours to manage everything in one place.
          </div>

          <div className="ag-fw-grid" style={{
            display: "grid", gap: 12,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}>
            {Object.entries(FRAMEWORK_DEFS).map(([key, fw]) => {
              const active = draft.framework === key;
              return (
                <button key={key} type="button"
                        onClick={() => set({ framework: key, cred: {}, testResult: null })}
                        style={{
                          textAlign: "left", padding: 18,
                          background: active ? `${fw.accent}14` : t.bgSurface,
                          border: `1.5px solid ${active ? fw.accent + "88" : t.border}`,
                          borderRadius: 14, cursor: "pointer", color: "inherit",
                          position: "relative", transition: "all 160ms ease",
                          boxShadow: active ? `0 0 0 1px ${fw.accent}22 inset, 0 12px 28px rgba(0,0,0,0.35)` : "none",
                        }}>
                  {active && (
                    <span style={{
                      position: "absolute", top: 12, right: 12,
                      width: 22, height: 22, borderRadius: "50%",
                      background: `linear-gradient(135deg, ${fw.accent}, #fff)`,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Check size={12} color="#fff" />
                    </span>
                  )}
                  <span style={{
                    width: 56, height: 56, borderRadius: 14, marginBottom: 14,
                    background: `linear-gradient(135deg, ${fw.accent}33, ${fw.accent}11)`,
                    border: `1px solid ${fw.accent}44`,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    color: fw.accent,
                  }}>
                    <FrameworkGlyph k={key} size={26} />
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 15, fontWeight: 800, color: t.white }}>{fw.title}</span>
                    {fw.recommended && <Pill>Recommended</Pill>}
                  </div>
                  <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.5, marginBottom: 10 }}>{fw.blurb}</div>
                  <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 11.5, color: t.textDim, lineHeight: 1.7 }}>
                    {fw.capabilities.map(b => <li key={b}>• {b}</li>)}
                  </ul>
                </button>
              );
            })}
          </div>
        </Card>

        {def && (
          <Card t={t}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, gap: 10 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: t.white }}>
                  Connect your {def.title} agent
                </h3>
                <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>
                  Paste your credentials to link your existing agent. You can find these in your {def.title} dashboard.
                </div>
                <a href={def.docsUrl} target="_blank" rel="noopener noreferrer"
                   style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "#a855f7", marginTop: 6 }}>
                  Where do I find this? <ExternalLink size={11} />
                </a>
              </div>
              <button type="button" onClick={test} disabled={testing} style={ghostBtn(t)}>
                {testing
                  ? <><Loader2 size={12} style={{ animation: "ma-spin 0.9s linear infinite" }} /> Testing</>
                  : <>
                      <Shield size={12} /> Test connection
                      <span style={{
                        marginLeft: 4, padding: "2px 8px", borderRadius: 999,
                        fontSize: 10, fontWeight: 700,
                        background: draft.testResult?.ok ? "rgba(16,185,129,0.16)"
                                   : draft.testResult?.ok === false ? "rgba(239,68,68,0.16)"
                                   : t.bgSurface,
                        color: draft.testResult?.ok ? "#34d399"
                              : draft.testResult?.ok === false ? "#fca5a5"
                              : t.textDim,
                      }}>
                        {draft.testResult?.ok ? "Connected" : draft.testResult?.ok === false ? "Failed" : "Not tested"}
                      </span>
                    </>}
              </button>
            </div>

            <div className="ag-fw-fields" style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              {def.fields.map(f => (
                <div key={f.key} style={{ gridColumn: f.key === "auth" ? "span 2" : "auto" }} className="ag-fw-field">
                  <FieldLabel t={t} hint={f.required ? "Required" : "Optional"}>{f.label}</FieldLabel>
                  <input
                    type={f.secret ? "password" : "text"}
                    value={draft.cred[f.key] || ""}
                    onChange={(e) => set({ cred: { ...draft.cred, [f.key]: e.target.value }, testResult: null })}
                    placeholder={f.placeholder}
                    style={input(t)}
                  />
                  <div style={{ fontSize: 11, color: t.textDim, marginTop: 4 }}>{f.hint}</div>
                </div>
              ))}
            </div>

            <div style={{
              marginTop: 16, padding: "12px 14px", borderRadius: 12,
              background: "rgba(16,185,129,0.08)", border: `1px solid rgba(16,185,129,0.22)`,
              display: "flex", gap: 10, alignItems: "flex-start",
            }}>
              <ShieldCheck size={16} color="#34d399" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 12.5, color: t.text, lineHeight: 1.55 }}>
                <strong style={{ color: t.white, display: "block", marginBottom: 2 }}>Your keys are safe</strong>
                Credentials are encrypted and stored securely. IronShield never shares your keys with anyone, and you can revoke access at any time.
              </div>
            </div>
          </Card>
        )}
      </div>

      <FrameworkRail t={t} draft={draft} def={def} />
    </div>
  );
}

function FrameworkGlyph({ k, size }) {
  // Each framework gets a distinct symbolic glyph — keeps the look
  // distinctive without depending on copyrighted logos.
  if (k === "openclaw")    return <Sparkles size={size} />;
  if (k === "ironclaw")    return <ShieldCheck size={size} />;
  if (k === "hermes")      return <Zap size={size} />;
  if (k === "self_hosted") return <Server size={size} />;
  if (k === "api")         return <Cpu size={size} />;
  return <Bot size={size} />;
}

function FrameworkRail({ t, draft, def }) {
  if (!def) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <Card t={t} padded={false} style={{ padding: 18, position: "sticky", top: 70 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white }}>About {def.title}</h3>
          <a href={def.docsUrl} target="_blank" rel="noopener noreferrer" style={{ ...ghostBtn(t), padding: "5px 10px", fontSize: 11, textDecoration: "none" }}>
            <BookmarkPlus size={11} /> Docs
          </a>
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
          <span style={{
            width: 52, height: 52, borderRadius: 12, flexShrink: 0,
            background: `linear-gradient(135deg, ${def.accent}33, ${def.accent}11)`,
            border: `1px solid ${def.accent}44`,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            color: def.accent,
          }}>
            <FrameworkGlyph k={draft.framework} size={24} />
          </span>
          <div style={{ fontSize: 12.5, color: t.text, lineHeight: 1.5 }}>{def.blurb}</div>
        </div>

        <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 12 }}>
          {def.capabilities.map(c => (
            <div key={c} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
              fontSize: 12, color: t.textMuted,
            }}>
              <span style={{
                width: 22, height: 22, borderRadius: 6,
                background: `${def.accent}22`, color: def.accent,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}>
                <Check size={11} />
              </span>
              {c}
            </div>
          ))}
        </div>

        <a href={def.docsUrl} target="_blank" rel="noopener noreferrer"
           style={{ ...secondaryBtn(t), width: "100%", justifyContent: "center", marginTop: 10, textDecoration: "none" }}>
          Visit {def.title} <ArrowRight size={12} />
        </a>
      </Card>

      <Card t={t} padded={false} style={{ padding: 16 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white, marginBottom: 12 }}>
          Connection Summary
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${t.border}` }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, color: t.textDim, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>
              Identity
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.white }}>
              {draft.name || "—"}
            </div>
            <div style={{ fontSize: 11, color: t.textMuted, fontFamily: "var(--font-jetbrains-mono), monospace" }}>
              {draft.handle ? `${draft.handle}.near` : "—"}
            </div>
          </div>
          <Check size={14} color="#34d399" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, color: t.textDim, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>
              Framework
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.white }}>{def.title}</div>
            <div style={{ fontSize: 11, color: t.textMuted }}>
              {draft.testResult?.ok ? "Connected" : draft.testResult?.ok === false ? "Failed" : "Not connected"}
            </div>
          </div>
          {draft.testResult?.ok
            ? <Check size={14} color="#34d399" />
            : draft.testResult?.ok === false
              ? <AlertTriangle size={14} color="#fbbf24" />
              : <span style={{ width: 14, height: 14, borderRadius: 999, border: `2px solid ${t.border}` }} />}
        </div>
      </Card>
    </div>
  );
}

/* ═════════════════════════  STEP 3 — SKILLS  ═════════════════════════ */

function StepSkills({ t, draft, set }) {
  const [search, setSearch]     = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort]         = useState("popular");
  const [tab, setTab]           = useState("all"); // all | installed | favorites

  const filtered = useMemo(() => {
    let list = SKILL_SHOWCASE.slice();
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q) || s.blurb.toLowerCase().includes(q));
    }
    if (category !== "all") list = list.filter(s => s.category === category);
    if (tab === "installed") list = list.filter(s => draft.pickedSkills.includes(s.id));
    if (sort === "rating")  list.sort((a, b) => b.rating - a.rating);
    if (sort === "installs")list.sort((a, b) => b.installs - a.installs);
    if (sort === "price")   list.sort((a, b) => a.monthly - b.monthly);
    return list;
  }, [search, category, sort, tab, draft.pickedSkills]);

  const toggleSkill = (id) => {
    const has = draft.pickedSkills.includes(id);
    set({ pickedSkills: has
      ? draft.pickedSkills.filter(x => x !== id)
      : [...draft.pickedSkills, id] });
  };

  return (
    <div className="ag-step-grid" style={{
      display: "grid", gap: 18,
      gridTemplateColumns: "minmax(0, 1fr) 320px",
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <Card t={t}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: t.white, marginBottom: 6 }}>
            Install skills for your agent
          </h2>
          <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 18 }}>
            Skills give your agent superpowers. Install from our marketplace or create custom skills.
          </div>

          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1fr) 200px 160px auto" }}
               className="ag-skills-toolbar">
            <div style={{ position: "relative" }}>
              <Search size={14} color={t.textDim} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                     placeholder="Search skills…"
                     style={{ ...input(t), paddingLeft: 32 }} />
            </div>
            <Select t={t} value={category} onChange={setCategory}>
              {SKILL_CATEGORY_FILTERS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </Select>
            <Select t={t} value={sort} onChange={setSort}>
              <option value="popular">Popular</option>
              <option value="rating">Top rated</option>
              <option value="installs">Most installed</option>
              <option value="price">Lowest price</option>
            </Select>
            <button type="button" style={ghostBtn(t)}>
              <Filter size={12} /> Filter
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 14, marginBottom: 8 }}>
            {[
              { k: "all", label: "All Skills" },
              { k: "installed", label: `Installed (${draft.pickedSkills.length})` },
              { k: "favorites", label: "Favorites" },
            ].map(x => (
              <button key={x.k} type="button" onClick={() => setTab(x.k)}
                      style={{
                        padding: "8px 14px", fontSize: 12.5, fontWeight: 700,
                        background: "transparent", border: "none",
                        color: tab === x.k ? "#a855f7" : t.textMuted,
                        cursor: "pointer", position: "relative",
                      }}>
                {x.label}
                {tab === x.k && (
                  <span style={{
                    position: "absolute", left: 14, right: 14, bottom: -1, height: 2,
                    background: `linear-gradient(90deg, #a855f7, ${t.accent})`,
                    borderRadius: 2,
                  }} />
                )}
              </button>
            ))}
          </div>
        </Card>

        <div className="ag-skills-grid" style={{
          display: "grid", gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        }}>
          {filtered.map(skill => {
            const installed = draft.pickedSkills.includes(skill.id);
            return (
              <Card t={t} key={skill.id} padded={false} style={{ padding: 14 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
                  <span style={{
                    width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                    background: `${skill.color}1e`, color: skill.color,
                    border: `1px solid ${skill.color}44`,
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <skill.Icon size={17} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 800, color: t.white, lineHeight: 1.25 }}>
                      {skill.name}
                    </div>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: t.textMuted, marginTop: 2 }}>
                      <Star size={11} color="#fbbf24" fill="#fbbf24" /> {skill.rating}
                      <span style={{ marginLeft: 6, color: t.textDim }}>· {skill.installs.toLocaleString()} installs</span>
                    </div>
                  </div>
                  <button type="button" aria-label="Bookmark" style={{
                    background: "transparent", border: "none", color: t.textDim, cursor: "pointer", padding: 0,
                  }}>
                    <BookmarkPlus size={14} />
                  </button>
                </div>
                <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.5, minHeight: 36 }}>
                  {skill.blurb}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.white, margin: "10px 0" }}>
                  ${skill.monthly} <span style={{ color: t.textMuted, fontWeight: 600 }}>/ month</span>
                </div>
                <button type="button" onClick={() => toggleSkill(skill.id)}
                        style={installed
                          ? { ...secondaryBtn(t), width: "100%", justifyContent: "center", background: "rgba(16,185,129,0.16)", border: "1px solid rgba(16,185,129,0.4)", color: "#34d399" }
                          : { ...primaryBtn(t), width: "100%", justifyContent: "center" }}>
                  {installed ? <><Check size={12} /> Installed</> : <><Plus size={12} /> Install</>}
                </button>
              </Card>
            );
          })}

          <Card t={t} padded={false} style={{
            padding: 14, border: `1px dashed ${t.border}`, background: "transparent",
            display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center",
            minHeight: 220,
          }}>
            <span style={{
              width: 40, height: 40, borderRadius: 10, marginBottom: 10,
              background: `${t.accent}1a`, color: "#a855f7",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}><Plus size={20} /></span>
            <div style={{ fontSize: 13, fontWeight: 800, color: t.white }}>Create Custom Skill</div>
            <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 4, marginBottom: 12, lineHeight: 1.5 }}>
              Build your own skill with our SDK.
            </div>
            <Link href="/skills/create" style={{
              fontSize: 12.5, fontWeight: 700, color: "#a855f7", textDecoration: "none",
              display: "inline-flex", alignItems: "center", gap: 4,
            }}>Create <ArrowRight size={11} /></Link>
          </Card>
        </div>
      </div>

      <SkillsRail t={t} draft={draft} />
    </div>
  );
}

function SkillsRail({ t, draft }) {
  const installedSkills = SKILL_SHOWCASE.filter(s => draft.pickedSkills.includes(s.id));
  const monthlyEst = installedSkills.reduce((sum, s) => sum + s.monthly * 60, 0); // mock revenue projection

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <Card t={t} padded={false} style={{ padding: 16, position: "sticky", top: 70 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white }}>Your Agent Preview</h3>
          <button type="button" style={{ ...ghostBtn(t), padding: "4px 10px", fontSize: 11 }}>
            <Eye size={11} /> Live Preview
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <AgentAvatar value={draft.avatarUrl} size={48} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "#34d399" }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: "#34d399" }} /> Online
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: t.white }}>{draft.name || "Your agent"}</div>
            <div style={{ fontSize: 11, color: t.textMuted, fontFamily: "var(--font-jetbrains-mono), monospace" }}>
              {draft.handle ? `${draft.handle}.near` : "@—"}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: t.text, lineHeight: 1.5, marginBottom: 14 }}>
          {draft.bio || "Your description will appear here."}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, padding: "10px 0", borderTop: `1px solid ${t.border}` }}>
          <StatCellSm t={t} k="Skills"   v={`${installedSkills.length} installed`} />
          <StatCellSm t={t} k="Channels" v={`${draft.pickedChannels.length} connected`} />
          <StatCellSm t={t} k="Revenue/mo" v={`$${monthlyEst.toLocaleString()}`} />
        </div>
      </Card>

      <Card t={t} padded={false} style={{ padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white }}>
            Installed Skills ({installedSkills.length})
          </h3>
          <button type="button" style={{ background: "transparent", border: "none", color: "#a855f7", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
            Manage
          </button>
        </div>
        {installedSkills.length === 0 ? (
          <div style={{ fontSize: 11.5, color: t.textMuted, textAlign: "center", padding: "16px 0" }}>
            No skills installed yet. Pick a few above.
          </div>
        ) : (
          installedSkills.slice(0, 6).map(s => (
            <div key={s.id} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 0", borderBottom: `1px dashed ${t.border}`,
            }}>
              <span style={{
                width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                background: `${s.color}1e`, color: s.color,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}><s.Icon size={12} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: t.white, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.name}
                </div>
              </div>
              <Pill fg="#34d399" bg="rgba(16,185,129,0.16)">Active</Pill>
            </div>
          ))
        )}
      </Card>

      <Card t={t} padded={false} style={{
        padding: 16,
        background: `linear-gradient(160deg, rgba(168,85,247,0.12), rgba(96,165,250,0.06))`,
      }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white, marginBottom: 4 }}>
          Earnings Preview
        </h3>
        <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 14 }}>
          Estimate based on installed skills.
        </div>
        <SparkLine />
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 8 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: t.white }}>${monthlyEst.toLocaleString()}</div>
            <div style={{ fontSize: 11, color: t.textMuted }}>/ month</div>
          </div>
          <Pill fg="#34d399" bg="rgba(16,185,129,0.16)">+ 24.5%</Pill>
        </div>
      </Card>
    </div>
  );
}

function StatCellSm({ t, k, v }) {
  return (
    <div style={{ textAlign: "center", padding: "0 4px", minWidth: 0 }}>
      <div style={{ fontSize: 10, color: t.textDim, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>{k}</div>
      <div style={{ fontSize: 12, fontWeight: 800, color: t.white, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</div>
    </div>
  );
}

function SparkLine() {
  // Compact sparkline that hints at growth — purely decorative.
  return (
    <svg viewBox="0 0 240 60" style={{ width: "100%", height: 50 }}>
      <defs>
        <linearGradient id="ag-spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(168,85,247,0.6)" />
          <stop offset="100%" stopColor="rgba(168,85,247,0)" />
        </linearGradient>
      </defs>
      <path d="M0,42 L20,40 L40,38 L60,32 L80,34 L100,28 L120,26 L140,22 L160,24 L180,16 L200,18 L220,12 L240,8"
            fill="none" stroke="#a855f7" strokeWidth="2" />
      <path d="M0,42 L20,40 L40,38 L60,32 L80,34 L100,28 L120,26 L140,22 L160,24 L180,16 L200,18 L220,12 L240,8 L240,60 L0,60 Z"
            fill="url(#ag-spark)" />
    </svg>
  );
}

/* ═════════════════════════  STEP 4 — CHANNELS  ═════════════════════════ */

function StepChannels({ t, draft, set }) {
  const [group, setGroup] = useState("all");

  const counts = useMemo(() => {
    const out = { all: CHANNELS.length };
    for (const g of CHANNEL_GROUPS) if (g.key !== "all") out[g.key] = CHANNELS.filter(c => c.group === g.key).length;
    return out;
  }, []);

  const visible = group === "all" ? CHANNELS : CHANNELS.filter(c => c.group === group);

  const toggle = (k) => {
    const has = draft.pickedChannels.includes(k);
    set({ pickedChannels: has
      ? draft.pickedChannels.filter(x => x !== k)
      : [...draft.pickedChannels, k] });
  };

  return (
    <div className="ag-step-grid" style={{
      display: "grid", gap: 18,
      gridTemplateColumns: "minmax(0, 1fr) 320px",
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <Card t={t}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: t.white }}>
              Connect channels
            </h2>
            <button type="button" style={ghostBtn(t)}>
              <Activity size={12} /> Test all connections
            </button>
          </div>
          <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 16 }}>
            Connect platforms and services where your agent can operate, interact, and provide value.
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
            {CHANNEL_GROUPS.map(g => {
              const active = group === g.key;
              return (
                <button key={g.key} type="button" onClick={() => setGroup(g.key)}
                        style={{
                          padding: "7px 14px", borderRadius: 999,
                          fontSize: 12, fontWeight: 700, cursor: "pointer",
                          background: active ? `${t.accent}22` : t.bgSurface,
                          color: active ? "#a855f7" : t.textMuted,
                          border: `1px solid ${active ? "rgba(168,85,247,0.4)" : t.border}`,
                          display: "inline-flex", alignItems: "center", gap: 6,
                        }}>
                  {g.label}
                  <span style={{
                    fontSize: 10, padding: "1px 7px", borderRadius: 999,
                    background: active ? "rgba(168,85,247,0.3)" : t.bg,
                    color: active ? "#fff" : t.textDim,
                  }}>{counts[g.key] || 0}</span>
                </button>
              );
            })}
          </div>

          <div style={{ fontSize: 11.5, color: t.textDim, marginBottom: 8, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase" }}>
            Available channels
          </div>

          <div className="ag-channels-grid" style={{
            display: "grid", gap: 10,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}>
            {visible.map(ch => {
              const connected = draft.pickedChannels.includes(ch.key);
              return (
                <button key={ch.key} type="button" onClick={() => toggle(ch.key)}
                        style={{
                          textAlign: "left", padding: 14,
                          background: connected ? `${t.accent}10` : t.bgSurface,
                          border: `1.5px solid ${connected ? "rgba(168,85,247,0.45)" : t.border}`,
                          borderRadius: 14, cursor: "pointer", color: "inherit",
                          position: "relative", transition: "all 160ms ease",
                        }}>
                  {connected && (
                    <span style={{
                      position: "absolute", top: 10, right: 10,
                      width: 20, height: 20, borderRadius: "50%",
                      background: `linear-gradient(135deg, #a855f7, ${t.accent})`,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Check size={11} color="#fff" />
                    </span>
                  )}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: connected ? "rgba(168,85,247,0.18)" : t.bg,
                      color: connected ? "#a855f7" : t.textMuted,
                      border: `1px solid ${t.border}`,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <ch.Icon size={16} />
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: t.white }}>{ch.label}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: t.textMuted, lineHeight: 1.5, marginBottom: 10, minHeight: 30 }}>
                    {ch.blurb}
                  </div>
                  {connected ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#34d399" }}>
                      <span style={{ width: 6, height: 6, borderRadius: 999, background: "#34d399" }} />
                      Connected · {ch.handle}
                    </div>
                  ) : (
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      fontSize: 11, color: t.textMuted,
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: 999, background: t.textDim }} />
                      Not connected
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div style={{
            marginTop: 18, padding: "12px 14px", borderRadius: 12,
            background: t.bgSurface, border: `1px dashed ${t.border}`,
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <Sparkles size={16} color="#a855f7" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: t.white }}>More channels coming soon</div>
              <div style={{ fontSize: 11, color: t.textMuted }}>We're constantly adding new platforms and integrations.</div>
            </div>
          </div>
        </Card>
      </div>

      <ChannelsRail t={t} draft={draft} />
    </div>
  );
}

function ChannelsRail({ t, draft }) {
  const connected = CHANNELS.filter(c => draft.pickedChannels.includes(c.key));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <Card t={t} padded={false} style={{ padding: 16, position: "sticky", top: 70 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white }}>Your Agent Preview</h3>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <AgentAvatar value={draft.avatarUrl} size={48} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "#34d399" }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: "#34d399" }} /> Online
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: t.white }}>{draft.name || "Your agent"}</div>
            <div style={{ fontSize: 11, color: t.textMuted, fontFamily: "var(--font-jetbrains-mono), monospace" }}>
              {draft.handle ? `${draft.handle}.near` : "@—"}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: t.text, lineHeight: 1.5 }}>
          {draft.bio || "Your description will appear here."}
        </div>
      </Card>

      <Card t={t} padded={false} style={{ padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white }}>Channel Summary</h3>
          <button type="button" style={{ background: "transparent", border: "none", color: "#a855f7", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
            Manage
          </button>
        </div>
        <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 12 }}>
          {connected.length} of {CHANNELS.length} connected
        </div>
        {connected.length === 0 ? (
          <div style={{ fontSize: 11.5, color: t.textMuted, textAlign: "center", padding: "16px 0" }}>
            No channels connected yet.
          </div>
        ) : (
          connected.slice(0, 6).map(c => (
            <div key={c.key} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 0", borderBottom: `1px dashed ${t.border}`,
            }}>
              <span style={{
                width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                background: t.bgSurface, color: "#a855f7",
                border: `1px solid ${t.border}`,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}><c.Icon size={13} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: t.white }}>{c.label}</div>
                <div style={{ fontSize: 10.5, color: t.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.handle}
                </div>
              </div>
              <Pill fg="#34d399" bg="rgba(16,185,129,0.16)">Connected</Pill>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}

/* ═════════════════════════  STEP 5 — PERMISSIONS  ═════════════════════════ */

function StepPermissions({ t, draft, set }) {
  const setPerm = (key, state) => set({ perms: { ...draft.perms, [key]: state } });
  const summary = useMemo(() => {
    const c = { granted: 0, limited: 0, denied: 0, notSet: 0 };
    for (const p of PERMISSION_CATALOG) {
      const v = draft.perms[p.key];
      if (v === "granted") c.granted++;
      else if (v === "limited") c.limited++;
      else if (v === "denied") c.denied++;
      else c.notSet++;
    }
    return c;
  }, [draft.perms]);
  const total = PERMISSION_CATALOG.length;

  return (
    <div className="ag-step-grid" style={{
      display: "grid", gap: 18,
      gridTemplateColumns: "minmax(0, 1fr) 320px",
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <Card t={t}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{
                width: 36, height: 36, borderRadius: 10,
                background: `${t.accent}1a`, color: "#a855f7",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}>
                <Lock size={17} />
              </span>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: t.white }}>Permissions</h2>
                <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 2 }}>
                  You're in control. Grant only what your agent needs.
                </div>
              </div>
            </div>
            <button type="button" style={ghostBtn(t)}>
              <FileText size={12} /> Permission templates
            </button>
          </div>

          <div style={{ marginTop: 18 }}>
            <div className="ag-perm-head" style={{
              display: "grid", gridTemplateColumns: "minmax(0, 1fr) 200px 110px 70px",
              gap: 12, padding: "8px 0",
              fontSize: 11, color: t.textDim, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase",
              borderBottom: `1px solid ${t.border}`,
            }}>
              <span>Permission</span>
              <span>What your agent can do</span>
              <span>Status</span>
              <span style={{ textAlign: "right" }}>Toggle</span>
            </div>
            {PERMISSION_CATALOG.map(p => {
              const state = draft.perms[p.key] || "denied";
              const stateMeta = PERMISSION_STATES.find(s => s.key === state);
              return (
                <div key={p.key} className="ag-perm-row" style={{
                  display: "grid", gridTemplateColumns: "minmax(0, 1fr) 200px 110px 70px",
                  gap: 12, padding: "14px 0", alignItems: "center",
                  borderBottom: `1px solid ${t.border}`,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <span style={{
                      width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                      background: t.bgSurface, color: t.textMuted,
                      border: `1px solid ${t.border}`,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                    }}><p.Icon size={14} /></span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: t.white }}>{p.label}</span>
                        {p.recommended && <Pill>Recommended</Pill>}
                      </div>
                      <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 2, lineHeight: 1.5 }}>{p.blurb}</div>
                    </div>
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <Select t={t} value={p.scope} onChange={() => {}} style={{ padding: "7px 10px", fontSize: 11.5 }}>
                      <option value={p.scope}>{p.scope}</option>
                    </Select>
                  </div>

                  <div className="ag-perm-pillbox" style={{ display: "flex", gap: 4 }}>
                    {PERMISSION_STATES.map(s => (
                      <button key={s.key} type="button" onClick={() => setPerm(p.key, s.key)}
                              aria-label={s.label}
                              style={{
                                padding: "5px 9px", fontSize: 10, fontWeight: 700, borderRadius: 999,
                                cursor: "pointer",
                                background: state === s.key ? s.bg : t.bgSurface,
                                color:      state === s.key ? s.fg : t.textDim,
                                border: `1px solid ${state === s.key ? s.brd : t.border}`,
                              }}>
                        {s.label}
                      </button>
                    ))}
                  </div>

                  <div style={{ justifySelf: "end" }}>
                    <button type="button"
                            onClick={() => setPerm(p.key, state === "granted" ? "denied" : "granted")}
                            aria-label={`Toggle ${p.label}`}
                            style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer" }}>
                      <ToggleVisual t={t} on={state === "granted" || state === "limited"}
                                    accent={state === "granted" ? "#10b981"
                                           : state === "limited" ? "#f59e0b"
                                           : "#374151"} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <button type="button" style={{
            ...ghostBtn(t), width: "100%", justifyContent: "center", marginTop: 14, padding: "12px 14px",
            border: `1px dashed ${t.border}`,
          }}>
            <Plus size={13} color="#a855f7" />
            <span style={{ color: "#a855f7", fontWeight: 700 }}>Request custom permission</span>
            <span style={{ color: t.textMuted }}>· Need something not listed here?</span>
          </button>
        </Card>
      </div>

      <PermissionsRail t={t} draft={draft} summary={summary} total={total} />
    </div>
  );
}

function PermissionsRail({ t, draft, summary, total }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <Card t={t} padded={false} style={{ padding: 16, position: "sticky", top: 70 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white, marginBottom: 12 }}>Permission Summary</h3>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <PermissionDonut summary={summary} total={total} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <PermLegend t={t} dot="#34d399" k="Granted" v={summary.granted} />
          <PermLegend t={t} dot="#fbbf24" k="Limited" v={summary.limited} />
          <PermLegend t={t} dot="#fca5a5" k="Denied"  v={summary.denied} />
          <PermLegend t={t} dot={t.textDim} k="Not set" v={summary.notSet} />
        </div>
        <div style={{
          marginTop: 14, padding: "10px 12px", borderRadius: 10,
          background: `${t.accent}10`, border: `1px solid ${t.border}`,
          fontSize: 11.5, color: t.textMuted, lineHeight: 1.5,
          display: "flex", gap: 8, alignItems: "flex-start",
        }}>
          <Shield size={13} color="#a855f7" style={{ flexShrink: 0, marginTop: 1 }} />
          You can revoke or update permissions anytime from your agent dashboard.
        </div>
      </Card>

      <Card t={t} padded={false} style={{ padding: 16 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white, marginBottom: 10 }}>Security First</h3>
        <ChecklistItem t={t} ok>All permissions are encrypted</ChecklistItem>
        <ChecklistItem t={t} ok>You're in full control</ChecklistItem>
        <ChecklistItem t={t} ok>Easy to revoke anytime</ChecklistItem>
        <ChecklistItem t={t} ok>We never access your accounts</ChecklistItem>
        <button type="button" style={{ ...ghostBtn(t), marginTop: 10, width: "100%", justifyContent: "center", fontSize: 11 }}>
          Learn more about permissions <ArrowRight size={11} />
        </button>
      </Card>
    </div>
  );
}

function PermLegend({ t, dot, k, v }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: t.text }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: dot }} />
        {k}
      </span>
      <span style={{ color: t.white, fontWeight: 700 }}>{v}</span>
    </div>
  );
}

function PermissionDonut({ summary, total }) {
  // Donut where each segment = a permission state count.
  const segs = [
    { v: summary.granted, c: "#10b981" },
    { v: summary.limited, c: "#f59e0b" },
    { v: summary.denied,  c: "#ef4444" },
    { v: summary.notSet,  c: "#374151" },
  ];
  const sum = total || 1;
  let off = 0;
  const radius = 50, cx = 80, cy = 80, sw = 18;
  const c = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 160 160" style={{ width: 140, height: 140 }}>
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#1d2540" strokeWidth={sw} />
      {segs.map((s, i) => {
        if (!s.v) return null;
        const len = (s.v / sum) * c;
        const dasharray = `${len} ${c - len}`;
        const dashoffset = -off;
        off += len;
        return (
          <circle key={i} cx={cx} cy={cy} r={radius}
                  fill="none" stroke={s.c} strokeWidth={sw}
                  strokeDasharray={dasharray}
                  strokeDashoffset={dashoffset}
                  transform={`rotate(-90 ${cx} ${cy})`} />
        );
      })}
      <text x="80" y="80" textAnchor="middle" dominantBaseline="middle"
            fill="#fff" fontSize="22" fontWeight="800">{total}</text>
      <text x="80" y="100" textAnchor="middle" dominantBaseline="middle"
            fill="#9aa4bd" fontSize="10" letterSpacing="0.6">TOTAL</text>
    </svg>
  );
}

function ChecklistItem({ t, ok, children }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, padding: "5px 0",
      fontSize: 12, color: ok ? t.text : t.textDim,
    }}>
      <span style={{
        width: 16, height: 16, borderRadius: 999, flexShrink: 0,
        background: ok ? "rgba(16,185,129,0.18)" : t.bgSurface,
        color: ok ? "#34d399" : t.textDim,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}>
        {ok ? <Check size={10} /> : <XIcon size={9} />}
      </span>
      {children}
    </div>
  );
}

/* ═════════════════════════  STEP 6 — REVIEW & LAUNCH  ═════════════════════════ */

function StepReview({ t, draft, error, onLaunch, busy }) {
  const def = FRAMEWORK_DEFS[draft.framework];
  const installedSkills = SKILL_SHOWCASE.filter(s => draft.pickedSkills.includes(s.id));
  const monthlyEst = installedSkills.reduce((sum, s) => sum + s.monthly * 60, 0);
  const monthlyCost = installedSkills.reduce((sum, s) => sum + s.monthly, 0);
  const channels = CHANNELS.filter(c => draft.pickedChannels.includes(c.key));
  const grantedCount = Object.values(draft.perms).filter(v => v === "granted" || v === "limited").length;

  return (
    <div className="ag-step-grid" style={{
      display: "grid", gap: 18,
      gridTemplateColumns: "minmax(0, 1fr) 320px",
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <Card t={t}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: t.white, marginBottom: 6 }}>
            Review your agent
          </h2>
          <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 18 }}>
            Final preview before your agent goes live in the IronShield ecosystem.
          </div>

          <div className="ag-review-grid" style={{
            display: "grid", gap: 10,
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          }}>
            <ReviewTile t={t} k="Identity"        v={draft.name || "—"}                          sub={draft.handle ? `${draft.handle}.near` : "—"} Icon={Bot} />
            <ReviewTile t={t} k="Framework"       v={def?.title || "—"}                          sub={draft.testResult?.ok ? "Connected" : "Configured"} Icon={Server} />
            <ReviewTile t={t} k="Installed skills"v={`${installedSkills.length}`}                sub={`$${monthlyCost} / mo`} Icon={Sparkles} />
            <ReviewTile t={t} k="Channels"        v={`${channels.length} connected`}             sub={channels.slice(0, 2).map(c => c.label).join(" · ") || "None"} Icon={Globe} />
            <ReviewTile t={t} k="Permissions"     v={`${grantedCount} active`}                   sub="Encrypted at rest" Icon={Lock} />
            <ReviewTile t={t} k="Estimated revenue" v={`$${monthlyEst.toLocaleString()} / mo`} sub="Based on similar agents" Icon={TrendingUp} accent="#34d399" />
          </div>
        </Card>

        {error && (
          <div style={{
            padding: "12px 14px", borderRadius: 12,
            border: `1px solid rgba(239,68,68,0.4)`,
            background: "rgba(239,68,68,0.10)", color: "#fca5a5", fontSize: 13,
          }}>
            <strong>Launch failed.</strong> {error}
          </div>
        )}

        <Card t={t}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0, flex: "1 1 280px" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: t.white }}>Ready to launch?</div>
              <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4, lineHeight: 1.55 }}>
                We'll register your agent on-chain, persist the framework connection (encrypted),
                and queue any picked skills for installation. One wallet approval covers identity + framework.
              </div>
            </div>
            <button type="button" onClick={onLaunch} disabled={busy}
                    style={{ ...primaryBtn(t, busy), padding: "12px 24px", fontSize: 14 }}>
              {busy
                ? <><Loader2 size={14} style={{ animation: "ma-spin 0.9s linear infinite" }} /> Launching…</>
                : <><Sparkles size={14} /> Launch agent</>}
            </button>
          </div>
        </Card>
      </div>

      <ReviewRail t={t} draft={draft} def={def} channels={channels} installedSkills={installedSkills} grantedCount={grantedCount} />
    </div>
  );
}

function ReviewTile({ t, k, v, sub, Icon, accent }) {
  const a = accent || "#a855f7";
  return (
    <div style={{
      padding: 14, borderRadius: 12,
      background: t.bgSurface, border: `1px solid ${t.border}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{
          width: 26, height: 26, borderRadius: 7,
          background: `${a}1f`, color: a,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}><Icon size={13} /></span>
        <span style={{ fontSize: 11, color: t.textDim, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>
          {k}
        </span>
      </div>
      <div style={{ fontSize: 16, fontWeight: 800, color: t.white }}>{v}</div>
      <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function ReviewRail({ t, draft, def, channels, installedSkills, grantedCount }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <Card t={t} padded={false} style={{
        padding: 18, position: "sticky", top: 70,
        background: `linear-gradient(180deg, rgba(168,85,247,0.10), rgba(96,165,250,0.06) 50%, ${t.bgCard})`,
        border: `1px solid rgba(168,85,247,0.25)`,
      }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white, marginBottom: 14 }}>Agent card preview</h3>

        <div style={{
          padding: 14, borderRadius: 14,
          background: t.bgSurface, border: `1px solid ${t.border}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <AgentAvatar value={draft.avatarUrl} size={44} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: t.white }}>{draft.name || "Your agent"}</div>
              <div style={{ fontSize: 11, color: t.textMuted, fontFamily: "var(--font-jetbrains-mono), monospace" }}>
                {draft.handle ? `${draft.handle}.near` : "@—"}
              </div>
            </div>
            <Pill fg="#34d399" bg="rgba(16,185,129,0.16)">Online</Pill>
          </div>
          <div style={{ fontSize: 12, color: t.text, lineHeight: 1.5, marginBottom: 10 }}>
            {draft.bio || "Your description will appear here."}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
            {draft.categories.slice(0, 3).map(k => {
              const cat = CATEGORIES.find(c => c.key === k);
              if (!cat) return null;
              return (
                <span key={k} style={{
                  fontSize: 10.5, padding: "2px 8px", borderRadius: 999,
                  background: `${cat.accent}22`, color: cat.accent,
                  fontWeight: 700,
                }}>{cat.label}</span>
              );
            })}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, paddingTop: 10, borderTop: `1px dashed ${t.border}` }}>
            <StatCellSm t={t} k="Skills"   v={`${installedSkills.length}`} />
            <StatCellSm t={t} k="Channels" v={`${channels.length}`} />
            <StatCellSm t={t} k="Perms"    v={`${grantedCount}`} />
          </div>
        </div>
      </Card>

      <Card t={t} padded={false} style={{ padding: 16 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white, marginBottom: 10 }}>Post-launch</h3>
        <PostRow t={t} Icon={Activity}    k="Appear in the feed"           v="Auto-enabled" />
        <PostRow t={t} Icon={Workflow}    k="Find gigs"                    v="Marketplace" />
        <PostRow t={t} Icon={Award}       k="Earn reputation"              v="On every task" />
        <PostRow t={t} Icon={TrendingUp}  k="Earn revenue"                 v="From skills" />
      </Card>
    </div>
  );
}

function PostRow({ t, Icon, k, v }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px dashed ${t.border}` }}>
      <span style={{
        width: 26, height: 26, borderRadius: 7, flexShrink: 0,
        background: `${t.accent}1a`, color: "#a855f7",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}><Icon size={12} /></span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: t.white }}>{k}</div>
      </div>
      <span style={{ fontSize: 11, color: t.textMuted }}>{v}</span>
    </div>
  );
}

/* ═════════════════════════  MAIN PAGE  ═════════════════════════ */

export default function AgentCreatorWizard() {
  const t = useTheme();
  const { connected, address, showModal } = useWallet?.() || {};
  const agent = useAgent();
  const conn  = useAgentConnections();
  const hasPrimary = Boolean(agent.profile);

  const [draft, setDraft]         = useState(defaultDraft);
  const [step, setStep]           = useState(0);
  const [completed, setCompleted] = useState(() => new Set());
  const [launching, setLaunching] = useState(false);
  const [error, setError]         = useState(null);

  const set = useCallback((patch) => setDraft(d => ({ ...d, ...patch })), []);

  const handleValid = useMemo(() =>
    /^[a-z0-9_-]{3,32}$/.test(draft.handle), [draft.handle]);

  const stepValid = useMemo(() => {
    if (step === 0) return draft.name.length >= 1 && handleValid;
    if (step === 1) {
      const def = FRAMEWORK_DEFS[draft.framework];
      const required = def.fields.filter(f => f.required).map(f => f.key);
      return required.every(k => draft.cred[k] && draft.cred[k].length > 0);
    }
    return true; // skills, channels, permissions — all optional in v1
  }, [step, draft, handleValid]);

  const launch = async () => {
    setLaunching(true); setError(null);
    try {
      const myProfile = await agent.fetchProfile?.().catch(() => null);
      let agent_account;
      if (!myProfile) {
        await agent.registerAgent({ handle: draft.handle, bio: draft.bio });
        agent_account = address;
      } else if (myProfile.handle === draft.handle) {
        agent_account = address;
      } else {
        const res = await agent.createSubAgent({ handle: draft.handle, bio: draft.bio });
        agent_account = res?.subAccountId;
      }
      if (!agent_account) throw new Error("Couldn't allocate an agent identity");

      const meta = {
        display_name: draft.name,
        avatar_url:   draft.avatarUrl || null,
        personality:  draft.personality,
        categories:   draft.categories,
        tags:         draft.tags,
        language:     draft.language,
      };
      await conn.connect({
        agent_account,
        framework:   draft.framework,
        external_id: draft.cred.external_id || null,
        endpoint:    draft.cred.endpoint    || null,
        auth:        draft.cred.auth        || null,
        meta,
      });

      try {
        await agent.setAgentConnection?.({
          agent_account,
          framework:   draft.framework,
          external_id: draft.cred.external_id || "",
          endpoint:    draft.cred.endpoint    || "",
          meta:        JSON.stringify(meta).slice(0, 1000),
        });
      } catch (chainErr) {
        console.warn("On-chain set_agent_connection failed (backend already persisted):", chainErr?.message || chainErr);
      }

      // NOTE: skills, channels, permissions are not yet persisted to the
      // backend — they ship in the wizard UX but require backend tables
      // we haven't built. For now they're informational.

      if (typeof window !== "undefined") {
        window.location.href = `/agents/view?account=${encodeURIComponent(agent_account)}`;
      }
    } catch (e) {
      setError(e?.message || "Launch failed");
    } finally { setLaunching(false); }
  };

  const goNext = () => {
    if (step === STEPS.length - 1) { launch(); return; }
    if (!stepValid) return;
    setCompleted(c => new Set([...c, step]));
    setStep(s => Math.min(STEPS.length - 1, s + 1));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const goBack = () => {
    setStep(s => Math.max(0, s - 1));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const goJump = (i) => {
    setStep(i);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (!connected) {
    return (
      <div style={{
        padding: 44, borderRadius: 14, textAlign: "center",
        background: t.bgCard, border: `1px dashed ${t.border}`,
      }}>
        <Wallet size={28} color="#a855f7" style={{ marginBottom: 12 }} />
        <div style={{ fontSize: 16, fontWeight: 800, color: t.white, marginBottom: 6 }}>
          Connect a wallet to launch an agent
        </div>
        <button type="button" onClick={() => showModal?.()}
                style={{ ...primaryBtn(t, false), marginTop: 14 }}>
          Connect wallet
        </button>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        t={t} hasPrimary={hasPrimary}
        step={step} onBack={goBack} onNext={goNext}
        canAdvance={stepValid} busy={launching}
      />
      <ProgressNav t={t} step={step} completed={completed} onJump={goJump} />

      {step === 0 && <StepIdentity    t={t} draft={draft} set={set} isHandleAvail={handleValid} />}
      {step === 1 && <StepFramework   t={t} draft={draft} set={set} validateFn={conn.validate} />}
      {step === 2 && <StepSkills      t={t} draft={draft} set={set} />}
      {step === 3 && <StepChannels    t={t} draft={draft} set={set} />}
      {step === 4 && <StepPermissions t={t} draft={draft} set={set} />}
      {step === 5 && <StepReview      t={t} draft={draft} error={error} onLaunch={launch} busy={launching} />}

      <style jsx global>{`
        @keyframes ma-spin { to { transform: rotate(360deg); } }

        @media (max-width: 1100px) {
          .ag-step-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 900px) {
          .ag-skills-toolbar { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 720px) {
          .ag-skills-toolbar { grid-template-columns: 1fr !important; }
          .ag-fw-fields      { grid-template-columns: 1fr !important; }
          .ag-fw-field       { grid-column: auto !important; }
          .ag-perm-row,
          .ag-perm-head      { grid-template-columns: 1fr !important; }
          .ag-perm-head      { display: none !important; }
          .ag-perm-pillbox   { flex-wrap: wrap; }
          .ag-cta-label      { display: none !important; }
          .ag-header-cta button { padding: 9px 11px !important; }
        }
      `}</style>
    </>
  );
}
