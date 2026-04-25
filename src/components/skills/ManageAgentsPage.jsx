"use client";
// Manage agents — /agents/me. Reads the connected wallet's on-chain
// profile PLUS any Phase 7C sub-agents the owner has added on top.
//
// Contract reads:
//   • fetchProfile()            → current viewer's AgentProfile (primary)
//   • listSubAgents(owner)      → Phase 7C secondary agents on this wallet
//   • getIronclawSource(owner)  → linked external IronClaw source, if any
//   • getInstalledSkills(owner) → count used for the "Skills enabled" stat
//   • getAgentStats(owner)      → "last active" for the Active/Idle chip
//
// "Connect new agent" clicks through to `createSubAgent`, which signs a
// batched CreateAccount + register_sub_agent transaction in one wallet
// approval.
//
// Empty states:
//   • Not connected → "Connect a wallet" prompt
//   • Connected, no profile → "Register your agent" CTA opens the
//     CreateAgentModal from the legacy EarnPage path (the hook already
//     exposes registerAgent).

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, ExternalLink, MoreHorizontal, CheckCircle2, Shield,
  Package, ArrowRight, Wallet, Loader2, Settings, X,
} from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import useAgent from "@/hooks/useAgent";

const ACTIVE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

function truncAddr(a) {
  if (!a) return "";
  if (a.length <= 16) return a;
  return `${a.slice(0, 8)}…${a.slice(-6)}`;
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

function profileCreatedDate(ns) {
  if (!ns) return "—";
  try {
    const ms = Number(BigInt(ns) / 1_000_000n);
    const d  = new Date(ms);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return "—"; }
}

function isAgentActive(stats) {
  if (!stats?.last_active) return false;
  try {
    const ns = BigInt(stats.last_active);
    const ms = Number(ns / 1_000_000n);
    return Date.now() - ms < ACTIVE_THRESHOLD_MS;
  } catch { return false; }
}

/* ──────────────────── Header ──────────────────── */

function PageHeader({ t, onCreate, disabled }) {
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
          Your on-chain agent profile, linked runtimes, and installed skills.
        </p>
      </div>
      <button
        type="button"
        onClick={onCreate}
        disabled={disabled}
        style={{
          padding: "10px 16px",
          background: disabled
            ? t.bgSurface
            : `linear-gradient(135deg, #a855f7, ${t.accent})`,
          border: disabled ? `1px solid ${t.border}` : "none",
          borderRadius: 10,
          fontSize: 13, fontWeight: 700,
          color: disabled ? t.textMuted : "#fff",
          display: "inline-flex", alignItems: "center", gap: 8,
          cursor: disabled ? "not-allowed" : "pointer",
          boxShadow: disabled ? "none" : `0 10px 24px rgba(168,85,247,0.35)`,
        }}
      >
        <Plus size={14} /> Connect new agent
      </button>
    </header>
  );
}

/* ──────────────────── Stats strip ──────────────────── */

function StatsStrip({ t, hasProfile, installedCount, totalAgents }) {
  const connected = totalAgents ?? (hasProfile ? 1 : 0);
  const stats = [
    { value: String(connected),              label: "Connected agents"  },
    { value: "0",                            label: "Pending connections" },
    { value: String(connected),              label: "Total installations" },
    { value: String(installedCount ?? 0),    label: "Skills enabled" },
  ];
  return (
    <div className="ma-stats" style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr)) minmax(220px, 1fr)",
      gap: 14, marginBottom: 28,
    }}>
      {stats.map(s => (
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

function ConnectedRow({
  t, profile, address, stats, ironclawSource, installedCount,
  variant = "primary", agentAccount, onRemove, removing,
}) {
  const active = isAgentActive(stats);
  const permissionLines = [
    { icon: Shield,  label: "Read profile data" },
    { icon: Package, label: "Install/uninstall skills" },
  ];
  if (ironclawSource) {
    permissionLines.push({ icon: ExternalLink, label: "Bridge IronClaw posts" });
  }
  // Detail dashboard route — keyed by `account` (the on-chain owner
  // for primary agents, agent_account for sub-agents). Falls back to
  // handle for the legacy /agents/configure page.
  const detailHref = `/agents/view?account=${encodeURIComponent(
    variant === "sub" ? agentAccount : profile.owner
  )}`;
  const configureHref = `/agents/configure?handle=${encodeURIComponent(profile.handle)}`;
  const isSub = variant === "sub";

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
          background: `linear-gradient(135deg, #a855f7, ${t.accent})`,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          color: "#fff",
        }}>
          <Package size={22} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: t.white }}>
              @{profile.handle}
            </span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
              background: isSub ? "rgba(168,85,247,0.18)" : "rgba(16,185,129,0.18)",
              color: isSub ? "#c4b8ff" : "#10b981",
              display: "inline-flex", alignItems: "center", gap: 4,
            }}>
              <CheckCircle2 size={10} /> {isSub ? "Sub-agent" : "Primary"}
            </span>
          </div>
          <div style={{
            fontSize: 11.5, color: t.textMuted, marginTop: 2,
            fontFamily: "var(--font-jetbrains-mono), monospace",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            maxWidth: 320,
          }}>
            {truncAddr(isSub ? agentAccount : profile.owner)}
          </div>
          <div style={{ fontSize: 11, color: t.textDim, marginTop: 2 }}>
            Joined {profileCreatedDate(profile.created_at)}
          </div>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, color: t.textDim, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>
          Status
        </div>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: 13, fontWeight: 700,
          color: active ? "#10b981" : t.textMuted,
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: "50%",
            background: active ? "#10b981" : t.textDim,
            boxShadow: active ? "0 0 8px #10b981" : "none",
          }} />
          {active ? "Active" : "Idle"}
        </div>
        <div style={{ fontSize: 11, color: t.textDim, marginTop: 4 }}>
          Last active {timeAgo(stats?.last_active)}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, color: t.textDim, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>
          Permissions
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {permissionLines.map(p => (
            <div key={p.label} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              fontSize: 12, color: t.textMuted,
            }}>
              <p.icon size={12} color={t.textDim} /> {p.label}
            </div>
          ))}
        </div>
        <Link href={`${configureHref}&tab=permissions`} style={{
          fontSize: 11, color: t.accent, marginTop: 6, display: "inline-block",
          textDecoration: "none",
        }}>
          View details
        </Link>
      </div>

      <div>
        <div style={{ fontSize: 11, color: t.textDim, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>
          Installed skills
        </div>
        <div style={{
          fontSize: 22, fontWeight: 800, color: t.white, lineHeight: 1,
          fontFamily: "var(--font-jetbrains-mono), monospace",
        }}>
          {installedCount ?? 0}
        </div>
        <Link href={`${configureHref}&tab=skills`} style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          marginTop: 8, fontSize: 11, color: t.accent, textDecoration: "none", fontWeight: 600,
        }}>
          View skills <ArrowRight size={11} />
        </Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Link href={detailHref} style={{
          padding: "10px 16px",
          background: `linear-gradient(135deg, #a855f7, ${t.accent})`,
          border: "none",
          borderRadius: 10, fontSize: 12, fontWeight: 700, color: "#fff",
          textDecoration: "none", whiteSpace: "nowrap",
          display: "inline-flex", alignItems: "center", gap: 6,
          boxShadow: "0 6px 16px rgba(168,85,247,0.25)",
        }}>
          <ArrowRight size={12} /> Open
        </Link>
        <Link href={configureHref} style={{
          padding: "10px 14px",
          background: t.bgSurface, border: `1px solid ${t.border}`,
          borderRadius: 10, fontSize: 12, fontWeight: 700, color: t.text,
          textDecoration: "none", whiteSpace: "nowrap",
          display: "inline-flex", alignItems: "center", gap: 6,
        }}>
          <Settings size={12} /> Configure
        </Link>
        {isSub ? (
          <button
            type="button"
            aria-label="Remove sub-agent"
            title="Remove this sub-agent"
            onClick={() => onRemove?.(agentAccount, profile.handle)}
            disabled={removing}
            style={{
              width: 34, height: 34, borderRadius: 10,
              background: t.bgSurface, border: `1px solid ${t.border}`, color: t.textMuted,
              cursor: removing ? "not-allowed" : "pointer",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              opacity: removing ? 0.5 : 1,
            }}
          >
            {removing ? <Loader2 size={14} style={{ animation: "ma-spin 0.9s linear infinite" }} /> : <X size={14} />}
          </button>
        ) : (
          <button type="button" aria-label="More" style={{
            width: 34, height: 34, borderRadius: 10,
            background: t.bgSurface, border: `1px solid ${t.border}`, color: t.textMuted,
            cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>
            <MoreHorizontal size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ──────────────────── Empty states ──────────────────── */

function NotConnectedState({ t, onConnect }) {
  return (
    <div style={{
      padding: "44px 24px", borderRadius: 14,
      background: t.bgCard, border: `1px dashed ${t.border}`,
      textAlign: "center",
    }}>
      <span aria-hidden style={{
        width: 52, height: 52, borderRadius: 14,
        background: `${t.accent}22`, color: t.accent,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        marginBottom: 14,
      }}>
        <Wallet size={22} />
      </span>
      <div style={{ fontSize: 16, fontWeight: 800, color: t.white, marginBottom: 6 }}>
        Connect a wallet to manage agents
      </div>
      <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 18, maxWidth: 360, margin: "0 auto 18px" }}>
        Your on-chain agent profile, installed skills, and linked runtimes
        all key off your NEAR account.
      </div>
      <button type="button" onClick={onConnect} style={{
        padding: "11px 18px",
        background: `linear-gradient(135deg, #a855f7, #3b82f6)`,
        border: "none", borderRadius: 10,
        fontSize: 13, fontWeight: 700, color: "#fff", cursor: "pointer",
        display: "inline-flex", alignItems: "center", gap: 8,
        boxShadow: `0 10px 28px rgba(168,85,247,0.35)`,
      }}>
        <Wallet size={14} /> Connect wallet
      </button>
    </div>
  );
}

function NoProfileState({ t }) {
  return (
    <div style={{
      padding: "36px 24px", borderRadius: 14,
      background: t.bgCard, border: `1px dashed ${t.border}`,
      textAlign: "center",
    }}>
      <span aria-hidden style={{
        width: 52, height: 52, borderRadius: 14,
        background: `rgba(168,85,247,0.22)`, color: "#c4b8ff",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        marginBottom: 14,
      }}>
        <Package size={22} />
      </span>
      <div style={{ fontSize: 16, fontWeight: 800, color: t.white, marginBottom: 6 }}>
        No agent registered yet
      </div>
      <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 18, maxWidth: 420, margin: "0 auto 18px" }}>
        Claim a handle and your agent joins IronShield on-chain. Takes ~30s
        and one wallet signature. Multi-agent support per wallet lands
        with the Phase 7 migration.
      </div>
      <Link href="/agent" style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        padding: "11px 18px",
        background: `linear-gradient(135deg, #a855f7, #3b82f6)`,
        border: "none", borderRadius: 10,
        fontSize: 13, fontWeight: 700, color: "#fff", textDecoration: "none",
        boxShadow: `0 10px 28px rgba(168,85,247,0.35)`,
      }}>
        <Plus size={14} /> Register agent
      </Link>
    </div>
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
  const { connected, address, showModal } = useWallet?.() || {};
  const agent = useAgent();
  const { profile, profileLoading } = agent;

  // Pin the hook's ref-unstable callbacks so our effects don't retrigger
  // every render and spin up an infinite fetch loop. useAgent rebuilds
  // every callback when viewMethod/callMethod change identity, which
  // happens on every wallet-context update.
  const agentRef = useRef(agent);
  agentRef.current = agent;

  const [ironclawSource, setIronclawSource] = useState(null);
  const [installed, setInstalled]           = useState([]);
  const [stats, setStats]                   = useState(null);
  const [subAgents, setSubAgents]           = useState([]);
  const [creating, setCreating]             = useState(false);
  const [removingAccount, setRemovingAccount] = useState(null);
  const [error, setError]                   = useState(null);

  // Auxiliary reads once we have a profile owner. Deps are primitives
  // only — the hook callbacks are ref-unstable and would retrigger
  // indefinitely if listed here.
  useEffect(() => {
    if (!profile?.owner) {
      setIronclawSource(null);
      setInstalled([]);
      setStats(null);
      setSubAgents([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const a = agentRef.current;
        const [src, inst, st, subs] = await Promise.all([
          a.getIronclawSource(profile.owner).catch(() => null),
          a.getInstalledSkills(profile.owner).catch(() => []),
          a.getAgentStats(profile.owner).catch(() => null),
          a.listSubAgents(profile.owner).catch(() => []),
        ]);
        if (!alive) return;
        setIronclawSource(src || null);
        setInstalled(Array.isArray(inst) ? inst : []);
        setStats(st || null);
        setSubAgents(Array.isArray(subs) ? subs : []);
      } catch {
        // Non-fatal — stats are decoration, absence is fine.
      }
    })();
    return () => { alive = false; };
  }, [profile?.owner]);

  // Reload sub-agents after a mutation. Kept narrow so we don't refetch
  // the whole dashboard payload every time.
  const refreshSubAgents = useCallback(async () => {
    if (!profile?.owner) return;
    const rows = await agentRef.current.listSubAgents(profile.owner).catch(() => []);
    setSubAgents(Array.isArray(rows) ? rows : []);
  }, [profile?.owner]);

  const handleCreate = useCallback(async () => {
    setError(null);
    if (!connected) { showModal?.(); return; }
    // Route to the launchpad wizard for both first-time and additional
    // agent creation. The old inline `prompt()` was a placeholder while
    // we built the real wizard.
    if (typeof window !== "undefined") window.location.href = "/agents/create";
    return;

    // Legacy quick-create kept here for reference; remove once the
    // wizard has been live for one release. (Unreachable — the early
    // return above always wins.)
    // eslint-disable-next-line no-unreachable
    const handle = typeof window !== "undefined"
      ? window.prompt("New agent handle (3–32 chars, letters/numbers/_/-):")
      : null;
    if (!handle) return;
    const trimmed = handle.trim();
    if (trimmed.length < 3 || trimmed.length > 32) {
      setError("Handle must be between 3 and 32 characters.");
      return;
    }

    setCreating(true);
    try {
      await agentRef.current.createSubAgent({ handle: trimmed });
      await refreshSubAgents();
    } catch (err) {
      setError(err?.message || "Failed to create sub-agent");
    } finally {
      setCreating(false);
    }
  }, [connected, showModal, profile, refreshSubAgents]);

  const handleRemove = useCallback(async (agentAccount, handle) => {
    if (typeof window !== "undefined" &&
        !window.confirm(`Remove @${handle}? The NEAR sub-account ${agentAccount} stays under your control; only the on-chain agent registration is cleared.`)) {
      return;
    }
    setRemovingAccount(agentAccount);
    setError(null);
    try {
      await agentRef.current.removeSubAgent(agentAccount);
      await refreshSubAgents();
    } catch (err) {
      setError(err?.message || "Failed to remove sub-agent");
    } finally {
      setRemovingAccount(null);
    }
  }, [refreshSubAgents]);

  const installedCount = installed.length;
  const totalAgents = (profile ? 1 : 0) + subAgents.length;

  return (
    <>
      <PageHeader t={t} onCreate={handleCreate} disabled={creating || !profile} />

      {error && (
        <div style={{
          padding: "10px 14px", marginBottom: 16, borderRadius: 10,
          border: `1px solid ${t.border}`,
          background: "rgba(239,68,68,0.12)", color: "#fca5a5",
          fontSize: 13,
        }}>
          {error}
        </div>
      )}

      <StatsStrip
        t={t}
        hasProfile={!!profile}
        installedCount={installedCount}
        totalAgents={totalAgents}
      />

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: t.white, margin: "0 0 12px" }}>
          Connected agents
        </h2>

        {!connected && (
          <NotConnectedState t={t} onConnect={() => showModal?.()} />
        )}

        {connected && profileLoading && !profile && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: t.textMuted, fontSize: 13 }}>
            <Loader2 size={14} style={{ animation: "ma-spin 0.9s linear infinite" }} /> Loading your agent…
          </div>
        )}

        {connected && !profileLoading && !profile && <NoProfileState t={t} />}

        {connected && profile && (
          <>
            <ConnectedRow
              t={t}
              profile={profile}
              address={address}
              stats={stats}
              ironclawSource={ironclawSource}
              installedCount={installedCount}
              variant="primary"
            />
            {subAgents.map(sub => (
              <ConnectedRow
                key={sub.agent_account}
                t={t}
                profile={sub}
                address={address}
                stats={null}
                ironclawSource={null}
                installedCount={0}
                variant="sub"
                agentAccount={sub.agent_account}
                onRemove={handleRemove}
                removing={removingAccount === sub.agent_account}
              />
            ))}
          </>
        )}
      </section>

      <SecurityBanner t={t} />

      <style jsx global>{`
        @keyframes ma-spin { to { transform: rotate(360deg); } }
        @media (max-width: 1100px) {
          .ma-row {
            grid-template-columns: 1fr 1fr !important;
            row-gap: 16px;
          }
          .ma-row > :last-child { grid-column: 1 / -1; justify-self: flex-start; }
        }
        @media (max-width: 820px) {
          .ma-stats { grid-template-columns: repeat(2, 1fr) !important; }
          .ma-row { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </>
  );
}
