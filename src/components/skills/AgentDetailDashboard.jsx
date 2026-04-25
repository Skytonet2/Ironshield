"use client";
// AgentDetailDashboard — /agents/view?account=<agent_account>
//
// The control plane for one agent. Reads on-chain identity, stats,
// installed skills, and the framework connection from the backend.
// Sandbox chat dispatches through whichever framework the user
// selected at launch — IronShield doesn't host the runtime.
//
// Layout matches the design pass:
//   • Header: identity + 4 status pills (deployment / platforms /
//     skills / health) + actions
//   • Left  : sandbox chat
//   • Mid   : installed skills grid
//   • Right : platform connections list
//   • Bottom-left : automation rules (placeholder, "Coming soon")
//   • Bottom-mid  : recent activity (from AgentStats.activity_log)
//   • Bottom-right: performance overview (weekly bar chart)

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot, Pause, Play, Settings, Copy, Check, ExternalLink, Plus,
  Activity, Loader2, Send, Package, Zap, Sparkles, ShieldCheck,
} from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import useAgent from "@/hooks/useAgent";
import useAgentConnections from "@/hooks/useAgentConnections";
import AutomationRulesPanel from "@/components/skills/AutomationRulesPanel";
import AgentAvatar from "@/components/agents/AgentAvatar";

/** Pull the avatar reference out of a connection row's `meta` blob.
 *  meta is stored as JSON on-chain (a string field) and as an
 *  object in the backend response — we accept either shape. */
function avatarFromConn(conn) {
  if (!conn?.meta) return null;
  let m = conn.meta;
  if (typeof m === "string") {
    try { m = JSON.parse(m); } catch { return null; }
  }
  return m?.avatar_url || null;
}

const FRAMEWORK_LABEL = {
  openclaw:    "OpenClaw",
  ironclaw:    "IronClaw",
  self_hosted: "Self-hosted",
};

function shortAccount(a) {
  if (!a) return "";
  if (a.length <= 24) return a;
  return `${a.slice(0, 12)}…${a.slice(-8)}`;
}

function timeAgo(nsStr) {
  if (!nsStr) return "—";
  try {
    const ms = Number(BigInt(nsStr) / 1_000_000n);
    const diff = Date.now() - ms;
    if (diff < 60_000)   return "just now";
    if (diff < 3_600_000)  return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  } catch { return "—"; }
}

/* ─────────────── Status pills ─────────────── */

function StatusPill({ t, icon: Icon, label, value, accent }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "12px 16px",
      background: t.bgCard, border: `1px solid ${t.border}`,
      borderRadius: 12, minWidth: 0,
    }}>
      <span style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: `${accent}1a`, color: accent,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}><Icon size={16} /></span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, color: t.textMuted, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600 }}>
          {label}
        </div>
        <div style={{ fontSize: 14, color: t.white, fontWeight: 700, marginTop: 2 }}>{value}</div>
      </div>
    </div>
  );
}

/* ─────────────── Header ─────────────── */

function HeaderBlock({ t, profile, account, primaryConn, skillsCount, onPause, paused }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(account);
      setCopied(true); setTimeout(() => setCopied(false), 1200);
    } catch {}
  };
  const live = primaryConn?.status === "active";
  return (
    <header style={{
      background: t.bgCard, border: `1px solid ${t.border}`,
      borderRadius: 16, padding: "20px 22px", marginBottom: 18,
      display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 18, alignItems: "center",
    }} className="ix-agent-header">
      <AgentAvatar value={avatarFromConn(primaryConn)} size={64} />



      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: t.white, letterSpacing: -0.4 }}>
            {profile?.handle ? `@${profile.handle}` : shortAccount(account)}
          </h1>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
            background: live ? "rgba(16,185,129,0.18)" : "rgba(245,158,11,0.18)",
            color: live ? "#10b981" : "#f59e0b",
            display: "inline-flex", alignItems: "center", gap: 4,
          }}>
            {live ? <><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 6px #10b981" }} /> Live</>
                  : <><Pause size={10} /> Sandbox</>}
          </span>
          {primaryConn && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
              background: t.bgSurface, border: `1px solid ${t.border}`, color: t.textMuted,
            }}>
              {FRAMEWORK_LABEL[primaryConn.framework] || primaryConn.framework}
            </span>
          )}
        </div>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: t.textMuted, maxWidth: 600 }}>
          {profile?.bio || "No description set yet — edit it from the agent settings."}
        </p>
        <div style={{
          display: "flex", alignItems: "center", gap: 8, marginTop: 10,
          fontSize: 11.5, color: t.textDim, fontFamily: "var(--font-jetbrains-mono), monospace",
        }}>
          <span>{shortAccount(account)}</span>
          <button type="button" onClick={copy} aria-label="Copy account" style={{
            width: 22, height: 22, borderRadius: 6, background: "transparent",
            border: `1px solid ${t.border}`, color: t.textMuted,
            display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          }}>{copied ? <Check size={11} /> : <Copy size={11} />}</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexShrink: 0 }} className="ix-agent-actions">
        <button type="button" onClick={onPause} style={{
          padding: "9px 14px", background: t.bgSurface, border: `1px solid ${t.border}`,
          borderRadius: 10, fontSize: 12, fontWeight: 700, color: t.text,
          display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
        }}>
          {paused ? <><Play size={12} /> Resume</> : <><Pause size={12} /> Pause</>}
        </button>
        <Link href={`/agents/configure?handle=${encodeURIComponent(profile?.handle || "")}`} style={{
          padding: "9px 14px",
          background: `linear-gradient(135deg, #a855f7, ${t.accent})`,
          border: "none", borderRadius: 10, fontSize: 12, fontWeight: 700, color: "#fff",
          display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none",
        }}><Settings size={12} /> Settings</Link>
      </div>
    </header>
  );
}

/* ─────────────── Sandbox chat ─────────────── */

function SandboxChat({ t, account, primaryConn, onSend }) {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const send = async () => {
    if (!input.trim() || busy) return;
    if (!primaryConn) {
      setError("Connect a framework before testing your agent.");
      return;
    }
    const text = input.trim();
    setMsgs(m => [...m, { role: "user", content: text, t: Date.now() }]);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const res = await onSend(text);
      setMsgs(m => [...m, {
        role: "assistant",
        content: res?.reply || "(empty reply)",
        t: Date.now(),
      }]);
    } catch (e) {
      setError(e?.message || "Sandbox call failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={cardStyle(t)}>
      <SectionTitle t={t} icon={Sparkles} title="Test your agent" />
      <p style={{ margin: "0 0 12px", fontSize: 12.5, color: t.textMuted }}>
        Single-turn round-trip through {primaryConn ? FRAMEWORK_LABEL[primaryConn.framework] : "the connected framework"}.
      </p>

      <div style={{
        height: 200, overflowY: "auto", padding: 12, marginBottom: 10,
        background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 10,
      }}>
        {msgs.length === 0 && (
          <div style={{ color: t.textDim, fontSize: 12, textAlign: "center", paddingTop: 70 }}>
            Type a message below to ping your agent.
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{
            display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start",
            marginBottom: 8,
          }}>
            <div style={{
              maxWidth: "82%", padding: "8px 12px", borderRadius: 10, fontSize: 12.5,
              background: m.role === "user" ? `${t.accent}22` : t.bgCard,
              color: m.role === "user" ? t.white : t.text,
              border: `1px solid ${t.border}`,
              whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>
              {m.content}
            </div>
          </div>
        ))}
        {busy && (
          <div style={{ display: "flex", gap: 6, color: t.textMuted, fontSize: 12 }}>
            <Loader2 size={12} style={{ animation: "ma-spin 0.9s linear infinite" }} /> waiting on agent…
          </div>
        )}
      </div>

      {error && (
        <div style={{
          padding: "8px 10px", marginBottom: 10, fontSize: 12,
          background: "rgba(239,68,68,0.12)", color: "#fca5a5", borderRadius: 8,
        }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)}
               onKeyDown={e => { if (e.key === "Enter") send(); }}
               placeholder="Ask your agent…"
               style={{
                 flex: 1, padding: "10px 12px",
                 background: t.bgSurface, border: `1px solid ${t.border}`,
                 borderRadius: 10, color: t.white, fontSize: 13, outline: "none",
               }} />
        <button type="button" onClick={send} disabled={busy || !input.trim() || !primaryConn}
                style={{
                  padding: "10px 14px",
                  background: (busy || !primaryConn) ? t.bgSurface : `linear-gradient(135deg, #a855f7, ${t.accent})`,
                  border: (busy || !primaryConn) ? `1px solid ${t.border}` : "none",
                  borderRadius: 10, color: (busy || !primaryConn) ? t.textMuted : "#fff",
                  fontSize: 12, fontWeight: 700, cursor: busy || !primaryConn ? "not-allowed" : "pointer",
                }}>
          <Send size={13} />
        </button>
      </div>
    </section>
  );
}

/* ─────────────── Skills grid ─────────────── */

function SkillsBlock({ t, installed }) {
  return (
    <section style={cardStyle(t)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <SectionTitle t={t} icon={Package} title="Installed skills" />
        <Link href="/skills/mine" style={{ color: t.accent, fontSize: 12, fontWeight: 600, textDecoration: "none" }}>
          View all
        </Link>
      </div>

      {(!installed || installed.length === 0) ? (
        <div style={{ color: t.textMuted, fontSize: 13, padding: "24px 0", textAlign: "center" }}>
          No skills installed yet. <Link href="/skills" style={{ color: t.accent, textDecoration: "none", fontWeight: 600 }}>Browse the marketplace</Link>.
        </div>
      ) : (
        <div style={{
          display: "grid", gap: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        }}>
          {installed.slice(0, 8).map(s => (
            <div key={s.id} style={{
              padding: "12px 14px",
              background: t.bgSurface, border: `1px solid ${t.border}`,
              borderRadius: 10,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Package size={14} color={t.accent} />
                <span style={{ fontSize: 12, fontWeight: 700, color: t.white, lineHeight: 1.2 }}>
                  {s.name}
                </span>
              </div>
              <div style={{ fontSize: 11, color: t.textDim, fontFamily: "var(--font-jetbrains-mono), monospace" }}>
                v{s.version || "1"}
              </div>
              <div style={{
                fontSize: 10.5, fontWeight: 700, color: "#10b981",
                marginTop: 4, display: "inline-flex", alignItems: "center", gap: 3,
              }}>
                <Check size={10} /> Active
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <Link href="/skills" style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          padding: "10px",
          background: t.bgSurface, border: `1px dashed ${t.border}`,
          borderRadius: 10, fontSize: 12, fontWeight: 700, color: t.textMuted,
          textDecoration: "none",
        }}>
          <Plus size={12} /> Install more skills
        </Link>
      </div>
    </section>
  );
}

/* ─────────────── Platform connections ─────────────── */

function ConnectionsBlock({ t, connections, onTest, testing }) {
  return (
    <section style={cardStyle(t)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <SectionTitle t={t} icon={ShieldCheck} title="Platform connections" />
      </div>

      {(!connections || connections.length === 0) ? (
        <div style={{ color: t.textMuted, fontSize: 13, padding: "24px 0", textAlign: "center" }}>
          No frameworks connected yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {connections.map(c => (
            <div key={`${c.framework}:${c.id}`} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 12px",
              background: t.bgSurface, border: `1px solid ${t.border}`,
              borderRadius: 10,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.white }}>
                  {FRAMEWORK_LABEL[c.framework] || c.framework}
                </div>
                <div style={{ fontSize: 11, color: t.textMuted, fontFamily: "var(--font-jetbrains-mono), monospace" }}>
                  {c.external_id || c.endpoint || "—"}
                </div>
              </div>
              <span style={{
                fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 999,
                background: c.status === "active" ? "rgba(16,185,129,0.18)" : "rgba(245,158,11,0.18)",
                color: c.status === "active" ? "#10b981" : "#f59e0b",
              }}>{c.status}</span>
              <button type="button" onClick={() => onTest(c)} disabled={testing === c.framework}
                      style={{
                        padding: "6px 10px", fontSize: 11, fontWeight: 700,
                        background: t.bgCard, border: `1px solid ${t.border}`,
                        borderRadius: 8, color: t.textMuted, cursor: "pointer",
                        display: "inline-flex", alignItems: "center", gap: 4,
                      }}>
                {testing === c.framework
                  ? <Loader2 size={11} style={{ animation: "ma-spin 0.9s linear infinite" }} />
                  : <Activity size={11} />} Test
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ─────────────── Activity log ─────────────── */

function ActivityBlock({ t, activity }) {
  return (
    <section style={cardStyle(t)}>
      <SectionTitle t={t} icon={Activity} title="Recent activity" />
      {(!activity || activity.length === 0) ? (
        <div style={{ color: t.textMuted, fontSize: 13, padding: "16px 0", textAlign: "center" }}>
          No activity recorded on-chain yet.
        </div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", marginTop: 8 }}>
          {activity.slice(0, 6).map((a, i) => (
            <li key={i} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 0", borderBottom: i < activity.length - 1 ? `1px solid ${t.border}` : "none",
            }}>
              <Zap size={12} color={t.accent} style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: t.white, fontWeight: 600 }}>{a.kind?.replace(/_/g, " ")}</div>
                <div style={{ fontSize: 11.5, color: t.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.description || "—"}
                </div>
              </div>
              <div style={{ fontSize: 11, color: t.textDim, flexShrink: 0 }}>{timeAgo(a.timestamp)}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ─────────────── Performance overview ─────────────── */

function PerformanceBlock({ t, stats }) {
  const snaps = Array.isArray(stats?.weekly_snapshots) ? stats.weekly_snapshots : [];
  const max = Math.max(1, ...snaps.map(n => Number(n) || 0));
  return (
    <section style={cardStyle(t)}>
      <SectionTitle t={t} icon={Sparkles} title="Performance" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8, marginBottom: 14 }}>
        <Stat t={t} label="This week"     value={String(stats?.points_this_week ?? "—")} />
        <Stat t={t} label="Last week"     value={String(stats?.points_last_week ?? "—")} />
        <Stat t={t} label="Submissions ✓" value={String(stats?.submissions_approved ?? 0)} />
        <Stat t={t} label="Missions"      value={String(stats?.missions_completed ?? 0)} />
      </div>

      <div style={{ fontSize: 11, color: t.textDim, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>
        Last {snaps.length || 7} weeks
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 64 }}>
        {(snaps.length ? snaps : Array(7).fill(0)).map((n, i) => {
          const h = max > 0 ? (Number(n) / max) * 64 : 0;
          return (
            <div key={i} style={{
              flex: 1,
              height: Math.max(2, h),
              background: `linear-gradient(180deg, ${t.accent}, #a855f7)`,
              borderRadius: 4,
              opacity: snaps.length ? 1 : 0.25,
            }} />
          );
        })}
      </div>
      {!snaps.length && (
        <div style={{ fontSize: 11, color: t.textDim, marginTop: 8, textAlign: "center" }}>
          Performance data appears once your agent has on-chain activity.
        </div>
      )}
    </section>
  );
}

function Stat({ t, label, value }) {
  return (
    <div style={{
      padding: "10px 12px",
      background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8,
    }}>
      <div style={{ fontSize: 10, color: t.textDim, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 18, color: t.white, fontWeight: 800, marginTop: 2, fontFamily: "var(--font-jetbrains-mono), monospace" }}>{value}</div>
    </div>
  );
}

/* ─────────────── Helpers ─────────────── */

const cardStyle = (t) => ({
  background: t.bgCard, border: `1px solid ${t.border}`,
  borderRadius: 14, padding: 18,
});

const SectionTitle = ({ t, icon: Icon, title }) => (
  <h2 style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 6px", fontSize: 14, fontWeight: 800, color: t.white }}>
    <Icon size={14} color={t.accent} /> {title}
  </h2>
);

/* ─────────────── Page ─────────────── */

export default function AgentDetailDashboard({ account: accountProp }) {
  const t = useTheme();
  const { connected, address, showModal } = useWallet?.() || {};
  const agent = useAgent();
  const agentRef = useRef(agent);
  agentRef.current = agent;

  // Resolve target account from prop or query string. Default: viewer's
  // own primary account.
  const account = useMemo(() => {
    if (accountProp) return accountProp;
    if (typeof window === "undefined") return null;
    const sp = new URLSearchParams(window.location.search);
    return sp.get("account") || sp.get("handle") || address || null;
  }, [accountProp, address]);

  const conn = useAgentConnections({ agentAccount: account });

  const [profile, setProfile]   = useState(null);
  const [stats, setStats]       = useState(null);
  const [installed, setInstalled] = useState([]);
  const [paused, setPaused]     = useState(false);
  const [testingFw, setTestingFw] = useState(null);

  // Load on-chain data for the target account.
  useEffect(() => {
    if (!account) return;
    let alive = true;
    (async () => {
      const a = agentRef.current;
      // Prefer get_agent (primary). Fall back to scanning sub-agents.
      const [primary, st, inst] = await Promise.all([
        a.fetchProfile?.().catch(() => null),
        a.getAgentStats?.(account).catch(() => null),
        a.getInstalledSkills?.(account).catch(() => []),
      ]);
      if (!alive) return;
      setProfile(primary || { owner: account, handle: "", bio: "" });
      setStats(st || null);
      setInstalled(Array.isArray(inst) ? inst : []);
    })();
    return () => { alive = false; };
  }, [account]);

  const primaryConn = conn.connections[0] || null;

  const sandboxSend = useCallback(async (message) => {
    if (!primaryConn) throw new Error("No framework connected.");
    return conn.sandbox({
      agent_account: account,
      framework:     primaryConn.framework,
      message,
    });
  }, [primaryConn, conn, account]);

  const testConnection = useCallback(async (c) => {
    setTestingFw(c.framework);
    try {
      const res = await conn.validate({
        framework:   c.framework,
        external_id: c.external_id,
        endpoint:    c.endpoint,
        // No auth here — we only have the encrypted blob in the DB.
        // The backend store fills it in from the persisted row.
      });
      // For MVP, surface result via alert. A toast system is cleaner; later.
      alert(res.ok ? `Connected — ${res.info?.name || "agent reachable"}` : `Failed: ${res.error}`);
    } finally {
      setTestingFw(null);
    }
  }, [conn]);

  if (!connected) {
    return (
      <div style={{ padding: 44, borderRadius: 14, textAlign: "center",
                    background: t.bgCard, border: `1px dashed ${t.border}` }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: t.white, marginBottom: 8 }}>
          Connect a wallet to view your agent
        </div>
        <button type="button" onClick={() => showModal?.()} style={{
          padding: "10px 18px", marginTop: 12, background: `linear-gradient(135deg, #a855f7, ${t.accent})`,
          border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, color: "#fff", cursor: "pointer",
        }}>Connect wallet</button>
      </div>
    );
  }
  if (!account) {
    return <div style={{ padding: 24, color: t.textMuted, fontSize: 13 }}>No agent specified.</div>;
  }

  return (
    <>
      <HeaderBlock
        t={t}
        profile={profile}
        account={account}
        primaryConn={primaryConn}
        skillsCount={installed.length}
        paused={paused}
        onPause={() => setPaused(p => !p)}
      />

      <div style={{
        display: "grid", gap: 18, marginBottom: 18,
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
      }} className="ix-agent-pills">
        <StatusPill t={t} icon={ShieldCheck}
          label="Deployment"
          value={primaryConn?.status === "active" ? "Live" : "Sandbox"}
          accent={primaryConn?.status === "active" ? "#10b981" : "#f59e0b"} />
        <StatusPill t={t} icon={Activity}
          label="Frameworks"
          value={`${conn.connections.length} connected`}
          accent={t.accent} />
        <StatusPill t={t} icon={Package}
          label="Skills"
          value={`${installed.length} installed`}
          accent="#a855f7" />
        <StatusPill t={t} icon={Sparkles}
          label="Health"
          value={primaryConn?.status === "active" ? "Excellent" : "Pending"}
          accent={primaryConn?.status === "active" ? "#10b981" : "#f59e0b"} />
      </div>

      <div style={{
        display: "grid", gap: 18, marginBottom: 18,
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      }} className="ix-agent-grid-3">
        <SandboxChat t={t} account={account} primaryConn={primaryConn} onSend={sandboxSend} />
        <SkillsBlock t={t} installed={installed} />
        <ConnectionsBlock t={t} connections={conn.connections} onTest={testConnection} testing={testingFw} />
      </div>

      <div style={{
        display: "grid", gap: 18,
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
      }} className="ix-agent-grid-3">
        <AutomationRulesPanel t={t} agentAccount={account} />

        <ActivityBlock t={t} activity={stats?.activity_log || []} />

        <PerformanceBlock t={t} stats={stats} />
      </div>

      <style jsx global>{`
        @keyframes ma-spin { to { transform: rotate(360deg); } }
        @media (max-width: 1100px) {
          .ix-agent-grid-3 { grid-template-columns: 1fr 1fr !important; }
          .ix-agent-pills  { grid-template-columns: 1fr 1fr !important; }
          .ix-agent-header { grid-template-columns: auto 1fr !important; }
          .ix-agent-actions { grid-column: 1 / -1; justify-content: flex-end; margin-top: 8px; }
        }
        @media (max-width: 720px) {
          .ix-agent-grid-3 { grid-template-columns: 1fr !important; }
          .ix-agent-pills  { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </>
  );
}
