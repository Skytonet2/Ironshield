"use client";
// AgentChannelsPanel — embedded in AgentDetailDashboard. Lets the
// owner register Telegram / Discord / custom HTTP credentials for
// the agent. The relay loop (per-agent Telegram poller, Discord
// gateway connection) hasn't landed yet — this captures credentials
// in encrypted-at-rest storage so they're ready when it does. The
// "Pending relay" status pill is intentional: don't promise a live
// relay we don't run yet.

import { useState } from "react";
import {
  Send, MessageSquare, Webhook, Plus, Loader2, X, Trash2,
  AlertCircle, Power,
} from "lucide-react";
import useAgentChannels from "@/hooks/useAgentChannels";

const KIND_DEFS = {
  telegram: {
    label:  "Telegram",
    icon:   Send,
    color:  "#3b82f6",
    fields: [
      { key: "bot_token", label: "Bot token", placeholder: "123456:ABC-DEF…", secret: true, required: true,
        hint: "From @BotFather on Telegram. We store it encrypted at rest." },
      { key: "chat_id", label: "Chat / channel ID", placeholder: "-1001234567890",
        hint: "The chat the bot should post to." },
    ],
  },
  discord: {
    label:  "Discord",
    icon:   MessageSquare,
    color:  "#7c3aed",
    fields: [
      { key: "webhook_url", label: "Webhook URL", placeholder: "https://discord.com/api/webhooks/…", required: true,
        hint: "Server settings → Integrations → Webhooks → New Webhook." },
    ],
  },
  http: {
    label:  "Custom HTTP",
    icon:   Webhook,
    color:  "#10b981",
    fields: [
      { key: "url", label: "Endpoint URL", placeholder: "https://my-relay.example.com/inbound", required: true,
        hint: "Where we POST messages when the relay runtime ships." },
      { key: "secret", label: "HMAC secret (optional)", placeholder: "any string", secret: true,
        hint: "We sign payloads with X-IronShield-Signature: sha256=…" },
    ],
  },
};

/* ─────────────── Add modal ─────────────── */

function AddChannelModal({ t, agentAccount, onClose, onSaved }) {
  const { create } = useAgentChannels({ agentAccount });
  const [kind, setKind]       = useState("telegram");
  const [label, setLabel]     = useState("");
  const [config, setConfig]   = useState({});
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);

  const def = KIND_DEFS[kind];

  const submit = async (e) => {
    e?.preventDefault();
    setError(null); setBusy(true);
    try {
      // Validate required fields up front so the user doesn't see a
      // generic 400 from the route.
      for (const f of def.fields) {
        if (f.required && !String(config[f.key] || "").trim()) {
          setBusy(false);
          setError(`${f.label} is required`);
          return;
        }
      }
      const channel = await create({ channel: kind, label, config });
      onSaved?.(channel);
      onClose();
    } catch (err) {
      setError(err?.message || "Save failed");
    } finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} role="dialog" aria-modal="true" style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(4, 6, 14, 0.72)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} style={{
        width: "100%", maxWidth: 480, background: t.bgCard,
        border: `1px solid ${t.border}`, borderRadius: 16, padding: 22,
        position: "relative",
      }}>
        <button type="button" onClick={onClose} aria-label="Close" style={{
          position: "absolute", top: 14, right: 14,
          width: 30, height: 30, borderRadius: "50%",
          background: t.bgSurface, border: `1px solid ${t.border}`, color: t.textMuted,
          display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
        }}><X size={14} /></button>

        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: t.white }}>Add channel</h3>
        <p style={{ margin: "4px 0 16px", fontSize: 12.5, color: t.textMuted, lineHeight: 1.55 }}>
          Credentials are encrypted at rest. The active relay loop ships in a future release; for now,
          your framework still drives Telegram / Discord directly.
        </p>

        <Field t={t} label="Channel">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {Object.entries(KIND_DEFS).map(([key, def]) => {
              const Active = def.icon;
              const selected = kind === key;
              return (
                <button key={key} type="button" onClick={() => { setKind(key); setConfig({}); }}
                        style={{
                          padding: "10px 8px", borderRadius: 10,
                          background: selected ? `${def.color}1a` : t.bgSurface,
                          border: selected ? `1.5px solid ${def.color}` : `1px solid ${t.border}`,
                          color: t.text, cursor: "pointer", fontSize: 12, fontWeight: 700,
                          display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                        }}>
                  <Active size={16} color={def.color} />
                  {def.label}
                </button>
              );
            })}
          </div>
        </Field>

        <Field t={t} label="Label (optional)" hint="So you remember which channel this is.">
          <input value={label} onChange={e => setLabel(e.target.value)}
                 placeholder="e.g. Founders chat" style={input(t)} />
        </Field>

        {def.fields.map(f => (
          <Field key={f.key} t={t} label={f.label} hint={f.hint}>
            <input
              type={f.secret ? "password" : "text"}
              value={config[f.key] ?? ""}
              onChange={e => setConfig(s => ({ ...s, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              style={input(t)}
            />
          </Field>
        ))}

        {error && (
          <div style={{
            padding: "8px 10px", marginTop: 10, fontSize: 12,
            background: "rgba(239,68,68,0.12)", color: "#fca5a5", borderRadius: 8,
          }}>{error}</div>
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
            Save channel
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

export default function AgentChannelsPanel({ t, agentAccount }) {
  const ch = useAgentChannels({ agentAccount });
  const [open, setOpen]       = useState(false);
  const [busyId, setBusyId]   = useState(null);
  const [error, setError]     = useState(null);

  const handleToggle = async (row) => {
    setBusyId(`tog:${row.id}`); setError(null);
    try { await ch.update(row.id, { status: row.status === "disabled" ? "pending" : "disabled" }); }
    catch (e) { setError(e?.message || "Toggle failed"); }
    finally { setBusyId(null); }
  };
  const handleDelete = async (row) => {
    if (typeof window !== "undefined" &&
        !window.confirm(`Remove ${row.label || row.channel}? Encrypted credentials will be wiped.`)) return;
    setBusyId(`del:${row.id}`); setError(null);
    try { await ch.remove(row.id); }
    catch (e) { setError(e?.message || "Delete failed"); }
    finally { setBusyId(null); }
  };

  return (
    <section style={{
      background: t.bgCard, border: `1px solid ${t.border}`,
      borderRadius: 14, padding: 18,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, fontSize: 14, fontWeight: 800, color: t.white }}>
          <Send size={14} color={t.accent} /> Channels
        </h2>
        <button type="button" onClick={() => setOpen(true)} style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "7px 12px",
          background: t.bgSurface, border: `1px solid ${t.border}`,
          borderRadius: 999, fontSize: 11.5, fontWeight: 700, color: t.text,
          cursor: "pointer",
        }}><Plus size={11} /> Add channel</button>
      </div>

      <div style={{
        padding: "8px 12px", marginBottom: 12, borderRadius: 10,
        background: "rgba(245,158,11,0.10)", border: `1px solid ${t.border}`,
        color: t.textMuted, fontSize: 11.5, lineHeight: 1.55,
        display: "flex", alignItems: "flex-start", gap: 8,
      }}>
        <AlertCircle size={12} color="#f59e0b" style={{ marginTop: 2, flexShrink: 0 }} />
        <span>
          We capture and encrypt your channel credentials, but the active-relay loop
          (Telegram bot polling, Discord gateway) ships separately. Your framework still
          drives the actual messaging.
        </span>
      </div>

      {error && (
        <div style={{
          padding: "8px 10px", marginBottom: 10, fontSize: 12,
          background: "rgba(239,68,68,0.12)", color: "#fca5a5", borderRadius: 8,
        }}>{error}</div>
      )}

      {ch.loading && (
        <div style={{ color: t.textMuted, fontSize: 12.5 }}>
          <Loader2 size={12} style={{ animation: "ma-spin 0.9s linear infinite", verticalAlign: "middle" }} /> Loading channels…
        </div>
      )}

      {!ch.loading && ch.channels.length === 0 && (
        <div style={{
          padding: 14, background: t.bgSurface, border: `1px dashed ${t.border}`,
          borderRadius: 10, fontSize: 12.5, color: t.textMuted, textAlign: "center",
        }}>
          No channels registered yet. Add a Telegram bot, Discord webhook, or custom HTTP endpoint above.
        </div>
      )}

      {ch.channels.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
          {ch.channels.map(c => {
            const def = KIND_DEFS[c.channel] || KIND_DEFS.http;
            const Icon = def.icon;
            return (
              <li key={c.id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px",
                background: t.bgSurface, border: `1px solid ${t.border}`,
                borderRadius: 10,
              }}>
                <span style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: `${def.color}1a`, color: def.color,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}><Icon size={14} /></span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: t.white }}>
                    {c.label || def.label}
                  </div>
                  <div style={{ fontSize: 11, color: t.textMuted }}>
                    {def.label} · {c.has_config ? "credentials stored" : "missing config"}
                  </div>
                </div>

                <span style={{
                  fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 999,
                  background: c.status === "active"
                    ? "rgba(16,185,129,0.18)"
                    : c.status === "disabled"
                    ? "rgba(148,163,184,0.18)"
                    : "rgba(245,158,11,0.18)",
                  color: c.status === "active"
                    ? "#10b981"
                    : c.status === "disabled"
                    ? "#94a3b8"
                    : "#f59e0b",
                }}>{c.status === "pending" ? "pending relay" : c.status}</span>

                <button type="button" onClick={() => handleToggle(c)}
                        disabled={busyId === `tog:${c.id}`}
                        title={c.status === "disabled" ? "Re-enable" : "Disable"} aria-label="Toggle"
                        style={iconBtn(t, busyId === `tog:${c.id}`)}>
                  <Power size={12} />
                </button>
                <button type="button" onClick={() => handleDelete(c)}
                        disabled={busyId === `del:${c.id}`}
                        title="Delete" aria-label="Delete"
                        style={iconBtn(t, busyId === `del:${c.id}`)}>
                  {busyId === `del:${c.id}`
                    ? <Loader2 size={12} style={{ animation: "ma-spin 0.9s linear infinite" }} />
                    : <Trash2 size={12} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {open && <AddChannelModal t={t} agentAccount={agentAccount} onClose={() => setOpen(false)} onSaved={() => setOpen(false)} />}
    </section>
  );
}

const iconBtn = (t, busy) => ({
  width: 28, height: 28, borderRadius: 8,
  background: t.bgCard, border: `1px solid ${t.border}`,
  color: t.textMuted,
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.5 : 1,
  flexShrink: 0,
});
