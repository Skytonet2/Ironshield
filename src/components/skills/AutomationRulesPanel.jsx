"use client";
// AutomationRulesPanel — embedded inside AgentDetailDashboard. Lists
// automation rules attached to one agent and exposes a small modal
// for creating new ones. Keeps the schema flexible (trigger and
// action are JSON blobs) so adding new types later doesn't need a
// data migration.
//
// Trigger types in this MVP:
//   • schedule — cron expression, fired by the in-process worker
//   • webhook  — fires on POST /api/agents/automations/:id/webhook
//
// Action types:
//   • ask_agent   — sends a prompt to the connected framework
//   • webhook_out — POSTs to a URL the user supplies

import { useCallback, useMemo, useState } from "react";
import {
  Zap, Play, Plus, Loader2, X, Clock, Webhook, Bot, Trash2, Power, Package,
  ChevronDown, ChevronRight, RefreshCw, Check, AlertCircle,
} from "lucide-react";
import useAutomations from "@/hooks/useAutomations";
import useAutomationRuns from "@/hooks/useAutomationRuns";
import useSkillRegistry from "@/hooks/useSkillRegistry";

const PRESETS = [
  {
    label: "Hourly: ask my agent for new airdrops",
    name:  "Hourly airdrop scan",
    trigger: { type: "schedule", cron: "0 * * * *" },
    action:  { type: "ask_agent", prompt: "Scan supported chains for new airdrop opportunities and summarise the top 3." },
  },
  {
    label: "Daily 9am UTC: morning briefing",
    name:  "Morning briefing",
    trigger: { type: "schedule", cron: "0 9 * * *" },
    action:  { type: "ask_agent", prompt: "Give me a 3-bullet briefing on what's happening across the projects I follow." },
  },
  {
    label: "Webhook: relay incoming alerts",
    name:  "Inbound alert relay",
    trigger: { type: "webhook" },
    action:  { type: "ask_agent", prompt: "Summarise this alert and decide if it needs my attention." },
  },
];

function timeAgo(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000)  return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function TriggerLabel({ trigger }) {
  if (trigger?.type === "schedule") return <><Clock size={11} /> {trigger.cron}</>;
  if (trigger?.type === "webhook")  return <><Webhook size={11} /> webhook</>;
  return <>—</>;
}

function ActionLabel({ action }) {
  if (action?.type === "ask_agent")   return <><Bot size={11} /> ask agent</>;
  if (action?.type === "webhook_out") return <><Webhook size={11} /> webhook out</>;
  if (action?.type === "call_skill")  return <><Package size={11} /> {action.skill_key || "skill"}</>;
  return <>—</>;
}

/* ─────────────── Create modal ─────────────── */

function CreateRuleModal({ t, agentAccount, onClose, onCreated }) {
  const { create } = useAutomations({ agentAccount });
  const { skills: registry } = useSkillRegistry();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState("schedule");
  const [cron, setCron]   = useState("0 * * * *");
  const [actionType, setActionType] = useState("ask_agent");
  const [prompt, setPrompt] = useState("");
  const [url, setUrl]     = useState("");
  const [skillKey, setSkillKey] = useState("");
  const [skillParams, setSkillParams] = useState({});
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState(null);

  const applyPreset = (p) => {
    setName(p.name);
    setTriggerType(p.trigger.type);
    if (p.trigger.cron) setCron(p.trigger.cron);
    setActionType(p.action.type);
    if (p.action.prompt) setPrompt(p.action.prompt);
  };

  const selectedSkill = registry.find(s => s.id === skillKey) || null;

  // Reset skill params when the chosen skill changes — populate defaults.
  const onSkillKeyChange = (key) => {
    setSkillKey(key);
    const def = registry.find(s => s.id === key);
    if (!def) { setSkillParams({}); return; }
    const next = {};
    for (const p of (def.params || [])) {
      if (p.default !== undefined) next[p.key] = Array.isArray(p.default) ? p.default.join(", ") : String(p.default);
    }
    setSkillParams(next);
  };

  const buildSkillParams = () => {
    const out = {};
    for (const p of (selectedSkill?.params || [])) {
      const raw = skillParams[p.key];
      if (raw === undefined || raw === "") continue;
      if (p.type === "string-list") {
        out[p.key] = String(raw).split(",").map(s => s.trim()).filter(Boolean);
      } else if (p.type === "number") {
        const n = Number(raw); if (Number.isFinite(n)) out[p.key] = n;
      } else {
        out[p.key] = raw;
      }
    }
    return out;
  };

  const submit = async (e) => {
    e?.preventDefault();
    setErr(null); setBusy(true);
    try {
      const trigger = triggerType === "schedule" ? { type: "schedule", cron } : { type: "webhook" };
      const action =
        actionType === "ask_agent"   ? { type: "ask_agent",   prompt } :
        actionType === "webhook_out" ? { type: "webhook_out", url }    :
        actionType === "call_skill"  ? { type: "call_skill",  skill_key: skillKey, params: buildSkillParams() } :
        { type: actionType };
      const row = await create({ name, description, trigger, action, enabled: true });
      onCreated?.(row);
      onClose();
    } catch (e2) {
      setErr(e2?.message || "Failed to create rule");
    } finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} role="dialog" aria-modal="true" style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(4, 6, 14, 0.72)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{
        width: "100%", maxWidth: 540, background: t.bgCard,
        border: `1px solid ${t.border}`, borderRadius: 16, padding: 22,
        position: "relative",
      }}>
        <button type="button" onClick={onClose} aria-label="Close" style={{
          position: "absolute", top: 14, right: 14,
          width: 30, height: 30, borderRadius: "50%",
          background: t.bgSurface, border: `1px solid ${t.border}`, color: t.textMuted,
          display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
        }}><X size={14} /></button>

        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: t.white }}>New automation</h3>
        <p style={{ margin: "4px 0 16px", fontSize: 12.5, color: t.textMuted }}>
          Triggered rules call your connected framework when they fire.
        </p>

        {/* Presets */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: t.textMuted, fontWeight: 600, marginBottom: 6 }}>Start from a preset</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {PRESETS.map(p => (
              <button key={p.label} type="button" onClick={() => applyPreset(p)}
                      style={{
                        padding: "6px 10px",
                        background: t.bgSurface, border: `1px solid ${t.border}`,
                        borderRadius: 999, fontSize: 11, color: t.text,
                        cursor: "pointer",
                      }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <Field t={t} label="Name">
          <input value={name} onChange={e => setName(e.target.value)} required
                 placeholder="Daily briefing" style={input(t)} />
        </Field>

        <Field t={t} label="Description (optional)">
          <input value={description} onChange={e => setDescription(e.target.value)}
                 placeholder="Hourly check for fresh airdrops" style={input(t)} />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 8 }}>
          <Field t={t} label="Trigger">
            <select value={triggerType} onChange={e => setTriggerType(e.target.value)} style={input(t)}>
              <option value="schedule">Schedule (cron)</option>
              <option value="webhook">Webhook (POST)</option>
            </select>
          </Field>
          <Field t={t} label="Action">
            <select value={actionType} onChange={e => setActionType(e.target.value)} style={input(t)}>
              <option value="ask_agent">Ask my agent</option>
              <option value="call_skill">Run a built-in skill</option>
              <option value="webhook_out">POST to a URL</option>
            </select>
          </Field>
        </div>

        {triggerType === "schedule" && (
          <Field t={t} label="Cron expression (UTC)" hint="Examples: '0 * * * *' (hourly), '0 9 * * *' (9am daily), '*/15 * * * *' (every 15 min)">
            <input value={cron} onChange={e => setCron(e.target.value)} placeholder="0 * * * *"
                   style={{ ...input(t), fontFamily: "var(--font-jetbrains-mono), monospace" }} />
          </Field>
        )}

        {actionType === "ask_agent" && (
          <Field t={t} label="Prompt to send" hint="Reply is logged in the rule's run history.">
            <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
                      rows={3} required placeholder="Scan for new airdrops and summarise."
                      style={{ ...input(t), resize: "vertical" }} />
          </Field>
        )}

        {actionType === "webhook_out" && (
          <Field t={t} label="Webhook URL">
            <input value={url} onChange={e => setUrl(e.target.value)}
                   placeholder="https://hooks.zapier.com/…" required
                   style={input(t)} />
          </Field>
        )}

        {actionType === "call_skill" && (
          <>
            <Field t={t} label="Built-in skill"
                   hint="Runs in our orchestrator and calls your connected agent for any LLM step.">
              <select value={skillKey} onChange={e => onSkillKeyChange(e.target.value)}
                      required style={input(t)}>
                <option value="">— pick a skill —</option>
                {registry.map(s => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
              {selectedSkill && (
                <div style={{ fontSize: 11.5, color: t.textDim, marginTop: 4, lineHeight: 1.5 }}>
                  {selectedSkill.summary}
                </div>
              )}
            </Field>

            {selectedSkill?.params?.length > 0 && (
              <div style={{
                marginTop: 6, padding: 12,
                background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 10,
              }}>
                <div style={{ fontSize: 11, color: t.textMuted, fontWeight: 600, marginBottom: 8 }}>
                  Skill parameters
                </div>
                {selectedSkill.params.map(p => (
                  <Field key={p.key} t={t}
                         label={p.key}
                         hint={p.hint || (p.type === "string-list" ? "Comma-separated values" : p.type)}>
                    <input
                      value={skillParams[p.key] ?? ""}
                      onChange={e => setSkillParams(s => ({ ...s, [p.key]: e.target.value }))}
                      placeholder={Array.isArray(p.default) ? p.default.join(", ") : (p.default ?? "")}
                      style={input(t)}
                    />
                  </Field>
                ))}
              </div>
            )}
          </>
        )}

        {err && (
          <div style={{
            padding: "8px 10px", marginTop: 10, fontSize: 12,
            background: "rgba(239,68,68,0.12)", color: "#fca5a5", borderRadius: 8,
          }}>{err}</div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} disabled={busy} style={{
            padding: "10px 16px", background: "transparent",
            border: `1px solid ${t.border}`, borderRadius: 10,
            fontSize: 12.5, fontWeight: 700, color: t.textMuted, cursor: "pointer",
          }}>Cancel</button>
          <button type="submit" disabled={busy} style={{
            padding: "10px 16px",
            background: busy ? t.bgSurface : `linear-gradient(135deg, #a855f7, ${t.accent})`,
            border: "none", borderRadius: 10,
            fontSize: 12.5, fontWeight: 700, color: "#fff",
            cursor: busy ? "not-allowed" : "pointer",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            {busy ? <Loader2 size={12} style={{ animation: "ma-spin 0.9s linear infinite" }} /> : <Plus size={12} />}
            Create rule
          </button>
        </div>
      </form>
    </div>
  );
}

const Field = ({ t, label, hint, children }) => (
  <div style={{ marginTop: 10 }}>
    <div style={{ fontSize: 11.5, color: t.textMuted, fontWeight: 600, marginBottom: 6 }}>{label}</div>
    {children}
    {hint && <div style={{ fontSize: 11, color: t.textDim, marginTop: 4, lineHeight: 1.5 }}>{hint}</div>}
  </div>
);

const input = (t) => ({
  width: "100%", padding: "10px 12px",
  background: t.bgSurface, border: `1px solid ${t.border}`,
  borderRadius: 10, color: t.white, fontSize: 13,
  outline: "none", fontFamily: "inherit",
});

/* ─────────────── Panel ─────────────── */

export default function AutomationRulesPanel({ t, agentAccount }) {
  const auto = useAutomations({ agentAccount });
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState(null);

  const handleFire = async (rule) => {
    setBusyId(`fire:${rule.id}`); setErr(null);
    try { await auto.fire(rule.id); }
    catch (e) { setErr(e?.message || "Fire failed"); }
    finally { setBusyId(null); }
  };
  const handleToggle = async (rule) => {
    setBusyId(`toggle:${rule.id}`); setErr(null);
    try { await auto.update(rule.id, { enabled: !rule.enabled }); }
    catch (e) { setErr(e?.message || "Toggle failed"); }
    finally { setBusyId(null); }
  };
  const handleDelete = async (rule) => {
    if (typeof window !== "undefined" && !window.confirm(`Delete "${rule.name}"?`)) return;
    setBusyId(`delete:${rule.id}`); setErr(null);
    try { await auto.remove(rule.id); }
    catch (e) { setErr(e?.message || "Delete failed"); }
    finally { setBusyId(null); }
  };

  return (
    <section style={{
      background: t.bgCard, border: `1px solid ${t.border}`,
      borderRadius: 14, padding: 18,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, fontSize: 14, fontWeight: 800, color: t.white }}>
          <Zap size={14} color={t.accent} /> Automation rules
        </h2>
        <button type="button" onClick={() => setOpen(true)} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "7px 12px",
          background: t.bgSurface, border: `1px solid ${t.border}`,
          borderRadius: 999, fontSize: 11.5, fontWeight: 700, color: t.text,
          cursor: "pointer",
        }}><Plus size={11} /> New rule</button>
      </div>

      {err && (
        <div style={{
          padding: "8px 10px", marginBottom: 10, fontSize: 12,
          background: "rgba(239,68,68,0.12)", color: "#fca5a5", borderRadius: 8,
        }}>{err}</div>
      )}

      {auto.loading && (
        <div style={{ color: t.textMuted, fontSize: 12.5 }}>
          <Loader2 size={12} style={{ animation: "ma-spin 0.9s linear infinite", verticalAlign: "middle" }} /> Loading rules…
        </div>
      )}

      {!auto.loading && auto.rules.length === 0 && (
        <div style={{
          padding: 14, background: t.bgSurface, border: `1px dashed ${t.border}`,
          borderRadius: 10, fontSize: 12.5, color: t.textMuted, textAlign: "center",
        }}>
          No rules yet. Create one to schedule prompts, relay webhooks, or fire on a cron.
        </div>
      )}

      {!auto.loading && auto.rules.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
          {auto.rules.map(rule => (
            <RuleRow key={rule.id} t={t} rule={rule} busyId={busyId}
                     onFire={handleFire} onToggle={handleToggle} onDelete={handleDelete} />
          ))}
        </ul>
      )}

      {open && (
        <CreateRuleModal t={t} agentAccount={agentAccount}
          onClose={() => setOpen(false)}
          onCreated={() => setOpen(false)} />
      )}
    </section>
  );
}

/* ─────────────── Per-rule row + history drawer ─────────────── */

function RuleRow({ t, rule, busyId, onFire, onToggle, onDelete }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li style={{
      background: t.bgSurface, border: `1px solid ${t.border}`,
      borderRadius: 10, overflow: "hidden",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 12px",
      }}>
        <button type="button" onClick={() => setExpanded(v => !v)}
                aria-label={expanded ? "Hide history" : "Show history"}
                title={expanded ? "Hide history" : "Show history"}
                style={{
                  width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                  background: "transparent", border: "none",
                  color: t.textMuted, cursor: "pointer",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: t.white, display: "flex", alignItems: "center", gap: 8 }}>
            {rule.name}
            {!rule.enabled && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999,
                             background: "rgba(245,158,11,0.18)", color: "#f59e0b" }}>Paused</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2,
                        display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={chip(t)}><TriggerLabel trigger={rule.trigger} /></span>
            <span>→</span>
            <span style={chip(t)}><ActionLabel action={rule.action} /></span>
            {rule.last_run_at && (
              <RunBadge t={t} status={rule.last_run_status} when={rule.last_run_at} />
            )}
            <span style={{ color: t.textDim, marginLeft: 4 }}>{rule.run_count || 0} runs</span>
          </div>
        </div>

        <button type="button" onClick={() => onFire(rule)}
                disabled={busyId === `fire:${rule.id}`}
                title="Run now" aria-label="Run now"
                style={iconBtn(t, busyId === `fire:${rule.id}`)}>
          {busyId === `fire:${rule.id}`
            ? <Loader2 size={12} style={{ animation: "ma-spin 0.9s linear infinite" }} />
            : <Play size={12} />}
        </button>
        <button type="button" onClick={() => onToggle(rule)}
                disabled={busyId === `toggle:${rule.id}`}
                title={rule.enabled ? "Pause" : "Resume"} aria-label="Toggle"
                style={iconBtn(t, busyId === `toggle:${rule.id}`, rule.enabled ? "#10b981" : t.textMuted)}>
          <Power size={12} />
        </button>
        <button type="button" onClick={() => onDelete(rule)}
                disabled={busyId === `delete:${rule.id}`}
                title="Delete" aria-label="Delete"
                style={iconBtn(t, busyId === `delete:${rule.id}`)}>
          {busyId === `delete:${rule.id}`
            ? <Loader2 size={12} style={{ animation: "ma-spin 0.9s linear infinite" }} />
            : <Trash2 size={12} />}
        </button>
      </div>

      {expanded && <RuleRunHistory t={t} ruleId={rule.id} />}
    </li>
  );
}

function RunBadge({ t, status, when }) {
  const ok = status === "ok";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10.5, padding: "1px 7px", borderRadius: 999,
      background: ok ? "rgba(16,185,129,0.18)" : "rgba(239,68,68,0.18)",
      color: ok ? "#10b981" : "#fca5a5",
      fontWeight: 700,
    }}>
      {ok ? <Check size={9} /> : <AlertCircle size={9} />}
      {ok ? "ok" : "error"} · {timeAgo(when)}
    </span>
  );
}

function RuleRunHistory({ t, ruleId }) {
  const { runs, loading, error, reload } = useAutomationRuns(ruleId);
  const [openRunId, setOpenRunId] = useState(null);

  return (
    <div style={{
      borderTop: `1px solid ${t.border}`,
      background: t.bgCard,
      padding: "10px 14px 12px",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 8,
      }}>
        <div style={{ fontSize: 11, color: t.textMuted, fontWeight: 600,
                      textTransform: "uppercase", letterSpacing: 0.6 }}>
          Recent runs {runs.length ? `(${runs.length})` : ""}
        </div>
        <button type="button" onClick={() => reload()} disabled={loading}
                aria-label="Refresh runs" title="Refresh"
                style={{
                  width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                  background: "transparent", border: "none",
                  color: t.textMuted, cursor: loading ? "not-allowed" : "pointer",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}>
          {loading
            ? <Loader2 size={11} style={{ animation: "ma-spin 0.9s linear infinite" }} />
            : <RefreshCw size={11} />}
        </button>
      </div>

      {error && (
        <div style={{ fontSize: 11, color: "#fca5a5" }}>{error}</div>
      )}
      {!loading && !error && runs.length === 0 && (
        <div style={{ fontSize: 11.5, color: t.textDim, padding: "8px 0" }}>
          No runs yet. The rule fires on its trigger or via the Run-now button.
        </div>
      )}

      {runs.length > 0 && (
        <ol style={{
          margin: 0, padding: 0, listStyle: "none",
          display: "flex", flexDirection: "column", gap: 4,
        }}>
          {runs.map(run => {
            const open = openRunId === run.id;
            const ok = run.status === "ok";
            const body = ok ? run.output : run.error;
            return (
              <li key={run.id} style={{
                background: t.bgSurface, border: `1px solid ${t.border}`,
                borderRadius: 8, fontSize: 11.5,
              }}>
                <button type="button" onClick={() => setOpenRunId(open ? null : run.id)}
                        style={{
                          width: "100%", padding: "8px 10px",
                          background: "transparent", border: "none",
                          color: t.text, cursor: "pointer",
                          display: "flex", alignItems: "center", gap: 8,
                          textAlign: "left",
                        }}>
                  {open ? <ChevronDown size={11} color={t.textDim} />
                        : <ChevronRight size={11} color={t.textDim} />}
                  <span style={{
                    fontFamily: "var(--font-jetbrains-mono), monospace",
                    color: ok ? "#10b981" : "#fca5a5",
                    fontWeight: 700, fontSize: 10.5, minWidth: 38,
                  }}>{ok ? "OK" : "ERR"}</span>
                  <span style={{ color: t.textDim, fontFamily: "var(--font-jetbrains-mono), monospace", flexShrink: 0 }}>
                    {run.source}
                  </span>
                  <span style={{ flex: 1, color: t.textMuted, overflow: "hidden",
                                 textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {(body || "").slice(0, 120)}
                  </span>
                  <span style={{ color: t.textDim, flexShrink: 0 }}>
                    {timeAgo(run.fired_at)}
                  </span>
                </button>
                {open && (
                  <div style={{
                    padding: "0 10px 10px",
                    fontFamily: "var(--font-jetbrains-mono), monospace",
                    fontSize: 11, color: t.text,
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    <pre style={{
                      margin: 0, padding: 8,
                      background: t.bg, border: `1px solid ${t.border}`,
                      borderRadius: 6, maxHeight: 240, overflow: "auto",
                    }}>{prettyJson(body)}</pre>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function prettyJson(text) {
  if (!text) return "—";
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return String(text);
  }
}

const chip = (t) => ({
  display: "inline-flex", alignItems: "center", gap: 4,
  padding: "2px 6px", background: t.bgCard,
  border: `1px solid ${t.border}`, borderRadius: 4,
  color: t.textMuted, fontSize: 10.5,
  fontFamily: "var(--font-jetbrains-mono), monospace",
});

const iconBtn = (t, busy, color) => ({
  width: 28, height: 28, borderRadius: 8,
  background: t.bgCard, border: `1px solid ${t.border}`,
  color: color || t.textMuted,
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.5 : 1,
  flexShrink: 0,
});
