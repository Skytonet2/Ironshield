"use client";
import { useMemo, useState, useCallback } from "react";
import {
  Bot, Activity, TrendingUp, Wallet, Megaphone, Trophy, Handshake, GitPullRequest,
  RefreshCw, ExternalLink, ChevronDown, ChevronUp, Loader, Zap,
} from "lucide-react";
import { Section, Badge, Btn } from "./Primitives";
import { useTheme, useProposals } from "@/lib/contexts";
import { STAKING_CONTRACT } from "@/hooks/useNear";

// ── Role registry mirrors agent/ironclaw/roles.js IDs ─────────────
const ROLE_META = {
  alpha_hunt:         { label: "Alpha Hunter",      icon: TrendingUp,     color: "#22c55e", short: "Scans NEAR + AI-x-crypto for early plays." },
  treasury_manager:   { label: "Treasury Manager",  icon: Wallet,         color: "#0ea5e9", short: "Audits the IronShield treasury daily."   },
  content_engine:     { label: "Content Engine",    icon: Megaphone,      color: "#f59e0b", short: "Ships 5 community content tasks per day." },
  bounty_coordinator: { label: "Bounty Coordinator",icon: Trophy,         color: "#a855f7", short: "Proposes scoped bounties in $CLAW."      },
  deal_flow_scout:    { label: "Deal Flow Scout",   icon: Handshake,      color: "#ec4899", short: "Surfaces partnership candidates."        },
  auto_governance:    { label: "Process Auditor",   icon: GitPullRequest, color: "#94a3b8", short: "Suggests small DAO process upgrades."    },
};

const ROLE_IDS = Object.keys(ROLE_META);

// ── Helpers ───────────────────────────────────────────────────────
function safeParse(content) {
  if (!content) return null;
  if (typeof content === "object") return content;
  try { return JSON.parse(content); } catch { return null; }
}

function detectRole(parsed) {
  if (!parsed) return null;
  if (parsed.agentRole && ROLE_META[parsed.agentRole]) return parsed.agentRole;
  // Heuristic fallback so older Mission proposals still classify
  if (Array.isArray(parsed.tasks))         return "content_engine";
  if (Array.isArray(parsed.bounties))      return "bounty_coordinator";
  if (Array.isArray(parsed.candidates))    return "deal_flow_scout";
  if (Array.isArray(parsed.suggestions))   return "auto_governance";
  if (parsed.snapshot)                     return "treasury_manager";
  if (Array.isArray(parsed.items))         return "alpha_hunt";
  return null;
}

function fmtAgo(nsTimestamp) {
  if (!nsTimestamp) return "";
  const ms = Number(nsTimestamp) / 1_000_000;
  const diff = Date.now() - ms;
  if (diff < 60_000)        return "just now";
  if (diff < 3_600_000)     return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)    return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ── Cards per role ────────────────────────────────────────────────
function AlphaHuntCard({ data, t }) {
  return (
    <div>
      {(data.items || []).map((it, i) => (
        <div key={i} style={{ padding: "12px 0", borderTop: i ? `1px solid ${t.border}` : "none" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.white }}>
                {it.symbol || ""} <span style={{ color: t.textDim, fontWeight: 500 }}>· {it.chain || "?"}</span>
              </div>
              <div style={{ fontSize: 13, color: t.textMuted, marginTop: 4, lineHeight: 1.5 }}>{it.narrative}</div>
            </div>
            <Badge color={it.conviction === "high" ? "#22c55e" : it.conviction === "medium" ? "#f59e0b" : "#94a3b8"}>{it.conviction || "n/a"}</Badge>
          </div>
          {it.source && <a href={it.source} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: t.accent, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6 }}>source <ExternalLink size={11} /></a>}
        </div>
      ))}
    </div>
  );
}

function TreasuryCard({ data, t }) {
  const snap = data.snapshot || {};
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 14 }}>
        {[
          ["NEAR", snap.near], ["CLAW", snap.claw], ["Stable USD", snap.stableValueUSD],
        ].map(([k, v]) => (
          <div key={k} style={{ background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, color: t.textDim, textTransform: "uppercase", letterSpacing: 0.6 }}>{k}</div>
            <div style={{ fontSize: 14, color: t.white, fontFamily: "'JetBrains Mono', monospace", marginTop: 4 }}>{v ?? "unavailable"}</div>
          </div>
        ))}
      </div>
      {Array.isArray(data.risks) && data.risks.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: t.textDim, textTransform: "uppercase", marginBottom: 6 }}>Risks</div>
          {data.risks.map((r, i) => <div key={i} style={{ fontSize: 13, color: t.textMuted }}>· {typeof r === "string" ? r : (r.risk || JSON.stringify(r))}</div>)}
        </div>
      )}
      {Array.isArray(data.recommendations) && data.recommendations.map((r, i) => (
        <div key={i} style={{ padding: "10px 0", borderTop: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: t.white }}>{r.action}</div>
            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>{r.rationale}</div>
          </div>
          <Badge color={r.urgency === "high" ? "#ef4444" : r.urgency === "medium" ? "#f59e0b" : "#94a3b8"}>{r.urgency || "low"}</Badge>
        </div>
      ))}
    </div>
  );
}

function ContentEngineCard({ data, t }) {
  return (
    <div>
      {(data.tasks || []).map((task, i) => (
        <div key={i} style={{ padding: "14px 0", borderTop: i ? `1px solid ${t.border}` : "none" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.white }}>#{task.id || i + 1} · {task.title}</div>
            <Badge color="#f59e0b">{task.format}</Badge>
          </div>
          <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>{task.deliverable}</div>
          {task.bestWayToDeliver && <div style={{ fontSize: 12, color: t.textDim, marginTop: 6, fontStyle: "italic" }}>How: {task.bestWayToDeliver}</div>}
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: t.textDim }}>~{task.estimatedMinutes || 30}min</span>
            {(() => {
              const q = (typeof task.inspirationQuery === "string" && task.inspirationQuery.trim())
                ? task.inspirationQuery.trim()
                : (task.title || "").toString().trim();
              if (!q) return null;
              const enc = encodeURIComponent(q.slice(0, 80));
              return (
                <>
                  <a href={`https://x.com/search?q=${enc}&src=typed_query`} target="_blank" rel="noopener noreferrer"
                     style={{ fontSize: 11, color: t.accent, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3 }}>
                    Search on X <ExternalLink size={10} />
                  </a>
                  <a href={`https://www.google.com/search?q=${enc}`} target="_blank" rel="noopener noreferrer"
                     style={{ fontSize: 11, color: t.accent, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 3 }}>
                    Search on Google <ExternalLink size={10} />
                  </a>
                </>
              );
            })()}
          </div>
        </div>
      ))}
    </div>
  );
}

function BountyCard({ data, t }) {
  return (
    <div>
      {(data.bounties || []).map((b, i) => (
        <div key={i} style={{ padding: "12px 0", borderTop: i ? `1px solid ${t.border}` : "none" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.white }}>{b.title}</div>
            <Badge color="#a855f7">{b.category}</Badge>
          </div>
          <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>{b.scope}</div>
          {Array.isArray(b.acceptanceCriteria) && b.acceptanceCriteria.length > 0 && (
            <ul style={{ fontSize: 12, color: t.textDim, margin: "6px 0 0 16px", padding: 0 }}>
              {b.acceptanceCriteria.map((c, j) => <li key={j}>{c}</li>)}
            </ul>
          )}
          <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 11, color: t.textDim }}>
            <span>{b.payoutCLAW || 0} $CLAW</span>
            <span>~{b.payoutUSDEstimate || ""}</span>
            <span>{b.deadlineDays || 7}d deadline</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function DealFlowCard({ data, t }) {
  return (
    <div>
      {(data.candidates || []).map((c, i) => (
        <div key={i} style={{ padding: "12px 0", borderTop: i ? `1px solid ${t.border}` : "none" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.white }}>{c.name}</div>
              <div style={{ fontSize: 12, color: t.textDim }}>{c.category}{c.chain ? ` · ${c.chain}` : ""}</div>
            </div>
            <Badge color="#ec4899">fit {c.fitScore ?? 0}/100</Badge>
          </div>
          <div style={{ fontSize: 13, color: t.textMuted, marginTop: 6, lineHeight: 1.5 }}>{c.rationale}</div>
          {c.firstMove && <div style={{ fontSize: 12, color: t.textDim, marginTop: 4 }}>Next: <span style={{ color: t.text }}>{c.firstMove}</span></div>}
          {c.source && <a href={c.source} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: t.accent, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6 }}>source <ExternalLink size={11} /></a>}
        </div>
      ))}
    </div>
  );
}

function GovernanceCard({ data, t }) {
  return (
    <div>
      {(data.suggestions || []).map((s, i) => (
        <div key={i} style={{ padding: "12px 0", borderTop: i ? `1px solid ${t.border}` : "none" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.white }}>{s.change}</div>
            <Badge color={s.impact === "high" ? "#ef4444" : s.impact === "medium" ? "#f59e0b" : "#94a3b8"}>{s.impact || "low"}</Badge>
          </div>
          <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>{s.rationale}</div>
        </div>
      ))}
    </div>
  );
}

function ProposalBody({ roleId, data, t }) {
  switch (roleId) {
    case "alpha_hunt":         return <AlphaHuntCard data={data} t={t} />;
    case "treasury_manager":   return <TreasuryCard data={data} t={t} />;
    case "content_engine":     return <ContentEngineCard data={data} t={t} />;
    case "bounty_coordinator": return <BountyCard data={data} t={t} />;
    case "deal_flow_scout":    return <DealFlowCard data={data} t={t} />;
    case "auto_governance":    return <GovernanceCard data={data} t={t} />;
    default:                   return <pre style={{ fontSize: 12, color: t.textMuted, whiteSpace: "pre-wrap", maxHeight: 240, overflow: "auto" }}>{JSON.stringify(data, null, 2)}</pre>;
  }
}

// ── Main page ─────────────────────────────────────────────────────
export default function AgentPage({ openWallet }) {
  const t = useTheme();
  const { proposals, loading, refresh: refreshProposals } = useProposals();

  const [expanded, setExpanded]   = useState({});
  const [filter, setFilter]       = useState("all");

  // Force a refresh on user click; passive fetches are handled by ProposalsProvider.
  const refresh = useCallback(() => refreshProposals({ force: true }), [refreshProposals]);

  // Decorate proposals with parsed content + detected role
  const decorated = useMemo(() => {
    return (proposals || [])
      .map(p => {
        const parsed = safeParse(p.content);
        const roleId = detectRole(parsed);
        return { ...p, parsed, roleId };
      })
      .filter(p => p.roleId) // only IronClaw-authored Mission proposals
      .sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
  }, [proposals]);

  const filtered = useMemo(
    () => filter === "all" ? decorated : decorated.filter(p => p.roleId === filter),
    [decorated, filter]
  );

  // Per-role last-run timestamps
  const lastRunByRole = useMemo(() => {
    const out = {};
    for (const p of decorated) {
      if (!out[p.roleId]) out[p.roleId] = p.created_at;
    }
    return out;
  }, [decorated]);

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "16px 16px 60px" }}>
      {/* Header — slim line so the page has a clear entry point. */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: t.accent, fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase" }}>
          <Bot size={12} /> AI Agent
        </div>
        <h1 style={{ margin: "4px 0 4px", fontSize: 20, fontWeight: 800, color: t.white, letterSpacing: -0.2 }}>
          Manage your AI agents and automate Web3 tasks.
        </h1>
      </div>

      {/* Hero "Your AI Agents" banner — gradient card with the live
          agent count + a robot mark on the right so the page has a
          visual anchor before the role grid. */}
      <div style={{
        display: "flex", alignItems: "center", gap: 16,
        padding: "18px 20px", borderRadius: 16,
        background: "linear-gradient(135deg, rgba(168,85,247,0.16), rgba(59,130,246,0.10) 60%, transparent), var(--bg-card)",
        border: "1px solid rgba(168,85,247,0.35)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 28px 60px rgba(168,85,247,0.1)",
        marginBottom: 14,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: t.textDim, fontWeight: 600, letterSpacing: 0.4 }}>
            Your AI Agents
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
            <span style={{ fontSize: 36, fontWeight: 800, color: t.white, letterSpacing: -0.6 }}>
              {decorated.length}
            </span>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 11, color: "#10b981", fontWeight: 700, letterSpacing: 0.5,
              padding: "3px 8px", borderRadius: 999,
              background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.35)",
            }}>
              <Activity size={10} /> ACTIVE
            </span>
          </div>
          <div style={{ fontSize: 12, color: t.textMuted, marginTop: 6, lineHeight: 1.5, maxWidth: 520 }}>
            Six autonomous roles file Mission proposals on-chain. $CLAW holders vote to approve.
            Every output hash-committed to <span style={{ color: t.accent, fontFamily: "var(--font-jetbrains-mono), monospace", fontSize: 11 }}>{STAKING_CONTRACT}</span>.
          </div>
        </div>
        {/* Robot glyph — gradient tile, plus a pulsing dot to signal "agents are running". */}
        <div style={{
          position: "relative",
          width: 86, height: 86, borderRadius: 20,
          background: "linear-gradient(135deg, #a855f7, #3b82f6)",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          color: "#fff", flexShrink: 0,
          boxShadow: "0 20px 40px rgba(168,85,247,0.35)",
        }}>
          <Bot size={38} />
          <span style={{
            position: "absolute", top: 8, right: 8,
            width: 10, height: 10, borderRadius: "50%",
            background: "#10b981",
            boxShadow: "0 0 10px #10b981",
            animation: "pulse 2s infinite",
          }} />
        </div>
      </div>

      {/* Action row — refresh + create. Create New Agent is gradient
          primary; refresh is secondary outlined. */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => alert("Agent builder — coming next build.")}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "9px 14px", borderRadius: 10, border: "none",
            background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
            color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
            boxShadow: "0 10px 24px rgba(168,85,247,0.35)",
          }}
        >
          <Zap size={13} /> Create New Agent
        </button>
        <button
          type="button"
          onClick={refresh}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "9px 14px", borderRadius: 10,
            border: `1px solid ${t.border}`, background: "var(--bg-surface)",
            color: t.text, fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          {loading ? <Loader size={13} className="spin" /> : <RefreshCw size={13} />}
          Refresh
        </button>
      </div>

      {/* Role tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 36 }}>
        <button
          onClick={() => setFilter("all")}
          style={{
            background: filter === "all" ? `${t.accent}18` : t.bgCard,
            border: `1px solid ${filter === "all" ? t.accent : t.border}`,
            borderRadius: 14, padding: 16, cursor: "pointer", textAlign: "left", color: t.text,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <Zap size={18} color={t.accent} />
            <span style={{ fontSize: 14, fontWeight: 700, color: t.white }}>All roles</span>
          </div>
          <div style={{ fontSize: 12, color: t.textMuted }}>{decorated.length} agent proposals on-chain</div>
        </button>
        {ROLE_IDS.map(id => {
          const meta  = ROLE_META[id];
          const Icon  = meta.icon;
          const last  = lastRunByRole[id];
          const isOn  = filter === id;
          return (
            <button key={id} onClick={() => setFilter(id)}
              style={{
                background: isOn ? `${meta.color}18` : t.bgCard,
                border: `1px solid ${isOn ? meta.color : t.border}`,
                borderRadius: 14, padding: 16, cursor: "pointer", textAlign: "left", color: t.text,
              }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <div style={{ background: `${meta.color}22`, borderRadius: 8, padding: 6 }}><Icon size={15} color={meta.color} /></div>
                <span style={{ fontSize: 13, fontWeight: 700, color: t.white }}>{meta.label}</span>
              </div>
              <div style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.5 }}>{meta.short}</div>
              <div style={{ fontSize: 10, color: t.textDim, marginTop: 6 }}>last run: {last ? fmtAgo(last) : ""}</div>
            </button>
          );
        })}
      </div>

      {/* Feed */}
      <div>
        {loading && filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: 60, color: t.textMuted }}>
            <Loader size={20} /> Loading agent activity…
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: 60, color: t.textMuted, border: `1px dashed ${t.border}`, borderRadius: 14 }}>
            No proposals from this role yet. The agent will file one on its next tick.
          </div>
        )}
        {filtered.map(p => {
          const meta = ROLE_META[p.roleId];
          const Icon = meta.icon;
          const isOpen = !!expanded[p.id];
          return (
            <div key={p.id} style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14, padding: 18, marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, cursor: "pointer" }}
                onClick={() => setExpanded(s => ({ ...s, [p.id]: !s[p.id] }))}>
                <div style={{ display: "flex", gap: 12, flex: 1 }}>
                  <div style={{ background: `${meta.color}22`, borderRadius: 10, padding: 8, height: "fit-content" }}>
                    <Icon size={18} color={meta.color} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                      <Badge color={meta.color}>{meta.label}</Badge>
                      <span style={{ fontSize: 11, color: t.textDim }}>#{p.id} · {fmtAgo(p.created_at)}</span>
                      {p.status && <Badge color={p.status === "passed" ? "#22c55e" : p.status === "rejected" ? "#ef4444" : "#94a3b8"}>{p.status}</Badge>}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: t.white }}>{p.title}</div>
                    <div style={{ fontSize: 13, color: t.textMuted, marginTop: 4 }}>{p.description}</div>
                  </div>
                </div>
                {isOpen ? <ChevronUp size={18} color={t.textDim} /> : <ChevronDown size={18} color={t.textDim} />}
              </div>

              {isOpen && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${t.border}` }}>
                  <ProposalBody roleId={p.roleId} data={p.parsed} t={t} />
                  <div style={{ marginTop: 12, display: "flex", gap: 12, fontSize: 11, color: t.textDim }}>
                    <span>proposer: <span style={{ color: t.text, fontFamily: "'JetBrains Mono', monospace" }}>{p.proposer}</span></span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <style jsx>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.45} }
      `}</style>
    </div>
  );
}
