"use client";
// Configure agent — /agents/configure?handle=<handle>.
//
// Reads from the ironshield.near contract:
//   • get_agent_by_handle(handle) → AgentProfile  (primary fetch)
//   • get_ironclaw_source(owner)  → linked external IronClaw agent, if any
//   • get_installed_skills(owner) → feeds the "Installed skills" tab
//
// Writes:
//   • unlink_from_ironclaw() — disconnects a linked external IronClaw
//     agent. Contract cannot delete the on-chain AgentProfile itself, so
//     the Disconnect button's scope is limited to unlinking the external
//     source. Full profile deletion lands with the Phase 7 migration.
//
// What used to be here:
//   • 5-switch capability matrix (Read data / Sign tx / Interact / Send
//     messages / Transfer funds). No on-chain permission model today,
//     so the section was showing fake state — dropped until Phase 7.
//   • Daily transaction limit input. Same reason, dropped.
//
// Tabs:
//   • Overview     — Agent details + Linked IronClaw source + Agent stats
//   • Permissions  — Phase 7 placeholder
//   • Installed skills — list of skills installed by this owner, with Uninstall
//   • Activity     — Phase 4 agent_activity ring buffer, newest first
//   • Advanced     — Link/unlink external IronClaw source + delete placeholder

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft, Pencil, MoreHorizontal, CheckCircle2, AlertTriangle,
  Shield, Package, ExternalLink, Loader2, Info, Trash2, Activity as ActivityIcon,
} from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import useAgent from "@/hooks/useAgent";

const TABS = ["Overview", "Permissions", "Installed skills", "Activity", "Advanced"];

const YOCTO_PER_NEAR = 1_000_000_000_000_000_000_000_000n;
function yoctoToNearStr(y) {
  try {
    const b = BigInt(y || "0");
    if (b === 0n) return "0";
    const whole = b / YOCTO_PER_NEAR;
    const frac  = Number(b % YOCTO_PER_NEAR) / 1e24;
    const combined = Number(whole) + frac;
    return combined.toFixed(3).replace(/\.?0+$/, "");
  } catch { return "—"; }
}

function timeAgo(nsStr) {
  if (!nsStr) return "never";
  try {
    const ns = BigInt(nsStr);
    const ms = Number(ns / 1_000_000n);
    const diff = Date.now() - ms;
    if (diff < 60_000)      return "just now";
    if (diff < 3_600_000)   return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000)  return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  } catch { return "—"; }
}

function truncAddr(a) {
  if (!a) return "";
  if (a.length <= 16) return a;
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
}

/* ──────────────────── Header ──────────────────── */

function PageHeader({ t, profile, handle, onUnlink, unlinkBusy, isOwner, isLinkedIronclaw }) {
  const title = profile?.handle ? `Configure ${profile.handle}` : `Configure ${handle || "agent"}`;
  const connected = !!profile;
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
          color: "#fff",
        }}>
          <Package size={22} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{
              fontSize: "clamp(22px, 2.4vw, 30px)",
              margin: 0, fontWeight: 800, color: t.white, letterSpacing: -0.4,
            }}>
              {title}
            </h1>
            {connected ? (
              <span style={{
                fontSize: 10.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                background: "rgba(16,185,129,0.2)", color: "#10b981",
                display: "inline-flex", alignItems: "center", gap: 4,
              }}>
                <CheckCircle2 size={11} /> Registered
              </span>
            ) : (
              <span style={{
                fontSize: 10.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                background: `${t.textDim}22`, color: t.textMuted,
                display: "inline-flex", alignItems: "center", gap: 4,
              }}>
                Not found
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: t.textMuted, marginTop: 4 }}>
            {connected
              ? "View on-chain details and manage linked runtimes."
              : "No agent registered under that handle yet."}
          </div>
        </div>

        {isOwner && isLinkedIronclaw && (
          <button
            type="button"
            onClick={onUnlink}
            disabled={unlinkBusy}
            style={{
              padding: "9px 16px",
              background: "transparent", border: `1px solid #ef444466`, color: "#ef4444",
              borderRadius: 10, fontSize: 12, fontWeight: 700,
              cursor: unlinkBusy ? "progress" : "pointer",
              opacity: unlinkBusy ? 0.7 : 1,
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
          >
            {unlinkBusy ? <Loader2 size={12} style={{ animation: "cfg-spin 0.9s linear infinite" }} /> : null}
            Unlink IronClaw
          </button>
        )}
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

/* ──────────────────── Cards ──────────────────── */

function Card({ t, children, style }) {
  return (
    <section style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: 20, marginBottom: 20,
      ...style,
    }}>
      {children}
    </section>
  );
}

function AgentDetails({ t, profile, ironclawSource }) {
  return (
    <Card t={t}>
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
            color: "#fff",
          }}>
            <Package size={22} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: t.white }}>
              @{profile.handle}
            </div>
            <div style={{
              fontSize: 12, color: t.textMuted, marginTop: 2,
              fontFamily: "var(--font-jetbrains-mono), monospace",
              display: "inline-flex", alignItems: "center", gap: 4,
            }}>
              Owner: {truncAddr(profile.owner)}
            </div>
            {profile.agent_account && (
              <div style={{
                fontSize: 11, color: t.textDim, marginTop: 2,
                fontFamily: "var(--font-jetbrains-mono), monospace",
              }}>
                Sub-wallet: {profile.agent_account}
              </div>
            )}
            {profile.bio && (
              <div style={{ fontSize: 12.5, color: t.textMuted, marginTop: 8, lineHeight: 1.5, maxWidth: 520 }}>
                {profile.bio}
              </div>
            )}
          </div>
        </div>

        <div style={{ minWidth: 0, display: "grid", gap: 12 }}>
          <Stat t={t} label="Points" value={String(profile.points ?? 0)} />
          <Stat t={t} label="Reputation" value={String(profile.reputation ?? 0)} />
          <Stat t={t} label="Joined" value={timeAgo(profile.created_at)} muted />
        </div>
      </div>

      {ironclawSource && (
        <div style={{
          marginTop: 18, padding: "12px 14px",
          background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 10,
          display: "flex", alignItems: "center", gap: 10,
          fontSize: 12.5, color: t.textMuted,
        }}>
          <ExternalLink size={13} color={t.accent} />
          Linked to external IronClaw agent:{" "}
          <span style={{
            color: t.white, fontFamily: "var(--font-jetbrains-mono), monospace",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            flex: 1, minWidth: 0,
          }}>
            {ironclawSource}
          </span>
        </div>
      )}
    </Card>
  );
}

function Stat({ t, label, value, muted }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: t.textDim, textTransform: "uppercase", letterSpacing: 0.6 }}>
        {label}
      </div>
      <div style={{
        fontSize: 15, fontWeight: 700,
        color: muted ? t.textMuted : t.white,
        fontFamily: "var(--font-jetbrains-mono), monospace",
        marginTop: 2,
      }}>
        {value}
      </div>
    </div>
  );
}

/* ──────────────────── Tab bodies ──────────────────── */

function OverviewTab({ t, profile, ironclawSource, stats }) {
  return (
    <>
      <AgentDetails t={t} profile={profile} ironclawSource={ironclawSource} />

      {stats && (
        <Card t={t}>
          <h2 style={{ fontSize: 15, fontWeight: 800, color: t.white, margin: "0 0 14px" }}>
            Activity snapshot
          </h2>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 14,
          }}>
            <Stat t={t} label="Points this week" value={String(stats.points_this_week ?? 0)} />
            <Stat t={t} label="Missions" value={String(stats.missions_completed ?? 0)} />
            <Stat t={t} label="Approved" value={String(stats.submissions_approved ?? 0)} />
            <Stat t={t} label="Rejected" value={String(stats.submissions_rejected ?? 0)} />
            <Stat t={t} label="Last active" value={timeAgo(stats.last_active)} muted />
          </div>
        </Card>
      )}
    </>
  );
}

function PermissionsTab({ t }) {
  return (
    <Card t={t}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <Info size={14} color={t.accent} />
        <h2 style={{ fontSize: 15, fontWeight: 800, color: t.white, margin: 0 }}>
          Permissions
        </h2>
      </div>
      <div style={{ fontSize: 12.5, color: t.textMuted, lineHeight: 1.6 }}>
        Per-capability controls (read data, sign transactions, interact with
        contracts, send messages, transfer funds) land with the Phase 7
        contract migration. For now every registered agent operates with
        the contract's default permission set, which is scoped to its
        sub-wallet via a function-call access key — it cannot transfer
        NEAR out of the owner's wallet.
      </div>
    </Card>
  );
}

function InstalledSkillsTab({ t, skills, loading, isOwner, onUninstall, busyId }) {
  if (loading) {
    return (
      <Card t={t}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: t.textMuted }}>
          <Loader2 size={14} style={{ animation: "cfg-spin 0.9s linear infinite" }} />
          Loading installed skills…
        </div>
      </Card>
    );
  }
  if (!skills.length) {
    return (
      <Card t={t}>
        <div style={{ fontSize: 13, color: t.textMuted, textAlign: "center", padding: "18px 0" }}>
          No skills installed yet.{" "}
          <Link href="/skills" style={{ color: t.accent, fontWeight: 700, textDecoration: "none" }}>
            Browse the marketplace
          </Link>.
        </div>
      </Card>
    );
  }
  return (
    <Card t={t} style={{ padding: 0 }}>
      {skills.map((s, i) => (
        <div
          key={s.id}
          style={{
            display: "flex", alignItems: "center", gap: 14,
            padding: "16px 20px",
            borderTop: i === 0 ? "none" : `1px solid ${t.border}`,
          }}
        >
          <span aria-hidden style={{
            width: 36, height: 36, flexShrink: 0, borderRadius: 10,
            background: `rgba(168,85,247,0.18)`, color: "#c4b8ff",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>
            <Package size={16} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Link href={`/skills/${s.id}`} style={{
              fontSize: 13, fontWeight: 700, color: t.white, textDecoration: "none",
            }}>
              {s.name}
            </Link>
            <div style={{
              fontSize: 11.5, color: t.textMuted, marginTop: 2, lineHeight: 1.4,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 520,
            }}>
              {s.description || "—"}
            </div>
            <div style={{ fontSize: 11, color: t.textDim, marginTop: 3, fontFamily: "var(--font-jetbrains-mono), monospace" }}>
              by {truncAddr(s.author)}
            </div>
          </div>
          {isOwner && (
            <button
              type="button"
              onClick={() => onUninstall(s.id)}
              disabled={busyId === s.id}
              style={{
                padding: "8px 14px",
                background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 10,
                fontSize: 12, fontWeight: 700, color: t.textMuted, cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 6,
                opacity: busyId === s.id ? 0.6 : 1,
              }}
            >
              {busyId === s.id
                ? <Loader2 size={12} style={{ animation: "cfg-spin 0.9s linear infinite" }} />
                : <Trash2 size={12} />}
              Uninstall
            </button>
          )}
        </div>
      ))}
    </Card>
  );
}

function ActivityTab({ t, activity, loading }) {
  if (loading) {
    return (
      <Card t={t}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: t.textMuted }}>
          <Loader2 size={14} style={{ animation: "cfg-spin 0.9s linear infinite" }} />
          Loading activity…
        </div>
      </Card>
    );
  }
  if (!activity.length) {
    return (
      <Card t={t}>
        <div style={{ fontSize: 13, color: t.textMuted, textAlign: "center", padding: "18px 0" }}>
          No on-chain activity yet.
        </div>
      </Card>
    );
  }
  return (
    <Card t={t} style={{ padding: 0 }}>
      {activity.map((a, i) => (
        <div
          key={`${a.timestamp}-${i}`}
          style={{
            display: "flex", alignItems: "flex-start", gap: 12,
            padding: "14px 20px",
            borderTop: i === 0 ? "none" : `1px solid ${t.border}`,
          }}
        >
          <span aria-hidden style={{
            width: 32, height: 32, flexShrink: 0, borderRadius: 10,
            background: `${t.accent}22`, color: t.accent,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>
            <ActivityIcon size={14} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: t.white, textTransform: "capitalize" }}>
              {String(a.kind || "activity").replace(/_/g, " ")}
              {a.amount != null && Number(a.amount) > 0 && (
                <span style={{ marginLeft: 8, color: t.accent }}>
                  +{String(a.amount)} pts
                </span>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 2, lineHeight: 1.5 }}>
              {a.description || ""}
            </div>
          </div>
          <div style={{ fontSize: 11, color: t.textDim, whiteSpace: "nowrap" }}>
            {timeAgo(a.timestamp)}
          </div>
        </div>
      ))}
    </Card>
  );
}

function AdvancedTab({ t, profile, ironclawSource, isOwner, onUnlink, unlinkBusy }) {
  return (
    <>
      <Card t={t}>
        <h2 style={{ fontSize: 15, fontWeight: 800, color: t.white, margin: "0 0 6px" }}>
          External IronClaw source
        </h2>
        <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 14 }}>
          Link an existing IronClaw agent so posts + tasks are forwarded both ways
          by the off-chain bridge relay.
        </div>
        {ironclawSource ? (
          <div style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "12px 14px",
            background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 10,
          }}>
            <ExternalLink size={14} color={t.accent} />
            <span style={{
              flex: 1, minWidth: 0,
              fontSize: 13, color: t.white,
              fontFamily: "var(--font-jetbrains-mono), monospace",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {ironclawSource}
            </span>
            {isOwner && (
              <button
                type="button"
                onClick={onUnlink}
                disabled={unlinkBusy}
                style={{
                  padding: "7px 12px",
                  background: "transparent",
                  border: `1px solid #ef444466`, color: "#ef4444",
                  borderRadius: 8, fontSize: 11.5, fontWeight: 700,
                  cursor: unlinkBusy ? "progress" : "pointer",
                  opacity: unlinkBusy ? 0.7 : 1,
                }}
              >
                {unlinkBusy ? "Unlinking…" : "Unlink"}
              </button>
            )}
          </div>
        ) : (
          <div style={{
            padding: "14px 16px", borderRadius: 10,
            background: t.bgSurface, border: `1px dashed ${t.border}`,
            fontSize: 12.5, color: t.textMuted,
          }}>
            No external IronClaw agent linked. Owners can link one from
            the agent dashboard.
          </div>
        )}
      </Card>

      <Card t={t} style={{ borderColor: "rgba(239,68,68,0.25)", background: "rgba(239,68,68,0.04)" }}>
        <h2 style={{ fontSize: 15, fontWeight: 800, color: "#ef4444", margin: "0 0 6px" }}>
          Danger zone
        </h2>
        <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 14, lineHeight: 1.55 }}>
          Deleting an on-chain agent profile isn't supported yet. It lands
          with the Phase 7 migration, together with full permission revocation.
        </div>
        <button type="button" disabled style={{
          width: "100%", padding: "11px 18px",
          background: "rgba(239,68,68,0.12)", border: `1px solid rgba(239,68,68,0.35)`,
          borderRadius: 10,
          fontSize: 13, fontWeight: 800, color: "#fca5a5",
          cursor: "not-allowed",
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          <AlertTriangle size={13} /> Delete agent (Phase 7)
        </button>
      </Card>
    </>
  );
}

/* ──────────────────── Right rail ──────────────────── */

function AgentPreview({ t, profile, ironclawSource, installedCount }) {
  return (
    <section style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: 20, marginBottom: 16,
    }}>
      <h3 style={{ fontSize: 14, fontWeight: 800, color: t.white, margin: "0 0 4px" }}>
        Agent preview
      </h3>
      <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 14 }}>
        How @{profile.handle} appears to others.
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
          color: "#fff",
        }}>
          <Package size={18} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: t.white }}>@{profile.handle}</div>
          <div style={{
            fontSize: 11, color: t.textMuted, marginTop: 2,
            fontFamily: "var(--font-jetbrains-mono), monospace",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {truncAddr(profile.owner)}
          </div>
        </div>
      </div>

      {profile.bio && (
        <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.55, marginBottom: 12 }}>
          {profile.bio}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Row t={t} label="Points"           value={String(profile.points ?? 0)} />
        <Row t={t} label="Reputation"       value={String(profile.reputation ?? 0)} />
        <Row t={t} label="Installed skills" value={String(installedCount ?? 0)} />
        <Row
          t={t}
          label="External IronClaw"
          value={ironclawSource ? "Linked" : "None"}
          accent={ironclawSource ? "#10b981" : t.textDim}
        />
      </div>
    </section>
  );
}

function Row({ t, label, value, accent }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: t.textMuted }}>
      <span>{label}</span>
      <span style={{
        fontSize: 12, fontWeight: 700,
        color: accent || t.white,
        fontFamily: "var(--font-jetbrains-mono), monospace",
      }}>
        {value}
      </span>
    </div>
  );
}

function InstallSkillsBanner({ t, onGoTab }) {
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
        Manage what @{"{"}handle{"}"} can do in the{" "}
        <button
          type="button"
          onClick={() => onGoTab("Installed skills")}
          style={{
            background: "transparent", border: "none", padding: 0,
            color: t.accent, fontWeight: 700, cursor: "pointer",
          }}
        >
          Installed skills
        </button>{" "}tab.
      </div>
    </div>
  );
}

/* ──────────────────── Page ──────────────────── */

export default function ConfigureAgentPage() {
  const t = useTheme();
  const params = useSearchParams();
  const handle = (params?.get("handle") || "").toLowerCase();
  const initialTab = params?.get("tab");

  const { address } = useWallet?.() || {};
  const agent = useAgent();

  // Pin callbacks via a ref so useEffect deps stay stable. useAgent
  // returns fresh function identities on every render (viewMethod +
  // callMethod do the same), which otherwise retriggers our fetches
  // in an infinite loop.
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const uninstallSkill     = agent.uninstallSkill;
  const unlinkFromIronclaw = agent.unlinkFromIronclaw;

  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const [activity, setActivity] = useState([]);
  const [stats, setStats]       = useState(null);
  const [installed, setInstalled] = useState([]);
  const [installedLoading, setInstalledLoading] = useState(true);
  const [ironclawSource, setIronclawSource] = useState(null);

  const [tab, setTab] = useState(() => {
    const map = {
      overview: "Overview", permissions: "Permissions",
      skills: "Installed skills", activity: "Activity", advanced: "Advanced",
    };
    return map[String(initialTab || "").toLowerCase()] || TABS[0];
  });

  const [unlinkBusy, setUnlinkBusy] = useState(false);
  const [uninstallBusy, setUninstallBusy] = useState(null);

  const isOwner = !!(profile && address && profile.owner === address);

  // Load profile whenever the handle changes. Deliberately omits the
  // useAgent callbacks from deps — they get new identities each render
  // (viewMethod/callMethod are unstable) and caused an infinite fetch
  // loop. We grab the current ref each run instead.
  useEffect(() => {
    if (!handle) return;
    let alive = true;
    setLoading(true);
    setNotFound(false);
    setLoadError(null);
    (async () => {
      try {
        const p = await agentRef.current.getAgentByHandle(handle);
        if (!alive) return;
        if (!p) {
          setProfile(null);
          setNotFound(true);
        } else {
          setProfile(p);
        }
      } catch (e) {
        if (!alive) return;
        setLoadError(e?.message || "Failed to load agent");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [handle]);

  // Secondary fetches run once we have the profile. Same rationale as
  // above — deps are primitives only.
  useEffect(() => {
    if (!profile?.owner) return;
    let alive = true;
    (async () => {
      try {
        const a = agentRef.current;
        const [acts, st, inst, src] = await Promise.all([
          a.getAgentActivity(profile.owner, 20).catch(() => []),
          a.getAgentStats(profile.owner).catch(() => null),
          a.getInstalledSkills(profile.owner).catch(() => []),
          a.getIronclawSource(profile.owner).catch(() => null),
        ]);
        if (!alive) return;
        setActivity(Array.isArray(acts) ? acts : []);
        setStats(st || null);
        setInstalled(Array.isArray(inst) ? inst : []);
        setIronclawSource(src || null);
      } finally {
        if (alive) setInstalledLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [profile?.owner]);

  const handleUnlink = useCallback(async () => {
    if (!isOwner || !ironclawSource) return;
    if (typeof window !== "undefined" && !window.confirm("Unlink the external IronClaw source?")) return;
    setUnlinkBusy(true);
    try {
      await unlinkFromIronclaw();
      setIronclawSource(null);
    } catch (e) {
      alert(e?.message || "Unlink failed");
    } finally {
      setUnlinkBusy(false);
    }
  }, [isOwner, ironclawSource, unlinkFromIronclaw]);

  const handleUninstall = useCallback(async (skillId) => {
    if (!isOwner) return;
    setUninstallBusy(skillId);
    try {
      await uninstallSkill(skillId);
      setInstalled(list => list.filter(s => s.id !== skillId));
    } catch (e) {
      alert(e?.message || "Uninstall failed");
    } finally {
      setUninstallBusy(null);
    }
  }, [isOwner, uninstallSkill]);

  // Render
  if (!handle) {
    return (
      <div style={{ padding: "40px 24px", textAlign: "center", color: t.textMuted, fontSize: 13 }}>
        Missing <code>?handle=</code> parameter.{" "}
        <Link href="/agents/me" style={{ color: t.accent, fontWeight: 700 }}>Back to manage agents</Link>.
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, color: t.textMuted, fontSize: 13, padding: "40px 0" }}>
        <Loader2 size={14} style={{ animation: "cfg-spin 0.9s linear infinite" }} /> Loading @{handle}…
        <style jsx global>{`@keyframes cfg-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div style={{ maxWidth: 520, margin: "60px auto", textAlign: "center" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: t.white, marginBottom: 8 }}>
          No agent at @{handle}
        </h1>
        <p style={{ fontSize: 13, color: t.textMuted, marginBottom: 18 }}>
          {loadError
            ? `Couldn't load the profile: ${loadError}`
            : "This handle isn't registered on ironshield.near."}
        </p>
        <Link href="/agents/me" style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "10px 16px",
          background: `linear-gradient(135deg, #a855f7, #3b82f6)`,
          borderRadius: 10, fontSize: 13, fontWeight: 700, color: "#fff",
          textDecoration: "none",
        }}>
          <ArrowLeft size={13} /> Back to manage agents
        </Link>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        t={t}
        profile={profile}
        handle={handle}
        onUnlink={handleUnlink}
        unlinkBusy={unlinkBusy}
        isOwner={isOwner}
        isLinkedIronclaw={!!ironclawSource}
      />
      <TabBar t={t} active={tab} onChange={setTab} />

      <div className="cfg-grid" style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 340px",
        gap: 22, alignItems: "flex-start",
      }}>
        <div style={{ minWidth: 0 }}>
          {tab === "Overview" && (
            <OverviewTab t={t} profile={profile} ironclawSource={ironclawSource} stats={stats} />
          )}
          {tab === "Permissions" && <PermissionsTab t={t} />}
          {tab === "Installed skills" && (
            <InstalledSkillsTab
              t={t}
              skills={installed}
              loading={installedLoading}
              isOwner={isOwner}
              onUninstall={handleUninstall}
              busyId={uninstallBusy}
            />
          )}
          {tab === "Activity" && (
            <ActivityTab t={t} activity={activity} loading={installedLoading /* shares fetch */} />
          )}
          {tab === "Advanced" && (
            <AdvancedTab
              t={t}
              profile={profile}
              ironclawSource={ironclawSource}
              isOwner={isOwner}
              onUnlink={handleUnlink}
              unlinkBusy={unlinkBusy}
            />
          )}
        </div>
        <aside style={{ minWidth: 0, position: "sticky", top: 76 }}>
          <AgentPreview t={t} profile={profile} ironclawSource={ironclawSource} installedCount={installed.length} />
          <InstallSkillsBanner t={t} onGoTab={setTab} />
        </aside>
      </div>

      <style jsx global>{`
        @keyframes cfg-spin { to { transform: rotate(360deg); } }
        @media (max-width: 1100px) {
          .cfg-grid { grid-template-columns: 1fr !important; }
          .cfg-grid > aside { position: static !important; }
        }
      `}</style>
    </>
  );
}
