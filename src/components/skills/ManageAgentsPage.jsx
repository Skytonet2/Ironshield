"use client";
// ManageAgentsPage (/agents/me). Dashboard of agents the current user
// has connected — list view matching the mock, parallel to the
// marketplace chrome via SkillsShell.
//
// Layout (desktop):
//   • Title + "+ Connect new agent" CTA
//   • 4-stat strip: connected / pending / installs / skills enabled
//   • Connected agents rows (icon + meta | status | permissions | installed skills | Configure)
//   • Available connections cards (Ironclaw, Openclaw — Connect CTA)
//   • Footer security reassurance banner

import Link from "next/link";
import {
  Plus, ExternalLink, MoreHorizontal, CheckCircle2, Shield,
  Eye, Pencil, MessageSquare, DollarSign, Coins, Bot, Headphones,
  ArrowRight,
} from "lucide-react";
import { useTheme } from "@/lib/contexts";

/* ──────────────────── Data (mock) ──────────────────── */

const STATS = [
  { value: "2",  label: "Connected agents"  },
  { value: "0",  label: "Pending connections" },
  { value: "2",  label: "Total installations" },
  { value: "12", label: "Skills enabled"     },
];

const CONNECTED = [
  {
    handle: "Ironclaw",
    wallet: "ironclaw.near",
    connectedAt: "May 12, 2025 • 2:45 PM",
    accent: "#a855f7",
    emoji: "🦾",
    status: "Active",
    lastSeen: "2 min ago",
    permissions: [
      { label: "Read data",           icon: Eye      },
      { label: "Sign transactions",   icon: Pencil   },
      { label: "Interact with contracts", icon: Coins },
    ],
    installedCount: 8,
  },
  {
    handle: "Openclaw",
    wallet: "openclaw.near",
    connectedAt: "May 10, 2025 • 11:20 AM",
    accent: "#3b82f6",
    emoji: "🎧",
    status: "Active",
    lastSeen: "5 min ago",
    permissions: [
      { label: "Read data",           icon: Eye      },
      { label: "Sign transactions",   icon: Pencil   },
      { label: "Send messages",       icon: MessageSquare },
    ],
    installedCount: 4,
  },
];

const AVAILABLE = [
  {
    handle: "Ironclaw",
    emoji: "🦾",
    accent: "#a855f7",
    desc: "An autonomous DeFi agent that executes trades, manages assets, and finds opportunities across protocols.",
    tags: ["DeFi", "Trading", "Automation"],
  },
  {
    handle: "Openclaw",
    emoji: "🎧",
    accent: "#3b82f6",
    desc: "A communication-first agent that can interact across social platforms, send messages, and engage with communities.",
    tags: ["Social", "Communication", "Engagement"],
  },
];

/* ──────────────────── Header ──────────────────── */

function PageHeader({ t }) {
  return (
    <header className="ma-header" style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 16, marginBottom: 24, flexWrap: "wrap",
    }}>
      <div style={{ minWidth: 0 }}>
        <h1 style={{
          fontSize: "clamp(24px, 2.4vw, 32px)", margin: 0,
          fontWeight: 800, color: t.white, letterSpacing: -0.4,
        }}>
          Manage your agents
        </h1>
        <p style={{ fontSize: 13, color: t.textMuted, marginTop: 6 }}>
          Connect, manage, and switch between your AI agents.
        </p>
      </div>
      <Link href="/agents/connect" style={{
        padding: "10px 16px",
        background: `linear-gradient(135deg, #a855f7, ${t.accent})`,
        border: "none", borderRadius: 10,
        fontSize: 13, fontWeight: 700, color: "#fff",
        display: "inline-flex", alignItems: "center", gap: 8,
        textDecoration: "none",
        boxShadow: `0 10px 24px rgba(168,85,247,0.35)`,
      }}>
        <Plus size={14} /> Connect new agent
      </Link>
    </header>
  );
}

/* ──────────────────── Stats strip ──────────────────── */

function StatsStrip({ t }) {
  return (
    <div className="ma-stats" style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr)) minmax(220px, 1fr)",
      gap: 14, marginBottom: 28,
    }}>
      {STATS.map(s => (
        <div key={s.label} style={{
          background: t.bgCard, border: `1px solid ${t.border}`,
          borderRadius: 12, padding: "16px 18px",
        }}>
          <div style={{
            fontSize: 28, fontWeight: 800, color: t.white, lineHeight: 1,
            fontFamily: "var(--font-jetbrains-mono), monospace",
          }}>
            {s.value}
          </div>
          <div style={{ fontSize: 12, color: t.textMuted, marginTop: 8 }}>
            {s.label}
          </div>
        </div>
      ))}
      <div style={{
        background: t.bgCard, border: `1px solid ${t.border}`,
        borderRadius: 12, padding: "16px 18px",
        display: "flex", flexDirection: "column", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.white }}>
            Need help?
          </div>
          <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4 }}>
            Learn more about agents
          </div>
        </div>
        <Link href="/docs/agents" aria-label="Open docs" style={{
          marginTop: 8, display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 30, height: 30, borderRadius: 8,
          background: t.bgSurface, border: `1px solid ${t.border}`, color: t.accent,
          textDecoration: "none", alignSelf: "flex-end",
        }}>
          <ExternalLink size={13} />
        </Link>
      </div>
    </div>
  );
}

/* ──────────────────── Connected row ──────────────────── */

function ConnectedRow({ a, t }) {
  return (
    <div className="ma-row" style={{
      display: "grid",
      gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 0.9fr) minmax(0, 1.1fr) minmax(0, 0.7fr) auto",
      gap: 18, alignItems: "center",
      padding: "18px 20px",
      background: t.bgCard, border: `1px solid ${t.border}`,
      borderRadius: 14, marginBottom: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <span aria-hidden style={{
          width: 48, height: 48, flexShrink: 0, borderRadius: 12,
          background: `linear-gradient(135deg, ${a.accent}3a, ${a.accent}14)`,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 22,
        }}>
          {a.emoji}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: t.white }}>
              {a.handle}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
              background: "rgba(16,185,129,0.18)", color: "#10b981",
              display: "inline-flex", alignItems: "center", gap: 4,
            }}>
              <CheckCircle2 size={10} /> Connected
            </span>
          </div>
          <div style={{
            fontSize: 11.5, color: t.textMuted, marginTop: 2,
            fontFamily: "var(--font-jetbrains-mono), monospace",
          }}>
            {a.wallet}
          </div>
          <div style={{ fontSize: 11, color: t.textDim, marginTop: 2 }}>
            Connected on {a.connectedAt}
          </div>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, color: t.textDim, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>
          Status
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "#10b981" }}>
          <span style={{ width: 7, height: 7, background: "#10b981", borderRadius: "50%", boxShadow: "0 0 8px #10b981" }} />
          {a.status}
        </div>
        <div style={{ fontSize: 11, color: t.textDim, marginTop: 4 }}>
          Last seen {a.lastSeen}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, color: t.textDim, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>
          Permissions
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {a.permissions.map(p => (
            <div key={p.label} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              fontSize: 12, color: t.textMuted,
            }}>
              <p.icon size={12} color={t.textDim} /> {p.label}
            </div>
          ))}
        </div>
        <Link href={`/agents/configure?handle=${a.handle.toLowerCase()}&tab=permissions`} style={{
          fontSize: 11, color: t.accent, marginTop: 6, display: "inline-block",
          textDecoration: "none",
        }}>
          View all ({a.permissions.length + 3})
        </Link>
      </div>

      <div>
        <div style={{ fontSize: 11, color: t.textDim, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>
          Installed skills
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: t.white, lineHeight: 1 }}>
          {a.installedCount}
        </div>
        <Link href={`/agents/configure?handle=${a.handle.toLowerCase()}&tab=skills`} style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          marginTop: 8, fontSize: 11, color: t.accent, textDecoration: "none", fontWeight: 600,
        }}>
          View skills <ArrowRight size={11} />
        </Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Link href={`/agents/configure?handle=${a.handle.toLowerCase()}`} style={{
          padding: "10px 16px",
          background: t.bgSurface, border: `1px solid ${t.border}`,
          borderRadius: 10, fontSize: 12, fontWeight: 700, color: t.text,
          textDecoration: "none", whiteSpace: "nowrap",
        }}>
          Configure
        </Link>
        <button type="button" aria-label="More" style={{
          width: 34, height: 34, borderRadius: 10,
          background: t.bgSurface, border: `1px solid ${t.border}`, color: t.textMuted,
          cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}>
          <MoreHorizontal size={14} />
        </button>
      </div>
    </div>
  );
}

function ConnectedSection({ t }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: t.white, margin: "0 0 12px" }}>
        Connected agents
      </h2>
      {CONNECTED.map(a => <ConnectedRow key={a.handle} a={a} t={t} />)}
    </section>
  );
}

/* ──────────────────── Available connections ──────────────────── */

function AvailableCard({ a, t }) {
  return (
    <div style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: 20, display: "flex", gap: 16, minWidth: 0,
    }}>
      <span aria-hidden style={{
        width: 56, height: 56, flexShrink: 0, borderRadius: 12,
        background: `linear-gradient(135deg, ${a.accent}3a, ${a.accent}14)`,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 26,
      }}>
        {a.emoji}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: t.white, marginBottom: 6 }}>
          {a.handle}
        </div>
        <div style={{ fontSize: 12.5, color: t.textMuted, lineHeight: 1.55, marginBottom: 10 }}>
          {a.desc}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {a.tags.map(t2 => (
            <span key={t2} style={{
              fontSize: 11, fontWeight: 600, color: t.textMuted,
              padding: "3px 10px", borderRadius: 999,
              background: t.bgSurface, border: `1px solid ${t.border}`,
            }}>
              {t2}
            </span>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button type="button" style={{
            padding: "8px 14px",
            background: `linear-gradient(135deg, #a855f7, ${a.accent})`,
            border: "none", borderRadius: 10,
            fontSize: 12, fontWeight: 700, color: "#fff", cursor: "pointer",
          }}>
            Connect
          </button>
          <Link href={`/agents/about/${a.handle.toLowerCase()}`} style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            fontSize: 12, fontWeight: 600, color: t.accent,
            textDecoration: "none",
          }}>
            Learn more <ExternalLink size={12} />
          </Link>
        </div>
      </div>
    </div>
  );
}

function AvailableSection({ t }) {
  return (
    <section style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: "20px 20px 22px", marginBottom: 22,
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 6,
      }}>
        <h2 style={{ fontSize: 15, fontWeight: 800, color: t.white, margin: 0 }}>
          Available connections
        </h2>
        <Link href="/docs/agents" style={{
          fontSize: 12, color: t.accent, fontWeight: 600, textDecoration: "none",
          display: "inline-flex", alignItems: "center", gap: 4,
        }}>
          Learn more about agents <ExternalLink size={11} />
        </Link>
      </div>
      <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 16 }}>
        Connect other AI agents to unlock more capabilities.
      </div>
      <div className="ma-available-grid" style={{
        display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: 12,
      }}>
        {AVAILABLE.map(a => <AvailableCard key={a.handle} a={a} t={t} />)}
      </div>
    </section>
  );
}

/* ──────────────────── Security banner ──────────────────── */

function SecurityBanner({ t }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "12px 18px",
      background: t.bgCard, border: `1px solid ${t.border}`,
      borderRadius: 12,
    }}>
      <Shield size={14} color={t.accent} />
      <span style={{ fontSize: 12.5, color: t.textMuted }}>
        Your security is our priority. We never take control of your agent or assets.
      </span>
      <Link href="/docs/security" style={{
        marginLeft: "auto",
        fontSize: 12, color: t.accent, fontWeight: 600, textDecoration: "none",
        display: "inline-flex", alignItems: "center", gap: 4,
      }}>
        Learn more about security <ExternalLink size={11} />
      </Link>
    </div>
  );
}

/* ──────────────────── Page ──────────────────── */

export default function ManageAgentsPage() {
  const t = useTheme();
  return (
    <>
      <PageHeader t={t} />
      <StatsStrip t={t} />
      <ConnectedSection t={t} />
      <AvailableSection t={t} />
      <SecurityBanner t={t} />

      <style jsx global>{`
        @media (max-width: 1100px) {
          .ma-row {
            grid-template-columns: 1fr 1fr !important;
            row-gap: 16px;
          }
          .ma-row > :last-child { grid-column: 1 / -1; justify-self: flex-start; }
        }
        @media (max-width: 820px) {
          .ma-stats { grid-template-columns: repeat(2, 1fr) !important; }
          .ma-available-grid { grid-template-columns: 1fr !important; }
          .ma-row { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </>
  );
}
