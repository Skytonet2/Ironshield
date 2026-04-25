"use client";
// Create a skill — /skills/create.
//
// Five-step builder that captures both *what* the skill is (Basics,
// Pricing, Review) and *how* it works (Logic Builder, Permissions).
// The on-chain contract still only stores name / description / price /
// category / tags / image_url, so the rich Logic + Permissions config
// gets serialized into a draft (localStorage) for resume + summarized
// into the description on publish. Future phases will move the rich
// config into a backend table and reference it by id.
//
// Layout (desktop ≥1100px):
//   ┌─ Top header (title + Save Draft / Preview / Next) ──────────┐
//   ├─ ProgressNav (5 steps, checkmarks for completed) ───────────┤
//   ├─ Main column (form / canvas) ┬─ Right rail (overview+tips) ─┤
//   ├─ Bottom analytics strip ────────────────────────────────────┤
//   └─────────────────────────────────────────────────────────────┘
//
// SkillsShell wraps this page so the left sidebar comes for free.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight, ArrowLeft, Check, Plus, X as XIcon, Loader2, Eye, Save,
  Zap, Wallet, Shield, ShieldCheck, ShieldAlert, AlertTriangle, Info,
  FileText, Globe, Bot, Send, MessageSquare, Tag, Bell, Trash2, Play,
  Sparkles, DollarSign, TrendingUp, Calendar, Layers, BarChart3,
  Database, Coins, Repeat, Cpu, ChevronDown, Star, Image as ImageIcon,
  Activity, Mail, Webhook, FileCheck, BookOpen, Workflow, Award,
  HelpCircle, Hash, Upload, RefreshCw,
} from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import useAgent from "@/hooks/useAgent";

/* ─────────────────────────  Constants  ───────────────────────── */

const STEPS = [
  { key: "basics",      label: "Basics" },
  { key: "logic",       label: "Logic Builder" },
  { key: "permissions", label: "Permissions" },
  { key: "pricing",     label: "Pricing" },
  { key: "review",      label: "Review & Publish" },
];

const CATEGORIES = [
  { key: "defi",        label: "DeFi" },
  { key: "airdrops",    label: "Airdrops & Rewards" },
  { key: "trading",     label: "Trading" },
  { key: "analytics",   label: "Analytics" },
  { key: "social",      label: "Social" },
  { key: "security",    label: "Security" },
  { key: "gaming",      label: "Gaming" },
  { key: "productivity",label: "Productivity" },
  { key: "research",    label: "Research" },
  { key: "other",       label: "Other" },
];

// Contract caps
const NAME_MAX       = 48;
const SHORT_MAX      = 120;
const LONG_MAX       = 240;
const CATEGORY_MAX   = 32;
const TAG_MAX        = 24;
const MAX_TAGS       = 5;
const IMAGE_URL_MAX  = 256;
const YOCTO_PER_NEAR = 1_000_000_000_000_000_000_000_000n;

const DRAFT_KEY = "skillhub:draft:v1";

/* ─── Logic builder library ─── */

const TRIGGER_TYPES = [
  { key: "manual",     label: "Manual prompt",        Icon: Play,    hint: "User invokes the skill from chat" },
  { key: "wallet",     label: "Wallet activity",      Icon: Wallet,  hint: "Fires on tx, token receive, etc." },
  { key: "api",        label: "API trigger",          Icon: Webhook, hint: "Authenticated POST to /run" },
  { key: "schedule",   label: "Scheduled",            Icon: Calendar,hint: "Cron-style recurring runs" },
  { key: "social",     label: "Social media",         Icon: Send,    hint: "Mentions, DMs, channel posts" },
];

const INPUT_TYPES = [
  { key: "wallet",     label: "Wallet address",       Icon: Wallet  },
  { key: "token",      label: "Token / project name", Icon: Star    },
  { key: "contract",   label: "Contract address",     Icon: Hash    },
  { key: "text",       label: "Text input",           Icon: FileText },
  { key: "file",       label: "File upload",          Icon: Upload  },
  { key: "url",        label: "URL input",            Icon: Globe   },
];

const KNOWLEDGE_TYPES = [
  { key: "pdf",        label: "PDF",                  Icon: FileText },
  { key: "doc",        label: "Doc",                  Icon: FileCheck },
  { key: "csv",        label: "CSV",                  Icon: Database },
  { key: "notion",     label: "Notion",               Icon: BookOpen },
  { key: "gdoc",       label: "Google Docs",          Icon: FileText },
  { key: "url",        label: "Website link",         Icon: Globe },
];

const TOOL_TYPES = [
  { key: "twitter_post", label: "X / Twitter posting",  Icon: Send,         hint: "Post tweets on the user's behalf" },
  { key: "telegram_bot", label: "Telegram bot",         Icon: Send,         hint: "Send messages via bot" },
  { key: "discord_bot",  label: "Discord bot",          Icon: MessageSquare,hint: "Post to channels / DM users" },
  { key: "wallet_api",   label: "Wallet analysis API",  Icon: Wallet,       hint: "Read on-chain wallet data" },
  { key: "dex",          label: "DEX integration",      Icon: Repeat,       hint: "Quote / swap on Ref, Jumbo, etc." },
  { key: "email",        label: "Email",                Icon: Mail,         hint: "Send via SMTP / Resend" },
  { key: "webhook",      label: "Webhook",              Icon: Webhook,      hint: "POST to your endpoint" },
];

const OUTPUT_TYPES = [
  { key: "text",       label: "Text output",          Icon: FileText },
  { key: "dashboard",  label: "Dashboard",            Icon: BarChart3 },
  { key: "pdf",        label: "PDF report",           Icon: FileText },
  { key: "alert",      label: "Alerts",               Icon: Bell },
  { key: "post",       label: "Auto-posted content",  Icon: Send },
];

/* ─── Permission catalog ─── */

const PERM_GROUPS = [
  {
    key: "wallet", label: "Wallet Permissions",
    blurb: "Access blockchain and wallet data.", Icon: Wallet,
    items: [
      { key: "read_addr",     label: "Read wallet address",   sub: "View the connected wallet address",     risk: "low"  },
      { key: "read_tx",       label: "Read transaction history", sub: "View past transactions and activity", risk: "low"  },
      { key: "read_balance",  label: "Read balances",         sub: "View token balances and portfolio",     risk: "low"  },
      { key: "execute_swap",  label: "Execute trades / swaps",sub: "Execute token swaps on DEXs",           risk: "high" },
      { key: "transfer",      label: "Transfer assets",       sub: "Transfer tokens or native assets",      risk: "high" },
    ],
  },
  {
    key: "social", label: "Social Permissions",
    blurb: "Access social platforms and communicate.", Icon: MessageSquare,
    items: [
      { key: "read_x",        label: "Read X (Twitter) account", sub: "Read tweets, followers, and profile",    risk: "low"    },
      { key: "post_x",        label: "Post tweets",              sub: "Post tweets on behalf of the user",      risk: "medium" },
      { key: "read_discord",  label: "Read Discord messages",    sub: "Read messages from accessible servers",  risk: "medium" },
      { key: "send_telegram", label: "Send Telegram messages",   sub: "Send messages via Telegram bot",         risk: "low"    },
    ],
  },
  {
    key: "data", label: "Data & Integrations",
    blurb: "Access external data and services.", Icon: Database,
    items: [
      { key: "read_files",    label: "Read uploaded files",    sub: "Access files uploaded by the user",      risk: "low"    },
      { key: "read_docs",     label: "Access connected documents", sub: "Access Google Docs, Notion, etc.",   risk: "low"    },
      { key: "read_apis",     label: "Access third-party APIs",sub: "Make requests to external APIs",         risk: "medium" },
    ],
  },
];

const PERM_EXPIRATIONS = [
  { key: "1d",  label: "24 hours" },
  { key: "7d",  label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "never", label: "Never" },
];

/* ─── Pricing models ─── */

const PRICING_MODELS = [
  { key: "free",        label: "Free",                Icon: Sparkles,  blurb: "Anyone can install. Builds reputation; no revenue." },
  { key: "one_time",    label: "One-time purchase",   Icon: Coins,     blurb: "Single payment, lifetime access." },
  { key: "subscription",label: "Subscription",        Icon: RefreshCw, blurb: "Recurring monthly access fee." },
  { key: "per_exec",    label: "Pay per execution",   Icon: Cpu,       blurb: "Charge each time the skill runs." },
  { key: "rev_share",   label: "Revenue share",       Icon: TrendingUp,blurb: "Cut of value generated (advanced)." },
];

/* ─────────────────────────  Helpers  ───────────────────────── */

function nearToYocto(nearStr) {
  const n = String(nearStr ?? "0").trim();
  if (!n) return "0";
  const [whole = "0", frac = ""] = n.split(".");
  const fracPadded = (frac + "000000000000000000000000").slice(0, 24);
  const y = BigInt(whole || "0") * YOCTO_PER_NEAR + BigInt(fracPadded || "0");
  return y.toString();
}

function defaultDraft() {
  return {
    // Step 1
    name: "", shortDesc: "", longDesc: "",
    category: "", tags: [], imageUrl: "",
    // Step 2 — Logic
    trigger: "manual",
    inputs: [
      { id: 1, type: "token",  label: "Token or project name", required: true },
      { id: 2, type: "wallet", label: "Wallet address",        required: false },
    ],
    knowledge: [],
    tools: [],
    output: "text",
    // Step 3 — Permissions
    perms: { read_addr: true, read_tx: true, read_balance: true, read_files: true, read_docs: true },
    spendingDailyNear: 0,
    spendingTxPerDay: 0,
    permExpiration: "7d",
    // Step 4 — Pricing
    pricingModel: "free",
    pricingValue: { oneTime: 1, monthly: 5, perExec: 0.01, revSharePct: 10 },
    estMonthlyInstalls: 240,
    // Step 5 — meta
    createdAt: Date.now(),
  };
}

function computeRisk(perms) {
  const all = PERM_GROUPS.flatMap(g => g.items);
  let highOn = 0, medOn = 0, total = 0;
  for (const p of all) {
    if (perms?.[p.key]) {
      total++;
      if (p.risk === "high") highOn++;
      else if (p.risk === "medium") medOn++;
    }
  }
  let level = "low";
  if (highOn > 0) level = "high";
  else if (medOn >= 2) level = "medium";
  else if (medOn === 1 && total >= 4) level = "medium";
  return { level, highOn, medOn, total };
}

const RISK_COLOR = {
  low:    { fg: "#10b981", bg: "rgba(16,185,129,0.14)", brd: "rgba(16,185,129,0.36)", label: "Low Risk" },
  medium: { fg: "#f59e0b", bg: "rgba(245,158,11,0.14)", brd: "rgba(245,158,11,0.36)", label: "Medium Risk" },
  high:   { fg: "#ef4444", bg: "rgba(239,68,68,0.14)",  brd: "rgba(239,68,68,0.36)",  label: "High Risk" },
};

/* ─────────────────────────  UI primitives  ───────────────────────── */

const card = (t, extra = {}) => ({
  background: t.bgCard, border: `1px solid ${t.border}`,
  borderRadius: 14, padding: 20,
  ...extra,
});

const input = (t, extra = {}) => ({
  width: "100%", padding: "10px 12px",
  background: t.bgSurface, border: `1px solid ${t.border}`,
  borderRadius: 10, color: t.white, fontSize: 13,
  outline: "none", fontFamily: "inherit",
  ...extra,
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
  cursor: busy ? "not-allowed" : "pointer",
  opacity: busy ? 0.6 : 1,
});

const ghostBtn = (t) => ({
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "8px 12px",
  background: "transparent", border: `1px solid ${t.border}`,
  borderRadius: 10, fontSize: 12.5, fontWeight: 600, color: t.textMuted,
  cursor: "pointer",
});

function Pill({ t, children, color = "accent" }) {
  const fg = color === "accent" ? "#c4b8ff" : color;
  const bg = color === "accent" ? "rgba(168,85,247,0.18)" : `${color}22`;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
      background: bg, color: fg, letterSpacing: 0.4,
    }}>{children}</span>
  );
}

function Card({ t, children, padded = true, glow = false, style }) {
  return (
    <section style={{
      ...card(t, { padding: padded ? 20 : 0 }),
      ...(glow ? { boxShadow: `0 0 0 1px rgba(168,85,247,0.18), 0 14px 40px rgba(0,0,0,0.35)` } : {}),
      ...style,
    }}>
      {children}
    </section>
  );
}

function FieldLabel({ t, children, hint, count, max }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
      marginBottom: 6,
    }}>
      <label style={{ fontSize: 12.5, fontWeight: 700, color: t.white }}>{children}</label>
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

function Toggle({ t, on, onChange, disabled }) {
  return (
    <button
      type="button" role="switch" aria-checked={on}
      onClick={() => !disabled && onChange?.(!on)}
      disabled={disabled}
      style={{
        position: "relative",
        width: 38, height: 22, borderRadius: 999,
        background: on ? `linear-gradient(135deg, #a855f7, ${t.accent})` : t.bgSurface,
        border: `1px solid ${on ? "transparent" : t.border}`,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 160ms ease",
        flexShrink: 0,
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: on ? 18 : 2,
        width: 16, height: 16, borderRadius: "50%",
        background: "#fff",
        transition: "left 160ms ease",
        boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
      }} />
    </button>
  );
}

// Visual-only toggle for use inside a parent button (where a nested
// <button> would be invalid HTML). The parent button handles the click.
function ToggleVisual({ t, on }) {
  return (
    <span aria-hidden style={{
      position: "relative",
      width: 38, height: 22, borderRadius: 999,
      background: on ? `linear-gradient(135deg, #a855f7, ${t.accent})` : t.bgSurface,
      border: `1px solid ${on ? "transparent" : t.border}`,
      transition: "background 160ms ease",
      flexShrink: 0,
      display: "inline-block",
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

function Slider({ t, value, min = 0, max = 100, step = 1, onChange, accent = "#a855f7" }) {
  return (
    <input
      type="range"
      min={min} max={max} step={step}
      value={value}
      onChange={(e) => onChange?.(Number(e.target.value))}
      style={{
        width: "100%", height: 6, borderRadius: 999,
        background: `linear-gradient(90deg, ${accent} 0%, ${accent} ${((value - min) / (max - min)) * 100}%, ${t.bgSurface} ${((value - min) / (max - min)) * 100}%, ${t.bgSurface} 100%)`,
        appearance: "none", WebkitAppearance: "none",
        outline: "none", cursor: "pointer",
      }}
      className="sk-slider"
    />
  );
}

function ChipInput({ t, values, onChange, placeholder, max = MAX_TAGS, perChipMax = TAG_MAX }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim().slice(0, perChipMax);
    if (!v) return;
    if (values.includes(v) || values.length >= max) { setDraft(""); return; }
    onChange?.([...values, v]);
    setDraft("");
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
          {v}
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
          placeholder={values.length === 0 ? placeholder : ""}
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

/* ─────────────────────────  Top header  ───────────────────────── */

function PageHeader({ t, draft, savedAt, onSave, onPreview, onNext, onBack, step, canAdvance, busy }) {
  const isLast = step === STEPS.length - 1;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 16,
      marginBottom: 14, flexWrap: "wrap",
    }}>
      <div style={{ minWidth: 0, flex: "1 1 280px" }}>
        <h1 style={{
          fontSize: "clamp(22px, 2.2vw, 28px)", margin: 0, fontWeight: 800,
          color: t.white, letterSpacing: -0.4,
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        }}>
          Create a skill
          {savedAt && (
            <span style={{
              fontSize: 11.5, color: "#86efac", fontWeight: 600,
              display: "inline-flex", alignItems: "center", gap: 5,
            }}>
              <Check size={12} /> Draft saved
            </span>
          )}
        </h1>
        <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 4 }}>
          {STEPS[step].label} — step {step + 1} of {STEPS.length}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
        <button type="button" onClick={onSave} style={ghostBtn(t)}>
          <Save size={13} /> Save draft
        </button>
        <button type="button" onClick={onPreview} style={secondaryBtn(t)}>
          <Eye size={13} /> Preview
        </button>
        {step > 0 && (
          <button type="button" onClick={onBack} style={secondaryBtn(t, busy)}>
            <ArrowLeft size={13} /> Back
          </button>
        )}
        <button type="button" onClick={onNext} disabled={!canAdvance || busy}
                style={primaryBtn(t, !canAdvance || busy)}>
          {busy ? <Loader2 size={13} style={{ animation: "ma-spin 0.9s linear infinite" }} /> : null}
          {isLast ? (busy ? "Publishing…" : "Publish skill") : "Next"} {!busy && !isLast ? <ArrowRight size={13} /> : null}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────  Progress nav  ───────────────────────── */

function ProgressNav({ t, step, completed, onJump }) {
  return (
    <div className="sk-prognav" style={{
      display: "flex", alignItems: "center",
      padding: "14px 18px",
      background: t.bgCard, border: `1px solid ${t.border}`,
      borderRadius: 14, marginBottom: 18, gap: 0,
      overflowX: "auto",
    }}>
      {STEPS.map((s, i) => {
        const done = completed.has(i) && i < step;
        const current = i === step;
        const reachable = done || current || completed.has(i);
        const label = s.label;
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
                      cursor: reachable ? "pointer" : "default",
                      padding: 0,
                    }}>
              <span style={{
                width: 28, height: 28, borderRadius: "50%",
                background: current
                  ? `linear-gradient(135deg, #a855f7, ${t.accent})`
                  : done ? "rgba(16,185,129,0.18)" : t.bgSurface,
                border: done ? `1px solid rgba(16,185,129,0.5)` : `1px solid ${t.border}`,
                color: current ? "#fff" : done ? "#34d399" : t.textDim,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 800,
                boxShadow: current ? `0 0 0 4px rgba(168,85,247,0.16)` : "none",
                transition: "background 160ms ease",
                flexShrink: 0,
              }}>
                {done ? <Check size={13} /> : i + 1}
              </span>
              <span style={{
                fontSize: 13, fontWeight: current ? 700 : 600,
                color: current ? t.white : reachable ? t.textMuted : t.textDim,
                whiteSpace: "nowrap",
              }}>
                {label}
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

/* ─────────────────────────  Step 1 — Basics  ───────────────────────── */

function StepBasics({ t, draft, set }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card t={t}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: t.white }}>
          Basics
        </h2>
        <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 4, marginBottom: 16 }}>
          Tell users what your skill is and where it lives in the marketplace.
        </div>

        <FieldLabel t={t} count={draft.name.length} max={NAME_MAX}>Skill name</FieldLabel>
        <input value={draft.name}
               onChange={(e) => set({ name: e.target.value.slice(0, NAME_MAX) })}
               placeholder="e.g. Airdrop Hunter — NEAR ecosystem"
               style={{ ...input(t), marginBottom: 16 }} />

        <FieldLabel t={t} count={draft.shortDesc.length} max={SHORT_MAX}>Short description</FieldLabel>
        <input value={draft.shortDesc}
               onChange={(e) => set({ shortDesc: e.target.value.slice(0, SHORT_MAX) })}
               placeholder="One sentence — what this skill does."
               style={{ ...input(t), marginBottom: 16 }} />

        <FieldLabel t={t} count={draft.longDesc.length} max={LONG_MAX}>Detailed description</FieldLabel>
        <textarea value={draft.longDesc}
                  onChange={(e) => set({ longDesc: e.target.value.slice(0, LONG_MAX) })}
                  placeholder="What problem does this solve? Who is it for? What's the expected output?"
                  rows={4}
                  style={{ ...input(t), resize: "vertical", marginBottom: 16, fontFamily: "inherit" }} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }} className="sk-basics-grid">
          <div>
            <FieldLabel t={t}>Category</FieldLabel>
            <Select t={t} value={draft.category} onChange={(v) => set({ category: v })}>
              <option value="">— Select a category —</option>
              {CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </Select>
          </div>
          <div>
            <FieldLabel t={t} hint={`Up to ${MAX_TAGS}`}>Tags</FieldLabel>
            <ChipInput t={t} values={draft.tags} onChange={(v) => set({ tags: v })}
                       placeholder="research, alpha, near…" />
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <FieldLabel t={t} hint="Optional · 256 chars">Thumbnail URL</FieldLabel>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{
              width: 56, height: 56, borderRadius: 10, flexShrink: 0,
              background: draft.imageUrl ? `url(${draft.imageUrl}) center/cover` : t.bgSurface,
              border: `1px dashed ${t.border}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: t.textDim,
            }}>
              {!draft.imageUrl && <ImageIcon size={20} />}
            </div>
            <input value={draft.imageUrl}
                   onChange={(e) => set({ imageUrl: e.target.value.slice(0, IMAGE_URL_MAX) })}
                   placeholder="https://…"
                   style={input(t)} />
          </div>
        </div>
      </Card>

      <Card t={t}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: t.white, marginBottom: 6 }}>
          Marketplace card preview
        </h3>
        <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 14 }}>
          This is roughly how your skill will appear in the marketplace grid.
        </div>
        <SkillCardPreview t={t} draft={draft} compact />
      </Card>
    </div>
  );
}

/* ─────────────────────────  Step 2 — Logic Builder  ───────────────────────── */

function StepLogic({ t, draft, set }) {
  return (
    <div style={{
      display: "grid", gap: 14,
      gridTemplateColumns: "320px minmax(0, 1fr) 320px",
    }} className="sk-logic-grid">
      <LogicConfigPanel t={t} draft={draft} set={set} />
      <LogicCanvas t={t} draft={draft} />
      <LogicSandbox t={t} draft={draft} />
    </div>
  );
}

function LogicConfigPanel({ t, draft, set }) {
  const addInput = () => {
    const id = (draft.inputs.at(-1)?.id || 0) + 1;
    set({ inputs: [...draft.inputs, { id, type: "text", label: "New input", required: false }] });
  };
  const updateInput = (id, patch) =>
    set({ inputs: draft.inputs.map(i => i.id === id ? { ...i, ...patch } : i) });
  const removeInput = (id) =>
    set({ inputs: draft.inputs.filter(i => i.id !== id) });

  const toggleKnowledge = (k) => {
    const has = draft.knowledge.includes(k);
    set({ knowledge: has ? draft.knowledge.filter(x => x !== k) : [...draft.knowledge, k] });
  };
  const toggleTool = (k) => {
    const has = draft.tools.includes(k);
    set({ tools: has ? draft.tools.filter(x => x !== k) : [...draft.tools, k] });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      {/* Trigger */}
      <Card t={t} padded={false} style={{ padding: 16 }}>
        <PanelHeader t={t} Icon={Play} title="Trigger" hint="What starts this skill?" />
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          {TRIGGER_TYPES.map(tt => {
            const active = draft.trigger === tt.key;
            return (
              <button key={tt.key} type="button" onClick={() => set({ trigger: tt.key })}
                      style={pickerRow(t, active)}>
                <span style={iconChip(t, active)}><tt.Icon size={14} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: t.white }}>{tt.label}</span>
                  <span style={{ display: "block", fontSize: 11, color: t.textMuted, marginTop: 1 }}>{tt.hint}</span>
                </span>
                {active && <Check size={14} color="#a855f7" />}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Inputs */}
      <Card t={t} padded={false} style={{ padding: 16 }}>
        <PanelHeader t={t} Icon={Layers} title="Inputs" hint="What does this skill need?" />
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          {draft.inputs.map(field => (
            <div key={field.id} style={{
              display: "grid", gridTemplateColumns: "1fr 100px auto", gap: 6,
              alignItems: "center",
              padding: "8px 10px",
              background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 10,
            }}>
              <input value={field.label}
                     onChange={(e) => updateInput(field.id, { label: e.target.value.slice(0, 48) })}
                     style={{ ...input(t), padding: "6px 8px", fontSize: 12 }} />
              <Select t={t} value={field.type} onChange={(v) => updateInput(field.id, { type: v })}
                      style={{ padding: "6px 8px", fontSize: 12 }}>
                {INPUT_TYPES.map(it => <option key={it.key} value={it.key}>{it.label}</option>)}
              </Select>
              <button type="button" onClick={() => removeInput(field.id)}
                      aria-label="Remove input"
                      style={{ background: "transparent", border: "none", color: t.textDim, cursor: "pointer", padding: 4 }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button type="button" onClick={addInput} style={{ ...ghostBtn(t), justifyContent: "center" }}>
            <Plus size={13} /> Add input
          </button>
        </div>
      </Card>

      {/* Knowledge sources */}
      <Card t={t} padded={false} style={{ padding: 16 }}>
        <PanelHeader t={t} Icon={BookOpen} title="Knowledge sources" hint="Files and docs the skill can reference" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 10 }}>
          {KNOWLEDGE_TYPES.map(k => {
            const on = draft.knowledge.includes(k.key);
            return (
              <button key={k.key} type="button" onClick={() => toggleKnowledge(k.key)}
                      style={miniChip(t, on)}>
                <k.Icon size={12} /> {k.label}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Tools & Actions */}
      <Card t={t} padded={false} style={{ padding: 16 }}>
        <PanelHeader t={t} Icon={Workflow} title="Tools & Actions" hint="What can this skill do?" />
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          {TOOL_TYPES.map(tool => {
            const on = draft.tools.includes(tool.key);
            // The whole row is the toggle target — using <button> for the
            // row would nest a <button> (Toggle) inside it, which is
            // invalid HTML. The visual toggle is rendered inline via
            // ToggleVisual instead.
            return (
              <button key={tool.key} type="button" onClick={() => toggleTool(tool.key)}
                      style={pickerRow(t, on)}>
                <span style={iconChip(t, on)}><tool.Icon size={13} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: t.white }}>{tool.label}</span>
                  <span style={{ display: "block", fontSize: 10.5, color: t.textMuted, marginTop: 1 }}>{tool.hint}</span>
                </span>
                <ToggleVisual t={t} on={on} />
              </button>
            );
          })}
        </div>
      </Card>

      {/* Output */}
      <Card t={t} padded={false} style={{ padding: 16 }}>
        <PanelHeader t={t} Icon={Sparkles} title="Output" hint="How does the result reach the user?" />
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          {OUTPUT_TYPES.map(o => {
            const active = draft.output === o.key;
            return (
              <button key={o.key} type="button" onClick={() => set({ output: o.key })}
                      style={pickerRow(t, active)}>
                <span style={iconChip(t, active)}><o.Icon size={13} /></span>
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: t.white }}>{o.label}</span>
                {active && <Check size={13} color="#a855f7" />}
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function PanelHeader({ t, Icon, title, hint }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          width: 24, height: 24, borderRadius: 7,
          background: `${t.accent}22`, color: "#a855f7",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon size={13} />
        </span>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white }}>{title}</h3>
      </div>
      {hint && <div style={{ fontSize: 11, color: t.textMuted, marginTop: 4, marginLeft: 32 }}>{hint}</div>}
    </div>
  );
}

const pickerRow = (t, active) => ({
  display: "flex", alignItems: "center", gap: 10,
  padding: "9px 10px", borderRadius: 10,
  background: active ? `linear-gradient(90deg, rgba(168,85,247,0.12), transparent)` : t.bgSurface,
  border: `1px solid ${active ? "rgba(168,85,247,0.45)" : t.border}`,
  textAlign: "left", color: "inherit", cursor: "pointer", width: "100%",
});

const iconChip = (t, active) => ({
  width: 28, height: 28, borderRadius: 8, flexShrink: 0,
  background: active ? `linear-gradient(135deg, #a855f7, ${t.accent})` : `${t.accent}1a`,
  color: active ? "#fff" : "#a855f7",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
});

const miniChip = (t, on) => ({
  display: "inline-flex", alignItems: "center", gap: 5,
  padding: "6px 9px", borderRadius: 999,
  fontSize: 11.5, fontWeight: 600, cursor: "pointer",
  background: on ? "rgba(168,85,247,0.18)" : t.bgSurface,
  color: on ? "#c4b8ff" : t.textMuted,
  border: `1px solid ${on ? "rgba(168,85,247,0.45)" : t.border}`,
  justifyContent: "center",
});

/* ─── Logic canvas (SVG node graph) ─── */

function LogicCanvas({ t, draft }) {
  // Build a linear node sequence: trigger → AI step → tool steps → output
  const triggerLabel = TRIGGER_TYPES.find(x => x.key === draft.trigger)?.label || "Trigger";
  const outputLabel  = OUTPUT_TYPES.find(x => x.key === draft.output)?.label || "Output";
  const toolNames    = draft.tools.map(k => TOOL_TYPES.find(tt => tt.key === k)?.label || k);

  const nodes = [
    { kind: "trigger", title: triggerLabel,                   sub: "Manual prompt"            },
    { kind: "ai",      title: "Analyze user request",         sub: "Gather inputs + intent"   },
    ...(draft.knowledge.length > 0
      ? [{ kind: "knowledge", title: "Reference knowledge",   sub: `${draft.knowledge.length} source${draft.knowledge.length > 1 ? "s" : ""}` }]
      : []),
    ...(toolNames.slice(0, 3).map((nm, i) => ({ kind: "tool", title: nm, sub: i === 0 ? "Primary action" : "Secondary action" }))),
    { kind: "ai",      title: "Generate final report",        sub: "Compose result"           },
    { kind: "output",  title: outputLabel,                    sub: "Deliver to user"          },
  ];

  return (
    <Card t={t} padded={false} style={{
      padding: 18, position: "relative", minHeight: 540,
      background: `linear-gradient(180deg, ${t.bgCard}, rgba(5,8,22,0.95))`,
      overflow: "hidden",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 12,
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: t.white }}>
            Build the logic of your skill
          </h2>
          <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>
            Define how your skill works. Add inputs, knowledge, steps and outputs.
          </div>
        </div>
        <span style={{
          fontSize: 10.5, padding: "4px 10px", borderRadius: 999,
          background: `${t.accent}1a`, color: "#a855f7", fontWeight: 700,
          letterSpacing: 0.5,
        }}>How it works</span>
      </div>

      {/* Subtle grid background */}
      <div aria-hidden style={{
        position: "absolute", inset: 0,
        backgroundImage: `radial-gradient(circle at 1px 1px, ${t.border} 1px, transparent 0)`,
        backgroundSize: "24px 24px",
        opacity: 0.5, pointerEvents: "none",
      }} />

      {/* Node column */}
      <div style={{
        position: "relative", zIndex: 1,
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: 14, padding: "8px 0",
      }}>
        {nodes.map((n, i) => (
          <div key={i} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center" }}>
            <NodeBox t={t} node={n} />
            {i < nodes.length - 1 && <NodeConnector t={t} />}
          </div>
        ))}
      </div>

      {/* Footer toolbar */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "12px 0 0", marginTop: 12,
        borderTop: `1px dashed ${t.border}`,
        position: "relative", zIndex: 1,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: t.textDim }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: "#10b981" }} />
            {nodes.length} steps
          </span>
          <span>·</span>
          <span>Auto-routed</span>
        </div>
        <button type="button" style={ghostBtn(t)}>
          <Plus size={13} /> Add step
        </button>
      </div>
    </Card>
  );
}

function NodeBox({ t, node }) {
  const styleByKind = {
    trigger:   { brd: "rgba(16,185,129,0.45)", bg: "rgba(16,185,129,0.12)",  fg: "#34d399", Icon: Play },
    ai:        { brd: "rgba(168,85,247,0.45)", bg: "rgba(168,85,247,0.12)",  fg: "#c4b8ff", Icon: Sparkles },
    tool:      { brd: "rgba(96,165,250,0.45)", bg: "rgba(96,165,250,0.12)",  fg: "#93c5fd", Icon: Workflow },
    knowledge: { brd: "rgba(34,211,238,0.45)", bg: "rgba(34,211,238,0.12)",  fg: "#67e8f9", Icon: BookOpen },
    output:    { brd: "rgba(245,158,11,0.45)", bg: "rgba(245,158,11,0.12)",  fg: "#fbbf24", Icon: Sparkles },
  };
  const s = styleByKind[node.kind] || styleByKind.ai;
  const I = s.Icon;
  return (
    <div style={{
      width: "min(360px, 88%)",
      padding: "12px 14px", borderRadius: 12,
      background: s.bg, border: `1px solid ${s.brd}`,
      boxShadow: `0 0 0 1px ${s.brd}55, 0 12px 30px rgba(0,0,0,0.35)`,
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <span style={{
        width: 30, height: 30, borderRadius: 8, flexShrink: 0,
        background: `${s.brd}33`, color: s.fg,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}>
        <I size={15} />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: t.white }}>{node.title}</div>
        <div style={{ fontSize: 11, color: t.textMuted, marginTop: 1 }}>{node.sub}</div>
      </div>
      <span style={{ color: t.textDim, fontSize: 11, fontFamily: "var(--font-jetbrains-mono), monospace" }}>⋮</span>
    </div>
  );
}

function NodeConnector({ t }) {
  return (
    <div style={{
      width: 1, height: 18,
      background: `linear-gradient(180deg, transparent, ${t.accent}, transparent)`,
      position: "relative",
    }}>
      <span style={{
        position: "absolute", bottom: -3, left: "50%", transform: "translateX(-50%)",
        width: 0, height: 0,
        borderLeft: "4px solid transparent",
        borderRight: "4px solid transparent",
        borderTop: `5px solid ${t.accent}`,
      }} />
    </div>
  );
}

/* ─── Sandbox (right rail of Step 2) ─── */

function LogicSandbox({ t, draft }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [vals, setVals] = useState({});

  const run = () => {
    setRunning(true);
    setResult(null);
    setTimeout(() => {
      setRunning(false);
      // Mock output. Composes a fake "insight preview" out of the inputs.
      const tokenName = vals.token || "NEAR Protocol";
      setResult({
        ok: true,
        title: tokenName,
        body: `${tokenName} shows strong developer activity with 23 new contracts deployed in the last 7 days. Social sentiment is positive. Key opportunities in AI integrations and gaming sector.`,
      });
    }, 1100);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <Card t={t} padded={false} style={{ padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: t.white }}>Preview &amp; Test</h3>
          <button type="button" onClick={() => { setResult(null); setVals({}); }}
                  style={{ ...ghostBtn(t), padding: "4px 8px", fontSize: 11 }}>
            <RefreshCw size={11} /> Reset
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 4, marginBottom: 14 }}>
          Try your skill with example data.
        </div>

        {draft.inputs.map(field => (
          <div key={field.id} style={{ marginBottom: 12 }}>
            <FieldLabel t={t}>
              {field.label}{field.required ? "" : " (optional)"}
            </FieldLabel>
            <input
              value={vals[field.type] || ""}
              onChange={(e) => setVals(v => ({ ...v, [field.type]: e.target.value }))}
              placeholder={placeholderFor(field.type)}
              style={input(t)}
            />
          </div>
        ))}

        <button type="button" onClick={run} disabled={running}
                style={{ ...primaryBtn(t, running), width: "100%", justifyContent: "center", marginTop: 4 }}>
          {running
            ? <><Loader2 size={13} style={{ animation: "ma-spin 0.9s linear infinite" }} /> Running…</>
            : <><Play size={13} /> Run test</>}
        </button>
      </Card>

      {result && (
        <Card t={t} padded={false} style={{ padding: 14, borderColor: "rgba(16,185,129,0.4)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{
              width: 26, height: 26, borderRadius: 8,
              background: "rgba(16,185,129,0.18)",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}><Bot size={13} color="#34d399" /></span>
            <span style={{ fontSize: 12.5, fontWeight: 800, color: t.white }}>Insight Preview</span>
            <span style={{ marginLeft: "auto" }}><Pill t={t} color="#34d399">Success</Pill></span>
          </div>
          <div style={{ fontSize: 12.5, color: t.text, lineHeight: 1.5 }}>
            <strong style={{ color: t.white }}>{result.title}</strong> {result.body}
          </div>
          <button type="button" style={{ ...ghostBtn(t), marginTop: 10, fontSize: 11 }}>
            View full output <ArrowRight size={11} />
          </button>
        </Card>
      )}

      <Card t={t} padded={false} style={{ padding: 14 }}>
        <h4 style={{ margin: 0, fontSize: 12.5, fontWeight: 800, color: t.white, marginBottom: 8 }}>
          Skill overview
        </h4>
        <OverviewRow t={t} k="Trigger"   v={TRIGGER_TYPES.find(x => x.key === draft.trigger)?.label || "—"} />
        <OverviewRow t={t} k="Inputs"    v={`${draft.inputs.length}`} />
        <OverviewRow t={t} k="Tools"     v={`${draft.tools.length}`} />
        <OverviewRow t={t} k="Knowledge" v={`${draft.knowledge.length} source${draft.knowledge.length === 1 ? "" : "s"}`} />
        <OverviewRow t={t} k="Output"    v={OUTPUT_TYPES.find(x => x.key === draft.output)?.label || "—"} />
      </Card>
    </div>
  );
}

function placeholderFor(type) {
  switch (type) {
    case "wallet":   return "near1qxy2…4ns8";
    case "token":    return "NEAR Protocol";
    case "contract": return "v2.ref-finance.near";
    case "url":      return "https://…";
    case "file":     return "filename.pdf";
    default:         return "";
  }
}

function OverviewRow({ t, k, v }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      fontSize: 12, padding: "4px 0",
    }}>
      <span style={{ color: t.textMuted }}>{k}</span>
      <span style={{ color: t.white, fontWeight: 600 }}>{v}</span>
    </div>
  );
}

/* ─────────────────────────  Step 3 — Permissions  ───────────────────────── */

function StepPermissions({ t, draft, set }) {
  const risk = useMemo(() => computeRisk(draft.perms), [draft.perms]);
  const togglePerm = (k) => set({ perms: { ...draft.perms, [k]: !draft.perms[k] } });

  return (
    <div style={{
      display: "grid", gap: 14,
      gridTemplateColumns: "minmax(0, 1fr) 320px",
    }} className="sk-perm-grid">
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <Card t={t}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 4 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: t.white }}>
                Set permissions for your skill
              </h2>
              <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 4 }}>
                Define exactly what your skill can access and do. Transparency builds trust.
              </div>
            </div>
            <button type="button" style={ghostBtn(t)}>
              <Info size={12} /> Permission guide
            </button>
          </div>
        </Card>

        {PERM_GROUPS.map(group => (
          <Card t={t} key={group.key}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{
                width: 36, height: 36, borderRadius: 10,
                background: `${t.accent}1a`, color: "#a855f7",
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}>
                <group.Icon size={17} />
              </span>
              <div>
                <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: t.white }}>{group.label}</h3>
                <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 2 }}>{group.blurb}</div>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 18, fontSize: 11.5, color: t.textDim }}>
                <span style={{ width: 80, textAlign: "right" }}>Permission</span>
                <span style={{ width: 70, textAlign: "right" }}>Risk Level</span>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", borderTop: `1px solid ${t.border}` }}>
              {group.items.map(p => {
                const on = !!draft.perms[p.key];
                const rc = RISK_COLOR[p.risk];
                return (
                  <div key={p.key} style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr 100px 80px 22px",
                    alignItems: "center", gap: 10,
                    padding: "12px 0", borderBottom: `1px solid ${t.border}`,
                  }}>
                    <span style={{
                      width: 28, height: 28, borderRadius: 8,
                      background: t.bgSurface, color: t.textMuted,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <PermIcon perm={p.key} size={14} />
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: t.white }}>{p.label}</div>
                      <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 1 }}>{p.sub}</div>
                    </div>
                    <div style={{ justifySelf: "end" }}>
                      <Toggle t={t} on={on} onChange={() => togglePerm(p.key)} />
                    </div>
                    <span style={{
                      justifySelf: "end",
                      fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999,
                      background: rc.bg, color: rc.fg, border: `1px solid ${rc.brd}`,
                      textTransform: "capitalize",
                    }}>{p.risk}</span>
                    <HelpCircle size={14} color={t.textDim} style={{ justifySelf: "end" }} />
                  </div>
                );
              })}
            </div>

            {/* High-risk warning, only when enabled in this group */}
            {group.items.some(p => p.risk === "high" && draft.perms[p.key]) && (
              <div style={{
                marginTop: 12,
                padding: "10px 12px",
                background: "rgba(245,158,11,0.10)",
                border: "1px solid rgba(245,158,11,0.35)",
                borderRadius: 10,
                display: "flex", alignItems: "center", gap: 10,
                fontSize: 12, color: t.text,
              }}>
                <AlertTriangle size={15} color="#fbbf24" />
                <span>
                  <strong style={{ color: "#fbbf24" }}>High risk permissions</strong> can move or
                  spend user assets. Users will be asked for confirmation.
                </span>
              </div>
            )}
          </Card>
        ))}
      </div>

      <SecurityRail t={t} draft={draft} set={set} risk={risk} />
    </div>
  );
}

function PermIcon({ perm, size }) {
  const map = {
    read_addr:     Wallet,
    read_tx:       Activity,
    read_balance:  Coins,
    execute_swap:  Repeat,
    transfer:      ArrowRight,
    read_x:        Send,
    post_x:        Send,
    read_discord:  MessageSquare,
    send_telegram: Send,
    read_files:    FileText,
    read_docs:     BookOpen,
    read_apis:     Globe,
  };
  const I = map[perm] || Shield;
  return <I size={size} />;
}

function SecurityRail({ t, draft, set, risk }) {
  const rc = RISK_COLOR[risk.level];
  const checklistItems = [
    { ok: !draft.perms.transfer,                                    label: "No unrestricted asset transfer" },
    { ok: !!(draft.perms.read_addr || draft.perms.read_balance),    label: "Read-only access by default" },
    { ok: draft.permExpiration !== "never",                         label: "Permissions expire automatically" },
    { ok: draft.spendingDailyNear > 0 || !draft.perms.execute_swap, label: "Spending limit enforced" },
    { ok: true,                                                     label: "Encrypted credentials at rest" },
  ];

  const enabled = PERM_GROUPS.flatMap(g => g.items).filter(p => draft.perms[p.key]).length;
  const total = PERM_GROUPS.flatMap(g => g.items).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      {/* Permission summary */}
      <Card t={t} padded={false} style={{ padding: 16 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white }}>Permission summary</h3>
        <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 4 }}>
          {enabled} of {total} permissions enabled
        </div>

        <div style={{ marginTop: 14, marginBottom: 12 }}>
          <RiskGauge level={risk.level} />
        </div>
        <div style={{ textAlign: "center", fontSize: 16, fontWeight: 800, color: rc.fg }}>
          {rc.label}
        </div>
        <div style={{ textAlign: "center", fontSize: 11.5, color: t.textMuted, marginTop: 2 }}>
          This skill has {risk.level === "low" ? "minimal" : risk.level === "medium" ? "moderate" : "elevated"} access.
        </div>
      </Card>

      {/* Spending limits */}
      <Card t={t} padded={false} style={{ padding: 16 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white }}>Spending limits</h3>
        <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 4, marginBottom: 14 }}>
          Set limits to protect your users.
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: t.text, fontWeight: 600 }}>Daily limit (NEAR)</span>
            <span style={{
              fontSize: 12, fontWeight: 800, color: t.white,
              fontFamily: "var(--font-jetbrains-mono), monospace",
            }}>
              {draft.spendingDailyNear === 0 ? "0" : draft.spendingDailyNear}
              <span style={{ color: t.textDim, fontWeight: 600, marginLeft: 4 }}>NEAR</span>
            </span>
          </div>
          <Slider t={t} min={0} max={1000} step={5}
                  value={draft.spendingDailyNear}
                  onChange={(v) => set({ spendingDailyNear: v })} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10.5, color: t.textDim }}>
            <span>0</span><span>Unlimited</span>
          </div>
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: t.text, fontWeight: 600 }}>Transactions per day</span>
            <span style={{
              fontSize: 12, fontWeight: 800, color: t.white,
              fontFamily: "var(--font-jetbrains-mono), monospace",
            }}>{draft.spendingTxPerDay} <span style={{ color: t.textDim, fontWeight: 600 }}>tx</span></span>
          </div>
          <Slider t={t} min={0} max={500} step={5}
                  value={draft.spendingTxPerDay}
                  onChange={(v) => set({ spendingTxPerDay: v })} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10.5, color: t.textDim }}>
            <span>0</span><span>Unlimited</span>
          </div>
        </div>
      </Card>

      {/* Expiration */}
      <Card t={t} padded={false} style={{ padding: 16 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white }}>Permission expiration</h3>
        <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 4, marginBottom: 12 }}>
          Choose how long permissions last.
        </div>
        <Select t={t} value={draft.permExpiration} onChange={(v) => set({ permExpiration: v })}>
          {PERM_EXPIRATIONS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </Select>
        <div style={{
          marginTop: 12, padding: "9px 11px", borderRadius: 10,
          background: `${t.accent}10`, border: `1px solid ${t.border}`,
          display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: t.textMuted,
        }}>
          <Info size={13} color="#a855f7" />
          {draft.permExpiration === "never"
            ? "Permissions stay valid until the user revokes them."
            : `Users will be asked to re-approve after ${PERM_EXPIRATIONS.find(p => p.key === draft.permExpiration)?.label}.`}
        </div>
      </Card>

      {/* Security checklist */}
      <Card t={t} padded={false} style={{ padding: 16 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white, marginBottom: 10 }}>
          Security checklist
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {checklistItems.map((c, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 8,
              fontSize: 12, color: c.ok ? t.text : t.textDim,
            }}>
              <span style={{
                width: 18, height: 18, borderRadius: 999, flexShrink: 0,
                background: c.ok ? "rgba(16,185,129,0.18)" : t.bgSurface,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                color: c.ok ? "#34d399" : t.textDim,
              }}>
                {c.ok ? <Check size={11} /> : <XIcon size={10} />}
              </span>
              {c.label}
            </div>
          ))}
        </div>
        <div style={{
          marginTop: 14, paddingTop: 12, borderTop: `1px dashed ${t.border}`,
          display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: t.textMuted,
        }}>
          <ShieldCheck size={13} color="#a855f7" />
          Your users' security is our priority
        </div>
      </Card>
    </div>
  );
}

function RiskGauge({ level }) {
  // Simple SVG arc gauge
  const positions = { low: 25, medium: 50, high: 80 };
  const angle = -90 + (positions[level] || 25) * 1.8; // -90 → 90
  const rc = RISK_COLOR[level];
  return (
    <svg viewBox="0 0 200 110" style={{ width: "100%", height: 110 }}>
      <defs>
        <linearGradient id="risk-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"  stopColor="#10b981" />
          <stop offset="50%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#ef4444" />
        </linearGradient>
      </defs>
      <path d="M20,100 A80,80 0 0,1 180,100" stroke="url(#risk-gradient)" strokeWidth="14"
            strokeLinecap="round" fill="none" />
      <g transform={`translate(100,100) rotate(${angle})`}>
        <line x1="0" y1="0" x2="0" y2="-66" stroke={rc.fg} strokeWidth="3" strokeLinecap="round" />
        <circle cx="0" cy="0" r="6" fill={rc.fg} />
      </g>
    </svg>
  );
}

/* ─────────────────────────  Step 4 — Pricing  ───────────────────────── */

function StepPricing({ t, draft, set }) {
  const earnings = useMemo(() => projectEarnings(draft), [draft]);
  return (
    <div style={{
      display: "grid", gap: 14,
      gridTemplateColumns: "minmax(0, 1fr) 320px",
    }} className="sk-pricing-grid">
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <Card t={t}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: t.white }}>Choose a pricing model</h2>
          <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 4, marginBottom: 16 }}>
            How will users pay for this skill? You can change pricing later.
          </div>
          <div style={{
            display: "grid", gap: 10,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          }}>
            {PRICING_MODELS.map(pm => {
              const active = draft.pricingModel === pm.key;
              return (
                <button key={pm.key} type="button" onClick={() => set({ pricingModel: pm.key })}
                        style={{
                          textAlign: "left", padding: "14px 16px",
                          background: active ? `${t.accent}14` : t.bgSurface,
                          border: `1.5px solid ${active ? "rgba(168,85,247,0.55)" : t.border}`,
                          borderRadius: 12, cursor: "pointer", color: "inherit",
                          boxShadow: active ? `0 0 0 1px rgba(168,85,247,0.18) inset` : "none",
                          transition: "border-color 120ms ease, background 120ms ease",
                        }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{
                      width: 28, height: 28, borderRadius: 8, color: active ? "#fff" : "#a855f7",
                      background: active ? `linear-gradient(135deg, #a855f7, ${t.accent})` : `${t.accent}1a`,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <pm.Icon size={14} />
                    </span>
                    <span style={{ fontSize: 13.5, fontWeight: 800, color: t.white }}>{pm.label}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: t.textMuted, lineHeight: 1.5 }}>{pm.blurb}</div>
                </button>
              );
            })}
          </div>
        </Card>

        <Card t={t}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: t.white }}>Configure pricing</h3>
          <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4, marginBottom: 14 }}>
            Set the price for the chosen model. All values in NEAR.
          </div>
          {draft.pricingModel === "free" && (
            <EmptyHint t={t} icon={<Sparkles size={20} />} title="Free skill"
              body="No setup needed. Anyone can install your skill — perfect for building reputation and a user base." />
          )}
          {draft.pricingModel === "one_time" && (
            <PricingFieldRow t={t} label="Install price (NEAR)" hint="One-time payment, lifetime access."
              value={draft.pricingValue.oneTime}
              onChange={(v) => set({ pricingValue: { ...draft.pricingValue, oneTime: v } })} />
          )}
          {draft.pricingModel === "subscription" && (
            <PricingFieldRow t={t} label="Monthly price (NEAR)" hint="Recurring monthly subscription."
              value={draft.pricingValue.monthly}
              onChange={(v) => set({ pricingValue: { ...draft.pricingValue, monthly: v } })} />
          )}
          {draft.pricingModel === "per_exec" && (
            <PricingFieldRow t={t} label="Price per execution (NEAR)" hint="Charged each time the skill runs."
              value={draft.pricingValue.perExec}
              onChange={(v) => set({ pricingValue: { ...draft.pricingValue, perExec: v } })}
              step={0.001} />
          )}
          {draft.pricingModel === "rev_share" && (
            <PricingFieldRow t={t} label="Revenue share %" hint="Cut of value generated by the skill."
              value={draft.pricingValue.revSharePct}
              onChange={(v) => set({ pricingValue: { ...draft.pricingValue, revSharePct: v } })}
              suffix="%" max={50} />
          )}

          <div style={{
            marginTop: 14, padding: 12, borderRadius: 10,
            background: t.bgSurface, border: `1px solid ${t.border}`,
            fontSize: 12, color: t.textMuted, lineHeight: 1.6,
          }}>
            Platform fee: <strong style={{ color: t.white }}>1%</strong>. You keep 99% of every install.
            Payouts settle on-chain to your connected wallet.
          </div>
        </Card>
      </div>

      <PricingSidebar t={t} draft={draft} earnings={earnings} set={set} />
    </div>
  );
}

function projectEarnings(draft) {
  const installs = Number(draft.estMonthlyInstalls) || 0;
  let monthly = 0;
  if (draft.pricingModel === "one_time") monthly = installs * Number(draft.pricingValue.oneTime || 0);
  else if (draft.pricingModel === "subscription") monthly = installs * Number(draft.pricingValue.monthly || 0);
  else if (draft.pricingModel === "per_exec") monthly = installs * 30 * Number(draft.pricingValue.perExec || 0); // 30 runs/installer
  else if (draft.pricingModel === "rev_share") monthly = installs * 2 * (Number(draft.pricingValue.revSharePct || 0) / 100);
  return {
    monthly,
    monthlyAfterFee: monthly * 0.99,
    yearly: monthly * 12 * 0.99,
  };
}

function PricingFieldRow({ t, label, hint, value, onChange, step = 0.1, suffix = "NEAR", max = 1000 }) {
  return (
    <div>
      <FieldLabel t={t} hint={hint}>{label}</FieldLabel>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input type="number" min={0} max={max} step={step}
               value={value}
               onChange={(e) => onChange?.(Number(e.target.value))}
               style={{ ...input(t), maxWidth: 200, fontFamily: "var(--font-jetbrains-mono), monospace" }} />
        <span style={{ fontSize: 12, color: t.textDim, fontWeight: 600 }}>{suffix}</span>
      </div>
    </div>
  );
}

function EmptyHint({ t, icon, title, body }) {
  return (
    <div style={{
      padding: 18, borderRadius: 12,
      background: t.bgSurface, border: `1px dashed ${t.border}`,
      display: "flex", gap: 12, alignItems: "center",
    }}>
      <span style={{
        width: 40, height: 40, borderRadius: 10,
        background: `${t.accent}1a`, color: "#a855f7",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>{icon}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 800, color: t.white }}>{title}</div>
        <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 3, lineHeight: 1.55 }}>{body}</div>
      </div>
    </div>
  );
}

function PricingSidebar({ t, draft, earnings, set }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <Card t={t} padded={false} style={{ padding: 16 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white }}>Projected earnings</h3>
        <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 4, marginBottom: 14 }}>
          Estimate based on monthly installs. Tune below.
        </div>
        <div style={{
          padding: 14, borderRadius: 12,
          background: `linear-gradient(135deg, rgba(168,85,247,0.14), rgba(96,165,250,0.10))`,
          border: `1px solid rgba(168,85,247,0.36)`,
          marginBottom: 14,
        }}>
          <div style={{ fontSize: 11, color: t.textMuted, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>
            Per month
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: t.white, marginTop: 4 }}>
            {fmtNear(earnings.monthlyAfterFee)} <span style={{ fontSize: 14, color: t.textMuted, fontWeight: 600 }}>NEAR</span>
          </div>
          <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 4 }}>
            ≈ {fmtNear(earnings.yearly)} NEAR / year (after 1% platform fee)
          </div>
        </div>

        <FieldLabel t={t}>Estimated monthly installs</FieldLabel>
        <Slider t={t} min={0} max={5000} step={20}
                value={draft.estMonthlyInstalls}
                onChange={(v) => set({ estMonthlyInstalls: v })} />
        <div style={{
          display: "flex", justifyContent: "space-between", marginTop: 6,
          fontSize: 11, color: t.textDim,
          fontFamily: "var(--font-jetbrains-mono), monospace",
        }}>
          <span>0</span>
          <span style={{ color: t.white, fontWeight: 700 }}>{draft.estMonthlyInstalls}</span>
          <span>5,000</span>
        </div>
      </Card>

      <Card t={t} padded={false} style={{ padding: 16 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white, marginBottom: 10 }}>Pricing tips</h3>
        <Tip t={t}>Free skills build reputation faster — consider it for your first listing.</Tip>
        <Tip t={t}>Per-execution pricing converts best when value is clearly tied to a single run.</Tip>
        <Tip t={t}>Subscriptions reward stable, ongoing skills like daily briefings.</Tip>
      </Card>
    </div>
  );
}

function Tip({ t, children }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 8,
      padding: "8px 0", borderBottom: `1px dashed ${t.border}`,
      fontSize: 12, color: t.textMuted, lineHeight: 1.55,
    }}>
      <span style={{ flexShrink: 0, color: "#a855f7", marginTop: 1 }}>✓</span>
      {children}
    </div>
  );
}

function fmtNear(n) {
  if (!n) return "0";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  if (n < 0.01)  return n.toFixed(4);
  return n.toFixed(2);
}

/* ─────────────────────────  Step 5 — Review & Publish  ───────────────────────── */

function StepReview({ t, draft, error, submitting, onPublish }) {
  const risk = useMemo(() => computeRisk(draft.perms), [draft.perms]);
  const earnings = useMemo(() => projectEarnings(draft), [draft]);
  const rc = RISK_COLOR[risk.level];

  return (
    <div style={{
      display: "grid", gap: 14,
      gridTemplateColumns: "minmax(0, 1fr) 320px",
    }} className="sk-review-grid">
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <Card t={t}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: t.white }}>Review &amp; publish</h2>
          <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 4, marginBottom: 16 }}>
            Final preview of your skill before it goes live in the marketplace.
          </div>

          <SkillCardPreview t={t} draft={draft} />

          <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${t.border}` }}>
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 12,
            }}>
              <ReviewRow t={t} k="Category"      v={CATEGORIES.find(c => c.key === draft.category)?.label || "—"} />
              <ReviewRow t={t} k="Pricing"       v={PRICING_MODELS.find(p => p.key === draft.pricingModel)?.label || "—"} />
              <ReviewRow t={t} k="Trigger"       v={TRIGGER_TYPES.find(p => p.key === draft.trigger)?.label || "—"} />
              <ReviewRow t={t} k="Output"        v={OUTPUT_TYPES.find(p => p.key === draft.output)?.label || "—"} />
              <ReviewRow t={t} k="Permissions"   v={`${PERM_GROUPS.flatMap(g => g.items).filter(p => draft.perms[p.key]).length} enabled`} />
              <ReviewRow t={t} k="Risk level"    v={<span style={{ color: rc.fg, fontWeight: 800 }}>{rc.label}</span>} />
            </div>
          </div>
        </Card>

        {error && (
          <div style={{
            padding: "12px 14px", borderRadius: 12,
            border: `1px solid rgba(239,68,68,0.4)`,
            background: "rgba(239,68,68,0.10)", color: "#fca5a5", fontSize: 13,
          }}>
            <strong>Publish failed.</strong> {error}
          </div>
        )}

        <Card t={t}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14,
            flexWrap: "wrap",
          }}>
            <div style={{ minWidth: 0, flex: "1 1 280px" }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: t.white }}>Ready to publish?</div>
              <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4, lineHeight: 1.55 }}>
                One on-chain call (<code style={{ color: t.text, fontSize: 11.5 }}>create_skill</code>) registers
                your skill in the marketplace. Logic, permissions, and pricing are saved as a draft locally —
                richer config lands on-chain in a future contract upgrade.
              </div>
            </div>
            <button type="button" onClick={onPublish} disabled={submitting}
                    style={{ ...primaryBtn(t, submitting), justifyContent: "center" }}>
              {submitting
                ? <><Loader2 size={13} style={{ animation: "ma-spin 0.9s linear infinite" }} /> Publishing…</>
                : <><Sparkles size={13} /> Publish to marketplace</>}
            </button>
          </div>
        </Card>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <Card t={t} padded={false} style={{ padding: 16 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white, marginBottom: 10 }}>Summary</h3>
          <OverviewRow t={t} k="Name"        v={draft.name || "—"} />
          <OverviewRow t={t} k="Category"    v={CATEGORIES.find(c => c.key === draft.category)?.label || "—"} />
          <OverviewRow t={t} k="Tags"        v={draft.tags.length ? `${draft.tags.length}` : "—"} />
          <OverviewRow t={t} k="Trigger"     v={TRIGGER_TYPES.find(p => p.key === draft.trigger)?.label || "—"} />
          <OverviewRow t={t} k="Tools"       v={`${draft.tools.length}`} />
          <OverviewRow t={t} k="Risk"        v={<span style={{ color: rc.fg, fontWeight: 700 }}>{rc.label}</span>} />
          <OverviewRow t={t} k="Pricing"     v={PRICING_MODELS.find(p => p.key === draft.pricingModel)?.label || "—"} />
        </Card>

        <Card t={t} padded={false} style={{ padding: 16 }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white, marginBottom: 4 }}>Earnings forecast</h3>
          <div style={{ fontSize: 11, color: t.textMuted, marginBottom: 12 }}>Based on {draft.estMonthlyInstalls} installs/mo</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: t.white }}>
            {fmtNear(earnings.monthlyAfterFee)} <span style={{ fontSize: 12, color: t.textMuted, fontWeight: 600 }}>NEAR / mo</span>
          </div>
          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 4 }}>
            ≈ {fmtNear(earnings.yearly)} NEAR / yr after platform fee
          </div>
        </Card>
      </div>
    </div>
  );
}

function ReviewRow({ t, k, v }) {
  return (
    <div style={{
      padding: 10, borderRadius: 10,
      background: t.bgSurface, border: `1px solid ${t.border}`,
    }}>
      <div style={{ fontSize: 10.5, color: t.textDim, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6 }}>{k}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: t.white, marginTop: 4 }}>{v}</div>
    </div>
  );
}

function SkillCardPreview({ t, draft, compact }) {
  const cat = CATEGORIES.find(c => c.key === draft.category)?.label;
  const price = priceLabel(draft);
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: compact ? "1fr" : "minmax(0, 1fr) 240px",
      gap: 14, padding: 0,
    }}>
      <div style={{
        padding: 16, borderRadius: 14,
        background: t.bgSurface, border: `1px solid ${t.border}`,
        display: "flex", flexDirection: "column", gap: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10, flexShrink: 0,
            background: draft.imageUrl
              ? `url(${draft.imageUrl}) center/cover`
              : `linear-gradient(135deg, #a855f7, ${t.accent})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff",
          }}>
            {!draft.imageUrl && <Sparkles size={20} />}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: t.white }}>
              {draft.name || "Untitled skill"}
            </div>
            <div style={{ fontSize: 11.5, color: t.textMuted, fontFamily: "var(--font-jetbrains-mono), monospace", marginTop: 1 }}>
              by you
            </div>
          </div>
          <Pill t={t}>{price}</Pill>
        </div>
        <div style={{ fontSize: 12.5, color: t.text, lineHeight: 1.55 }}>
          {draft.shortDesc || "Your short description will appear here."}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {cat && <span style={{
            fontSize: 11, padding: "3px 8px", borderRadius: 999,
            background: t.bg, border: `1px solid ${t.border}`, color: t.textMuted,
          }}>{cat}</span>}
          {draft.tags.slice(0, 4).map(tag => (
            <span key={tag} style={{
              fontSize: 11, padding: "3px 8px", borderRadius: 999,
              background: t.bg, border: `1px solid ${t.border}`, color: t.textMuted,
            }}>#{tag}</span>
          ))}
        </div>
        <div style={{
          display: "flex", gap: 8, marginTop: 4, paddingTop: 10,
          borderTop: `1px dashed ${t.border}`,
        }}>
          <button type="button" style={{ ...primaryBtn(t), padding: "8px 14px", flex: 1, justifyContent: "center" }}>Install</button>
          <button type="button" style={{ ...secondaryBtn(t), padding: "8px 14px" }}>Demo</button>
        </div>
      </div>

      {!compact && (
        <div style={{
          padding: 14, borderRadius: 12,
          background: t.bgSurface, border: `1px solid ${t.border}`,
          display: "flex", flexDirection: "column", gap: 10, minWidth: 0,
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: t.white }}>What this does</div>
          <div style={{ fontSize: 11.5, color: t.textMuted, lineHeight: 1.55 }}>
            {draft.longDesc || "Detailed description will appear here for users browsing your skill."}
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 11, color: t.textDim, marginTop: "auto", paddingTop: 6,
            borderTop: `1px dashed ${t.border}`,
          }}>
            <Award size={11} /> Version 1.0.0 · Just now
          </div>
        </div>
      )}
    </div>
  );
}

function priceLabel(draft) {
  if (draft.pricingModel === "free") return "Free";
  if (draft.pricingModel === "one_time") return `${draft.pricingValue.oneTime} NEAR`;
  if (draft.pricingModel === "subscription") return `${draft.pricingValue.monthly} NEAR/mo`;
  if (draft.pricingModel === "per_exec") return `${draft.pricingValue.perExec} NEAR/run`;
  if (draft.pricingModel === "rev_share") return `${draft.pricingValue.revSharePct}% rev`;
  return "—";
}

/* ─────────────────────────  Bottom analytics strip  ───────────────────────── */

function AnalyticsStrip({ t, draft }) {
  const earnings = projectEarnings(draft);
  const cells = [
    { label: "Estimated installs",    value: `${draft.estMonthlyInstalls}/mo`,                Icon: TrendingUp },
    { label: "Monthly earnings",      value: `${fmtNear(earnings.monthlyAfterFee)} NEAR`,     Icon: DollarSign },
    { label: "Competition",           value: "Medium",                                        Icon: BarChart3 },
    { label: "Category rank",         value: "#3",                                            Icon: Award },
  ];
  return (
    <Card t={t} padded={false} style={{
      padding: 16, marginTop: 16,
      background: `linear-gradient(180deg, ${t.bgCard}, rgba(5,8,22,0.95))`,
    }}>
      <div style={{
        display: "grid", gap: 12,
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
      }}>
        {cells.map(c => (
          <div key={c.label} style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "10px 12px",
          }}>
            <span style={{
              width: 36, height: 36, borderRadius: 10,
              background: `${t.accent}1a`, color: "#a855f7",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <c.Icon size={16} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, color: t.textDim, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase" }}>
                {c.label}
              </div>
              <div style={{ fontSize: 15, color: t.white, fontWeight: 800, marginTop: 2 }}>{c.value}</div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ─────────────────────────  Main page  ───────────────────────── */

export default function CreateSkillPage() {
  const t = useTheme();
  const router = useRouter();
  const { connected, showModal } = useWallet?.() || {};
  const { createSkill } = useAgent();

  const [draft, setDraft]           = useState(defaultDraft);
  const [step, setStep]             = useState(0);
  const [completed, setCompleted]   = useState(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState(null);
  const [savedAt, setSavedAt]       = useState(0);

  // Hydrate from localStorage on first mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        setDraft(d => ({ ...d, ...parsed }));
      }
    } catch {}
  }, []);

  const set = useCallback((patch) => setDraft(d => ({ ...d, ...patch })), []);

  const persist = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      setSavedAt(Date.now());
    } catch {}
  }, [draft]);

  // Auto-save every 1.2s after edits
  useEffect(() => {
    const id = setTimeout(persist, 1200);
    return () => clearTimeout(id);
  }, [draft, persist]);

  // Validation per step → gates the Next button
  const stepValid = useMemo(() => {
    if (step === 0) return draft.name.trim().length >= 2 && draft.shortDesc.trim().length >= 4 && !!draft.category;
    if (step === 1) return draft.inputs.length >= 1 && !!draft.output;
    if (step === 2) return Object.values(draft.perms).some(Boolean);
    if (step === 3) return !!draft.pricingModel;
    return true;
  }, [step, draft]);

  const goNext = useCallback(() => {
    if (step === STEPS.length - 1) {
      doPublish();
      return;
    }
    if (!stepValid) return;
    setCompleted(c => new Set([...c, step]));
    setStep(s => Math.min(STEPS.length - 1, s + 1));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }, [step, stepValid]); // eslint-disable-line react-hooks/exhaustive-deps

  const goBack = () => {
    setStep(s => Math.max(0, s - 1));
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goJump = (i) => {
    setStep(i);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const doPublish = async () => {
    if (!connected) { showModal?.(); return; }
    setSubmitting(true);
    setError(null);
    try {
      const combined = [draft.shortDesc.trim(), draft.longDesc.trim()]
        .filter(Boolean).join("\n\n").slice(0, LONG_MAX);
      const categoryLabel = (CATEGORIES.find(c => c.key === draft.category) || {}).label || draft.category || "Other";
      const yoctoPrice = nearToYocto(priceForOnchain(draft));
      await createSkill({
        name:        draft.name.trim().slice(0, NAME_MAX),
        description: combined,
        priceYocto:  yoctoPrice,
        category:    categoryLabel.slice(0, CATEGORY_MAX),
        tags:        draft.tags.slice(0, MAX_TAGS),
        imageUrl:    (draft.imageUrl || "").trim().slice(0, IMAGE_URL_MAX),
      });
      // Clear draft and route to marketplace
      try { window.localStorage.removeItem(DRAFT_KEY); } catch {}
      router.push("/skills/mine");
    } catch (e) {
      setError(e?.message || "Publish failed");
    } finally {
      setSubmitting(false);
    }
  };

  const onPreview = () => {
    if (typeof window === "undefined") return;
    const blob = JSON.stringify(draft, null, 2);
    const w = window.open("", "_blank");
    if (w) {
      w.document.title = `Preview · ${draft.name || "Untitled skill"}`;
      w.document.body.style.cssText = "background:#050816;color:#cbd5e1;font:13px ui-monospace,monospace;padding:24px";
      w.document.body.textContent = blob;
    }
  };

  return (
    <>
      <PageHeader
        t={t} draft={draft} savedAt={savedAt}
        onSave={persist} onPreview={onPreview}
        onNext={goNext} onBack={goBack}
        step={step} canAdvance={stepValid} busy={submitting}
      />
      <ProgressNav t={t} step={step} completed={completed} onJump={goJump} />

      {step === 0 && (
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(0, 1fr) 320px" }} className="sk-basics-shell">
          <StepBasics t={t} draft={draft} set={set} />
          <BasicsSidebar t={t} draft={draft} />
        </div>
      )}
      {step === 1 && <StepLogic t={t} draft={draft} set={set} />}
      {step === 2 && <StepPermissions t={t} draft={draft} set={set} />}
      {step === 3 && <StepPricing t={t} draft={draft} set={set} />}
      {step === 4 && <StepReview t={t} draft={draft} error={error} submitting={submitting} onPublish={doPublish} />}

      <AnalyticsStrip t={t} draft={draft} />

      <style jsx global>{`
        @keyframes ma-spin { to { transform: rotate(360deg); } }

        .sk-slider::-webkit-slider-thumb {
          appearance: none;
          width: 16px; height: 16px; border-radius: 50%;
          background: linear-gradient(135deg, #a855f7, #60a5fa);
          border: 2px solid #fff;
          box-shadow: 0 4px 10px rgba(168,85,247,0.45);
          cursor: pointer;
        }
        .sk-slider::-moz-range-thumb {
          width: 16px; height: 16px; border-radius: 50%;
          background: linear-gradient(135deg, #a855f7, #60a5fa);
          border: 2px solid #fff;
          box-shadow: 0 4px 10px rgba(168,85,247,0.45);
          cursor: pointer;
        }

        @media (max-width: 1100px) {
          .sk-logic-grid    { grid-template-columns: 1fr !important; }
          .sk-perm-grid,
          .sk-pricing-grid,
          .sk-review-grid,
          .sk-basics-shell  { grid-template-columns: 1fr !important; }
        }

        @media (max-width: 720px) {
          .sk-basics-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </>
  );
}

function priceForOnchain(draft) {
  if (draft.pricingModel === "one_time")     return String(draft.pricingValue.oneTime || 0);
  if (draft.pricingModel === "subscription") return String(draft.pricingValue.monthly || 0);
  if (draft.pricingModel === "per_exec")     return String(draft.pricingValue.perExec || 0);
  return "0";
}

/* ─── Right rail for Step 1 (Basics): tips + overview ─── */

function BasicsSidebar({ t, draft }) {
  const tips = [
    "Use a clear and specific name — it shows up in search.",
    "Write a detailed description that answers \"what does this do for me?\".",
    "Add 2–4 tags. Too many dilutes discoverability.",
    "A square 256×256 thumbnail looks best in the marketplace grid.",
    "Pick the most narrow category that fits — it's how users find you.",
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <Card t={t} padded={false} style={{ padding: 16 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white, marginBottom: 10 }}>Tips for a great skill</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {tips.map((tip, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "flex-start", gap: 8,
              padding: "8px 0", borderBottom: i === tips.length - 1 ? "none" : `1px dashed ${t.border}`,
              fontSize: 12, color: t.textMuted, lineHeight: 1.55,
            }}>
              <span style={{ flexShrink: 0, color: "#a855f7", marginTop: 1 }}>✓</span>
              {tip}
            </div>
          ))}
        </div>
      </Card>

      <Card t={t} padded={false} style={{ padding: 16 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: t.white, marginBottom: 10 }}>Skill overview</h3>
        <OverviewRow t={t} k="Name"        v={draft.name || "—"} />
        <OverviewRow t={t} k="Category"    v={CATEGORIES.find(c => c.key === draft.category)?.label || "—"} />
        <OverviewRow t={t} k="Tags"        v={`${draft.tags.length}/${MAX_TAGS}`} />
        <OverviewRow t={t} k="Description" v={`${(draft.shortDesc.length + draft.longDesc.length)} chars`} />
        <OverviewRow t={t} k="Status"      v="Draft" />
      </Card>

      <Card t={t} padded={false} style={{
        padding: 16,
        background: `linear-gradient(160deg, rgba(168,85,247,0.14), rgba(96,165,250,0.10) 50%, transparent)`,
      }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: t.white, marginBottom: 4 }}>
          A skill, not just a listing
        </div>
        <div style={{ fontSize: 11.5, color: t.textMuted, lineHeight: 1.55 }}>
          Steps 2–4 capture the actual logic, permissions, and pricing — the bits that make
          your skill installable and monetizable, not just discoverable.
        </div>
      </Card>
    </div>
  );
}
