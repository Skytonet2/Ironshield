"use client";
// /automations — agent automations workshop.
//
// Three tabs:
//   My Automations — active + paused bots the user has running
//   Templates      — starter presets to fork from
//   Logs           — recent agent activity (actions taken, results)
//
// Each automation card shows Triggers / Actions / Success Rate plus
// an Active/Paused pill. Clicking "+ New" opens the create flow;
// activation still requires the 10 NEAR one-time gate (the old
// activate-gate remains below for users on their first one).

import { useState } from "react";
import { useTheme, useWallet } from "@/lib/contexts";
import AppShell from "@/components/shell/AppShell";
import {
  Zap, Coins, Heart, Send, Shield, Lock, CheckCircle2, Plus, Activity,
  TrendingUp, Bell, FileText, ArrowUpRight,
} from "lucide-react";

const ACTIVATION_NEAR = 10;

const TABS = [
  { key: "mine",      label: "My Automations" },
  { key: "templates", label: "Templates" },
  { key: "logs",      label: "Logs" },
];

// Sample "my automations" until the backend list endpoint lands.
// The shape mirrors what the backend will return so wiring later is
// a drop-in swap.
const SAMPLE_AUTOMATIONS = [
  { id: "a1", name: "AI Trend Monitor",  status: "active", triggers: 3, actions: 5, successRate: 98, Icon: TrendingUp, color: "#a855f7" },
  { id: "a2", name: "New Token Alert",   status: "active", triggers: 2, actions: 3, successRate: 96, Icon: Bell,       color: "#3b82f6" },
  { id: "a3", name: "Daily Digest",      status: "paused", triggers: 1, actions: 2, successRate: 0,  Icon: FileText,   color: "#64748b" },
];

const TEMPLATES = [
  { id: "t1", name: "Alpha Scanner",   Icon: Activity, color: "#a855f7", hint: "Watch top accounts, score tokens they mention, surface the top 3 per day." },
  { id: "t2", name: "DCA Bot",         Icon: Coins,    color: "#10b981", hint: "Buy N NEAR of a ticker every day at the same hour — no emotions." },
  { id: "t3", name: "Auto Repost",     Icon: Heart,    color: "#ef4444", hint: "Auto-like + repost any post that matches your topic preset." },
  { id: "t4", name: "Reply Assistant", Icon: Send,     color: "#3b82f6", hint: "Draft replies in your voice; you review + tap send." },
];

// Sample logs — swap for a backend feed when available.
const SAMPLE_LOGS = [
  { id: "l1", ts: "2m ago",  automation: "AI Trend Monitor", event: "Detected $NBULL trending — queued 0.5 NEAR buy" },
  { id: "l2", ts: "12m ago", automation: "New Token Alert",  event: "Alert sent: new token @newscoin-factory.ironshield.near" },
  { id: "l3", ts: "1h ago",  automation: "AI Trend Monitor", event: "Scanned 14 Voices posts, 2 matched preset" },
  { id: "l4", ts: "3h ago",  automation: "AI Trend Monitor", event: "Auto-liked @cobie post mentioning $IRONCLAW" },
];

export default function AutomationsPage() {
  const t = useTheme();
  const { address, showModal } = useWallet();
  const [tab, setTab] = useState("mine");
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function activate() {
    setErr(null);
    if (!address) { showModal?.(); return; }
    setBusy(true);
    try {
      const { payNear, PLATFORM_TREASURY } = await import("@/lib/payments");
      await payNear({
        amountNear: ACTIVATION_NEAR,
        receiver: PLATFORM_TREASURY,
        memo: "ironshield:automations:activate",
      });
      setActive(true);
    } catch (e) {
      setErr(e?.message || "Activation failed — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 920, margin: "0 auto", padding: "16px 16px 60px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: t.accent, fontSize: 12, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase" }}>
              <Zap size={14} /> Automations
            </div>
            <h1 style={{ margin: "4px 0", fontSize: 24, fontWeight: 800, color: t.white, letterSpacing: -0.3 }}>
              Manage your AI automations and workflow pipelines.
            </h1>
          </div>
          {/* Real automation rules live per-agent on /agents/view.
              This route is the legacy overview; route the action
              there so it does something instead of alerting a stub. */}
          <a
            href="/agents/me"
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "8px 14px", borderRadius: 999, border: "none",
              background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
              color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
              boxShadow: "0 8px 20px rgba(168,85,247,0.35)",
              textDecoration: "none",
            }}
          >
            <Plus size={14} />
            New Automation
          </a>
        </div>

        {/* Status strip — 10 NEAR gate */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "12px 14px", borderRadius: 10,
          border: `1px solid ${active ? "var(--green)" : t.border}`,
          background: active ? "rgba(16,185,129,0.08)" : "linear-gradient(90deg, rgba(168,85,247,0.06), transparent)",
          marginBottom: 16,
        }}>
          {active ? <CheckCircle2 size={16} color="var(--green)" /> : <Lock size={16} color={t.textDim} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: active ? "var(--green)" : t.text }}>
              {active ? "Automations active" : "Automations locked"}
            </div>
            <div style={{ fontSize: 12, color: t.textDim }}>
              {active
                ? "Your agent is running the presets below."
                : `Pay ${ACTIVATION_NEAR} NEAR to unlock automations — one-time, non-refundable.`}
            </div>
          </div>
          {!active && (
            <button
              type="button"
              disabled={busy}
              onClick={activate}
              style={{
                padding: "8px 14px", borderRadius: 8, border: "none",
                background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
                color: "#fff", fontSize: 13, fontWeight: 700,
                cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1,
                boxShadow: "0 6px 18px rgba(168,85,247,0.35)",
              }}
            >
              {busy ? "Activating…" : `Activate · ${ACTIVATION_NEAR} NEAR`}
            </button>
          )}
        </div>

        {err && (
          <div style={{
            fontSize: 12, color: "var(--red)",
            padding: "8px 12px", border: `1px solid var(--red)`, borderRadius: 8,
            background: "rgba(239,68,68,0.06)", marginBottom: 14,
          }}>
            {err}
          </div>
        )}

        {/* Tab strip */}
        <div style={{
          display: "flex", gap: 2,
          borderBottom: `1px solid ${t.border}`,
          marginBottom: 14, overflowX: "auto",
        }}>
          {TABS.map((x) => {
            const sel = x.key === tab;
            return (
              <button
                key={x.key}
                type="button"
                onClick={() => setTab(x.key)}
                style={{
                  padding: "10px 14px", background: "transparent", border: "none",
                  fontSize: 13, fontWeight: sel ? 700 : 500,
                  color: sel ? t.accent : t.textDim,
                  borderBottom: `2px solid ${sel ? t.accent : "transparent"}`,
                  cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                {x.label}
              </button>
            );
          })}
        </div>

        {tab === "mine" && <MineTab t={t} items={SAMPLE_AUTOMATIONS} active={active} />}
        {tab === "templates" && <TemplatesTab t={t} templates={TEMPLATES} />}
        {tab === "logs" && <LogsTab t={t} logs={SAMPLE_LOGS} />}
      </div>
    </AppShell>
  );
}

function MineTab({ t, items, active }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((a) => (
        <AutomationCard key={a.id} a={a} t={t} disabled={!active} />
      ))}
      {!active && (
        <div style={{
          padding: 12, borderRadius: 10,
          border: `1px dashed ${t.border}`, color: t.textDim,
          fontSize: 12, textAlign: "center",
        }}>
          These are sample automations. Activate to replace them with your own.
        </div>
      )}
    </div>
  );
}

function AutomationCard({ a, t, disabled }) {
  const { Icon } = a;
  const isActive = a.status === "active";
  return (
    <div
      className="card-lift"
      style={{
        padding: 14, borderRadius: 12,
        background: `linear-gradient(180deg, ${a.color}0d, transparent 70%), var(--bg-card)`,
        border: `1px solid ${isActive ? `${a.color}33` : t.border}`,
        opacity: disabled ? 0.75 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: `${a.color}1c`, color: a.color,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: t.white }}>{a.name}</div>
          <div style={{ fontSize: 11, color: t.textDim, marginTop: 2 }}>
            Last run 12 minutes ago · {a.triggers} triggers → {a.actions} actions
          </div>
        </div>
        <span style={{
          fontSize: 10, padding: "3px 8px", borderRadius: 999,
          fontWeight: 800, letterSpacing: 0.5,
          background: isActive ? "rgba(16,185,129,0.12)" : "var(--bg-surface)",
          color: isActive ? "#10b981" : t.textDim,
          border: `1px solid ${isActive ? "rgba(16,185,129,0.35)" : t.border}`,
          textTransform: "uppercase",
        }}>
          {a.status}
        </span>
      </div>

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(3, 1fr)" }}>
        <Metric label="Triggers"     value={a.triggers} t={t} />
        <Metric label="Actions"      value={a.actions}  t={t} />
        <Metric label="Success Rate" value={`${a.successRate}%`} color={a.successRate >= 80 ? "#10b981" : t.textMuted} t={t} />
      </div>
    </div>
  );
}

function Metric({ label, value, color, t }) {
  return (
    <div style={{
      padding: "8px 10px", borderRadius: 8,
      background: "var(--bg-surface)",
      border: `1px solid ${t.border}`,
    }}>
      <div style={{ fontSize: 10, color: t.textDim, letterSpacing: 0.6, textTransform: "uppercase", fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, color: color || t.white, marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

function TemplatesTab({ t, templates }) {
  return (
    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
      {templates.map((tp) => {
        const { Icon } = tp;
        return (
          <div
            key={tp.id}
            className="card-lift"
            style={{
              padding: 14, borderRadius: 12,
              background: `linear-gradient(180deg, ${tp.color}0d, transparent 70%), var(--bg-card)`,
              border: `1px solid ${tp.color}2a`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{
                width: 34, height: 34, borderRadius: 10,
                background: `${tp.color}1c`, color: tp.color,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
              }}>
                <Icon size={15} />
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.white }}>{tp.name}</div>
            </div>
            <div style={{ fontSize: 12, color: t.textDim, lineHeight: 1.5, marginBottom: 10 }}>
              {tp.hint}
            </div>
            <button
              type="button"
              style={{
                padding: "6px 12px", borderRadius: 8,
                border: `1px solid ${tp.color}55`, background: `${tp.color}15`,
                color: tp.color, fontSize: 12, fontWeight: 700, cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 4,
              }}
            >
              Use template <ArrowUpRight size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function LogsTab({ t, logs }) {
  return (
    <div style={{
      padding: 12, borderRadius: 12,
      border: `1px solid ${t.border}`, background: "var(--bg-card)",
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {logs.map((l) => (
          <div key={l.id} style={{
            display: "flex", gap: 10,
            padding: "10px 8px",
            borderBottom: `1px solid ${t.border}`,
          }}>
            <span style={{
              fontSize: 10, color: t.textDim,
              fontFamily: "var(--font-jetbrains-mono), monospace",
              minWidth: 64,
            }}>{l.ts}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: t.accent, minWidth: 120 }}>
              {l.automation}
            </span>
            <span style={{ fontSize: 12, color: t.textMuted, flex: 1 }}>
              {l.event}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
