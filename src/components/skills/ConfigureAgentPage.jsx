"use client";
// Configure agent — /agents/[handle]/configure. Matches the mock's
// five-tab header + left/right split. Left: agent details, capabilities,
// security settings. Right: agent preview, install-skills hint, danger
// zone.
//
// All toggles/fields are uncontrolled placeholders; the functionality
// follow-up PR wires them to the contract's permission + limit methods.

import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft, Pencil, MoreHorizontal, CheckCircle2, AlertTriangle,
  Eye, MessageSquare, Coins, DollarSign, Shield, Package,
} from "lucide-react";
import { useTheme } from "@/lib/contexts";

const CAPABILITIES = [
  { key: "read",         label: "Read data",            desc: "Allows the agent to read your wallet balances, transaction history, and account info.", icon: Eye,          accent: "#a855f7", on: true  },
  { key: "sign",         label: "Sign transactions",    desc: "Allows the agent to sign and submit transactions on your behalf.",                         icon: Pencil,       accent: "#3b82f6", on: true  },
  { key: "contracts",    label: "Interact with contracts", desc: "Allows the agent to interact with smart contracts.",                                      icon: Coins,        accent: "#10b981", on: true  },
  { key: "messages",     label: "Send messages",        desc: "Allows the agent to send messages or interact in apps (e.g. social, DAO, etc).",            icon: MessageSquare, accent: "#fb923c", on: false },
  { key: "transfer",     label: "Transfer funds",       desc: "Allows the agent to transfer NEAR or tokens from your account.",                             icon: DollarSign,   accent: "#ef4444", on: false },
];

const TABS = ["Overview", "Permissions", "Installed skills", "Activity", "Advanced"];

const PREVIEW_PERMISSIONS = [
  { key: "Read data",              on: true  },
  { key: "Sign transactions",      on: true  },
  { key: "Interact with contracts", on: true },
  { key: "Send messages",          on: false },
  { key: "Transfer funds",         on: false },
];

const PREVIEW_TAGS = ["DeFi", "Trading", "Automation"];

/* ──────────────────── Header ──────────────────── */

function PageHeader({ t }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <Link href="/agents/me" style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        fontSize: 12.5, color: t.textMuted, textDecoration: "none", marginBottom: 14,
      }}>
        <ArrowLeft size={13} /> Back to manage agents
      </Link>

      <div className="cfg-header" style={{
        display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
      }}>
        <span aria-hidden style={{
          width: 52, height: 52, flexShrink: 0, borderRadius: 14,
          background: `linear-gradient(135deg, #a855f7, ${t.accent})`,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 24,
        }}>
          🦾
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{
              fontSize: "clamp(22px, 2.4vw, 30px)",
              margin: 0, fontWeight: 800, color: t.white, letterSpacing: -0.4,
            }}>
              Configure Ironclaw
            </h1>
            <span style={{
              fontSize: 10.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
              background: "rgba(16,185,129,0.2)", color: "#10b981",
              display: "inline-flex", alignItems: "center", gap: 4,
            }}>
              <CheckCircle2 size={11} /> Connected
            </span>
          </div>
          <div style={{ fontSize: 13, color: t.textMuted, marginTop: 4 }}>
            Customize your agent settings and permissions.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={{
            padding: "9px 16px",
            background: "transparent", border: `1px solid #ef444466`, color: "#ef4444",
            borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}>
            Disconnect
          </button>
          <button type="button" aria-label="More" style={{
            width: 36, height: 36, borderRadius: 10,
            background: t.bgCard, border: `1px solid ${t.border}`, color: t.textMuted,
            cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>
            <MoreHorizontal size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────── Tab bar ──────────────────── */

function TabBar({ t, active, onChange }) {
  return (
    <div style={{
      display: "flex", gap: 4, borderBottom: `1px solid ${t.border}`,
      marginBottom: 22, overflowX: "auto",
    }}>
      {TABS.map(tab => {
        const isActive = tab === active;
        return (
          <button key={tab} type="button" onClick={() => onChange(tab)} style={{
            position: "relative",
            padding: "12px 18px", fontSize: 13, fontWeight: isActive ? 700 : 600,
            background: "transparent", border: "none", cursor: "pointer",
            color: isActive ? t.white : t.textMuted,
            whiteSpace: "nowrap",
          }}>
            {tab}
            {isActive && (
              <span style={{
                position: "absolute", left: 14, right: 14, bottom: -1, height: 2,
                background: `linear-gradient(90deg, #60a5fa, #a855f7)`,
                borderRadius: 2,
              }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ──────────────────── Overview — agent details ──────────────────── */

function AgentDetails({ t }) {
  return (
    <section style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: 20, marginBottom: 20,
    }}>
      <h2 style={{ fontSize: 15, fontWeight: 800, color: t.white, margin: "0 0 14px" }}>
        Agent details
      </h2>
      <div style={{
        display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
        gap: 18, alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
          <span aria-hidden style={{
            width: 56, height: 56, flexShrink: 0, borderRadius: 14,
            background: `linear-gradient(135deg, #a855f7, ${t.accent})`,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 26,
          }}>
            🦾
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: t.white }}>
                Ironclaw
              </span>
              <button type="button" aria-label="Edit" style={{
                background: "transparent", border: "none", color: t.textDim, cursor: "pointer",
              }}>
                <Pencil size={12} />
              </button>
            </div>
            <div style={{
              fontSize: 12, color: t.textMuted, marginTop: 2,
              fontFamily: "var(--font-jetbrains-mono), monospace",
              display: "inline-flex", alignItems: "center", gap: 4,
            }}>
              ironclaw.near <CheckCircle2 size={11} color="#10b981" />
            </div>
            <div style={{ fontSize: 12, color: t.textDim, marginTop: 4 }}>
              Connected on May 12, 2025 • 2:45 PM
            </div>
          </div>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, color: t.textDim, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>
            Status
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 700, color: "#10b981" }}>
            <span style={{ width: 7, height: 7, background: "#10b981", borderRadius: "50%", boxShadow: "0 0 8px #10b981" }} />
            Active
          </div>
          <div style={{ fontSize: 12, color: t.textDim, marginTop: 4 }}>
            Last seen 2 min ago
          </div>
        </div>
      </div>
    </section>
  );
}

/* ──────────────────── Capabilities ──────────────────── */

function Toggle({ on, t }) {
  const [state, setState] = useState(on);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={state}
      onClick={() => setState(v => !v)}
      style={{
        width: 42, height: 24, borderRadius: 999,
        border: "none", cursor: "pointer",
        background: state ? `linear-gradient(90deg, #a855f7, ${t.accent})` : t.bgSurface,
        position: "relative", transition: "background 120ms ease",
      }}
    >
      <span style={{
        position: "absolute", top: 2, left: state ? 20 : 2,
        width: 20, height: 20, borderRadius: "50%",
        background: "#fff", boxShadow: "0 2px 4px rgba(0,0,0,0.3)",
        transition: "left 120ms ease",
      }} />
    </button>
  );
}

function Capabilities({ t }) {
  return (
    <section style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: 20, marginBottom: 20,
    }}>
      <h2 style={{ fontSize: 15, fontWeight: 800, color: t.white, margin: "0 0 4px" }}>
        Agent capabilities
      </h2>
      <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 16 }}>
        Control what your agent can access and do on your behalf.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {CAPABILITIES.map(c => (
          <div key={c.key} className="cfg-cap-row" style={{
            display: "flex", alignItems: "center", gap: 14,
            padding: "14px 16px",
            background: t.bgSurface, border: `1px solid ${t.border}`,
            borderRadius: 12,
          }}>
            <span aria-hidden style={{
              width: 38, height: 38, flexShrink: 0, borderRadius: 10,
              background: `${c.accent}22`,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              color: c.accent,
            }}>
              <c.icon size={16} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.white, marginBottom: 2 }}>
                {c.label}
              </div>
              <div style={{ fontSize: 11.5, color: t.textMuted, lineHeight: 1.5 }}>
                {c.desc}
              </div>
            </div>
            <Toggle on={c.on} t={t} />
          </div>
        ))}
      </div>
    </section>
  );
}

/* ──────────────────── Security settings ──────────────────── */

function SecuritySettings({ t }) {
  return (
    <section style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: 20, marginBottom: 20,
    }}>
      <h2 style={{ fontSize: 15, fontWeight: 800, color: t.white, margin: "0 0 4px" }}>
        Security settings
      </h2>
      <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 16 }}>
        Set additional limits and protection for your agent.
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 16,
        padding: "14px 16px",
        background: t.bgSurface, border: `1px solid ${t.border}`,
        borderRadius: 12, flexWrap: "wrap",
      }}>
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 700, color: t.white,
            display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 4,
          }}>
            Daily transaction limit
            <span aria-hidden title="Total NEAR the agent can transact per day" style={{
              width: 14, height: 14, borderRadius: "50%",
              background: t.bgCard, border: `1px solid ${t.border}`,
              fontSize: 9, color: t.textDim,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontWeight: 700,
            }}>?</span>
          </div>
          <div style={{ fontSize: 11.5, color: t.textMuted, lineHeight: 1.5 }}>
            The maximum total value (in NEAR) the agent can transact per day.
          </div>
        </div>
        <label style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "8px 12px",
          background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 10,
        }}>
          <input
            type="number" defaultValue={10} min={0}
            style={{
              width: 70, border: "none", background: "transparent", outline: "none",
              color: t.white, fontSize: 13, fontWeight: 700, textAlign: "right",
              fontFamily: "var(--font-jetbrains-mono), monospace",
            }}
          />
          <span style={{ fontSize: 11, color: t.textDim, fontWeight: 600 }}>NEAR</span>
        </label>
      </div>
    </section>
  );
}

/* ──────────────────── Right: agent preview ──────────────────── */

function AgentPreview({ t }) {
  return (
    <section style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: 20, marginBottom: 16,
    }}>
      <h3 style={{ fontSize: 14, fontWeight: 800, color: t.white, margin: "0 0 4px" }}>
        Agent preview
      </h3>
      <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 14 }}>
        See how Ironclaw appears and what it can do.
      </div>
      <div style={{
        display: "flex", alignItems: "center", gap: 12, marginBottom: 14,
        padding: "12px 14px",
        background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 12,
      }}>
        <span aria-hidden style={{
          width: 40, height: 40, flexShrink: 0, borderRadius: 10,
          background: `linear-gradient(135deg, #a855f7, ${t.accent})`,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 20,
        }}>🦾</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: t.white }}>Ironclaw</span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
              background: "rgba(16,185,129,0.2)", color: "#10b981",
              display: "inline-flex", alignItems: "center", gap: 3,
            }}>
              <CheckCircle2 size={9} /> Connected
            </span>
          </div>
          <div style={{
            fontSize: 11, color: t.textMuted, marginTop: 2,
            fontFamily: "var(--font-jetbrains-mono), monospace",
            display: "inline-flex", alignItems: "center", gap: 3,
          }}>
            ironclaw.near <CheckCircle2 size={10} color="#10b981" />
          </div>
        </div>
      </div>

      <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.55, marginBottom: 12 }}>
        An autonomous DeFi agent that executes trades, manages assets, and finds opportunities across protocols.
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
        {PREVIEW_TAGS.map(t2 => (
          <span key={t2} style={{
            fontSize: 11, fontWeight: 600, color: t.textMuted,
            padding: "3px 10px", borderRadius: 999,
            background: t.bgSurface, border: `1px solid ${t.border}`,
          }}>
            {t2}
          </span>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {PREVIEW_PERMISSIONS.map(p => (
          <div key={p.key} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            fontSize: 12, color: t.textMuted,
          }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {p.on ? <CheckCircle2 size={12} color="#10b981" /> : <span style={{ width: 12, height: 12, display: "inline-block", borderRadius: "50%", border: `1px solid ${t.border}` }} />}
              {p.key}
            </span>
            <span style={{
              fontSize: 11, fontWeight: 700,
              color: p.on ? "#10b981" : t.textDim,
            }}>
              {p.on ? "Enabled" : "Disabled"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function InstallSkillsBanner({ t }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10,
      padding: "14px 16px",
      background: `linear-gradient(135deg, ${t.accent}14, rgba(168,85,247,0.10))`,
      border: `1px solid ${t.border}`, borderRadius: 12,
      marginBottom: 16,
    }}>
      <Package size={14} color={t.accent} style={{ marginTop: 2 }} />
      <div style={{ fontSize: 12.5, color: t.textMuted }}>
        You can install skills for this agent in the{" "}
        <Link href="?tab=skills" style={{ color: t.accent, fontWeight: 700, textDecoration: "none" }}>
          Installed skills
        </Link>{" "}tab.
      </div>
    </div>
  );
}

function DangerZone({ t }) {
  return (
    <section style={{
      padding: 20, borderRadius: 14,
      background: "rgba(239,68,68,0.06)", border: `1px solid rgba(239,68,68,0.22)`,
    }}>
      <h3 style={{ fontSize: 14, fontWeight: 800, color: "#ef4444", margin: "0 0 8px" }}>
        Danger zone
      </h3>
      <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 14, lineHeight: 1.55 }}>
        Disconnecting will revoke all permissions and stop the agent from accessing your account.
      </div>
      <button type="button" style={{
        width: "100%", padding: "11px 18px",
        background: "#ef4444", border: "none", borderRadius: 10,
        fontSize: 13, fontWeight: 800, color: "#fff", cursor: "pointer",
        boxShadow: `0 8px 22px rgba(239,68,68,0.35)`,
      }}>
        Disconnect agent
      </button>
    </section>
  );
}

/* ──────────────────── Page ──────────────────── */

export default function ConfigureAgentPage() {
  const t = useTheme();
  const [tab, setTab] = useState(TABS[0]);

  return (
    <>
      <PageHeader t={t} />
      <TabBar t={t} active={tab} onChange={setTab} />

      <div className="cfg-grid" style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 340px",
        gap: 22, alignItems: "flex-start",
      }}>
        <div style={{ minWidth: 0 }}>
          <AgentDetails t={t} />
          <Capabilities t={t} />
          <SecuritySettings t={t} />
        </div>
        <aside style={{ minWidth: 0, position: "sticky", top: 76 }}>
          <AgentPreview t={t} />
          <InstallSkillsBanner t={t} />
          <DangerZone t={t} />
        </aside>
      </div>

      <style jsx global>{`
        @media (max-width: 1100px) {
          .cfg-grid { grid-template-columns: 1fr !important; }
          .cfg-grid > aside { position: static !important; }
        }
        @media (max-width: 640px) {
          .cfg-cap-row { flex-wrap: wrap; }
        }
      `}</style>
    </>
  );
}
