"use client";
// AgentCreatorWizard — /agents/create
//
// Single-page launchpad. Three sections render stacked, the right rail
// shows a live preview, and one Launch CTA sits at the bottom.
// Sections, in order:
//   1. Agent details     (name, handle, bio, personality, avatar)
//   2. Choose framework  (OpenClaw / IronClaw / Self-hosted) + creds
//   3. Connect channels  (optional pass-through to framework docs)
//
// Why single-page (not multi-step): IronShield is a launchpad sitting
// above the frameworks — the actual decision space is small (paste
// some creds, pick presets) and the user benefits from seeing the
// whole shape at once. Test-connection + handle validation stay
// inline so users can't launch with bad credentials.
//
// Framework comes before channels because channels link to
// framework-specific docs.

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  Plus, Loader2, ExternalLink,
  Wallet, Bot, Shield, Send, Globe, MessageSquare,
} from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import useAgent from "@/hooks/useAgent";
import useAgentConnections from "@/hooks/useAgentConnections";
import AgentAvatar from "@/components/agents/AgentAvatar";
import AvatarPicker from "@/components/agents/AvatarPicker";
import { defaultAvatar } from "@/components/agents/avatarPresets";

/* ─────────────── Framework cards ─────────────── */

const FRAMEWORK_DEFS = {
  openclaw: {
    title:       "OpenClaw",
    blurb:       "General purpose agent for multi-platform tasks and automation.",
    bullets:     ["Great for community & support", "Works across multiple platforms"],
    recommended: true,
    fields: [
      { key: "external_id", label: "Agent ID",   placeholder: "agent_abc123…", required: true },
      { key: "endpoint",    label: "API endpoint (optional)", placeholder: "https://api.openclaw.ai" },
      { key: "auth",        label: "API key",   placeholder: "ock_…", secret: true, required: true },
    ],
  },
  ironclaw: {
    title:   "IronClaw",
    blurb:   "Encrypted-enclave agent runtime on NEAR AI Cloud.",
    bullets: ["TEE-attested execution", "On-chain wallet & DeFi tools"],
    fields: [
      { key: "external_id", label: "Agent slug", placeholder: "my-agent.near.ai" },
      { key: "endpoint",    label: "Gateway base URL", placeholder: "https://stark-goat.agent0.near.ai", required: true },
      { key: "auth",        label: "Gateway token", placeholder: "ic_…", secret: true, required: true },
    ],
  },
  self_hosted: {
    title:   "Self-hosted",
    blurb:   "Bring your own — Hermes (Nous Research) or anything that speaks HTTP.",
    bullets: ["Full control of the runtime", "POST {endpoint}/chat → {reply}"],
    fields: [
      { key: "endpoint", label: "Webhook base URL", placeholder: "https://my-agent.example.com", required: true },
      { key: "auth",     label: "HMAC secret (optional)", placeholder: "base64-or-random", secret: true },
    ],
  },
};

/* ─────────────── Section 1: identity ─────────────── */

function SectionIdentity({ t, state, set, isHandleAvail }) {
  return (
    <Section t={t} step={1} title="Agent details" hint="Pick a NEAR-native identity for your agent.">
      <Grid>
        <Field t={t} label="Agent name" hint="Display name. Doesn't need to be unique.">
          <input value={state.name} onChange={e => set({ name: e.target.value })}
                 placeholder="e.g. Airdrop Hunter" maxLength={32} style={input(t)} />
        </Field>
        <Field t={t} label="Handle" hint="Lowercase letters, digits, _ and -. Becomes agent.<handle>.near.">
          <input value={state.handle} onChange={e => set({ handle: e.target.value.toLowerCase() })}
                 placeholder="airdrop_hunter" maxLength={32} style={input(t)} />
          {state.handle && (
            <div style={{ fontSize: 11, color: isHandleAvail ? "#10b981" : t.amber, marginTop: 4 }}>
              {isHandleAvail ? "Available on-chain" : "Checking on-chain availability…"}
            </div>
          )}
        </Field>
        <Field t={t} label="Description" hint="What does this agent help with? Up to 280 chars." span={2}>
          <textarea value={state.bio} onChange={e => set({ bio: e.target.value.slice(0, 280) })}
                    placeholder="Finds airdrops across chains, alerts you on Telegram."
                    rows={3} style={{ ...input(t), resize: "vertical" }} />
        </Field>
        <Field t={t} label="Personality" hint="Display label only. Adapter passes it as system prompt where supported.">
          <select value={state.personality} onChange={e => set({ personality: e.target.value })} style={input(t)}>
            <option>Helpful</option>
            <option>Sharp</option>
            <option>Playful</option>
            <option>Concise</option>
            <option>Custom</option>
          </select>
        </Field>
      </Grid>

      {/* Avatar picker spans the full width below the form fields. The
          live preview + presets grid + upload button all live inside
          the picker so this card stays focused on identity. */}
      <div style={{ marginTop: 16 }}>
        <AvatarPicker
          value={state.avatarUrl}
          onChange={(v) => set({ avatarUrl: v })}
        />
      </div>
    </Section>
  );
}

/* ─────────────── Section 3: channels (pass-through) ─────────────── */

function SectionChannels({ t, framework }) {
  const docs = framework === "ironclaw" ? "https://docs.near.ai/agents/quickstart"
            : framework === "openclaw"   ? "https://openclaw.ai/docs/channels"
            : "https://hermes-agent.nousresearch.com/";
  const channels = [
    { icon: Send,          name: "Telegram",         doc: "telegram",  hint: "Bot token via @BotFather" },
    { icon: MessageSquare, name: "Discord",          doc: "discord",   hint: "Server invite + bot token" },
    { icon: Globe,         name: "WhatsApp",         doc: "whatsapp",  hint: "WhatsApp Business API" },
    { icon: Bot,           name: "Custom webhook",   doc: "webhook",   hint: "POST endpoint you control" },
  ];
  return (
    <Section t={t} step={3} title="Connect channels (optional)"
             hint="Channels are wired inside your chosen framework, not on IronShield. Pick where your agent should reach users — we'll deep-link you to the setup guide.">
      <div style={{
        padding: "10px 14px", marginBottom: 14, borderRadius: 10,
        background: `${t.accent}10`, border: `1px solid ${t.border}`,
        fontSize: 12.5, color: t.textMuted,
      }}>
        <strong style={{ color: t.white }}>Heads up —</strong> IronShield doesn't run Telegram bots or Discord apps for you. Your framework does. Skip this section if you'll wire channels later.
      </div>
      <div style={{
        display: "grid", gap: 10,
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
      }}>
        {channels.map(c => (
          <a key={c.name} href={`${docs}#${c.doc}`} target="_blank" rel="noopener noreferrer"
             style={channelCard(t)}>
            <span style={iconChip(t)}><c.icon size={16} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.white }}>{c.name}</div>
              <div style={{ fontSize: 11.5, color: t.textMuted }}>{c.hint}</div>
            </div>
            <ExternalLink size={14} color={t.textDim} />
          </a>
        ))}
      </div>
    </Section>
  );
}

/* ─────────────── Section 2: framework + credentials ─────────────── */

function SectionFramework({ t, state, set, validateFn }) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const def = FRAMEWORK_DEFS[state.framework];

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await validateFn({
        framework:   state.framework,
        external_id: state.cred.external_id,
        endpoint:    state.cred.endpoint,
        auth:        state.cred.auth,
      });
      setTestResult(r);
    } catch (e) {
      setTestResult({ ok: false, error: e?.message || "Test failed" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Section t={t} step={2} title="Choose framework"
             hint="Where does your agent actually run? IronShield manages identity + skills; the framework runs the LLM.">
      <div style={{
        display: "grid", gap: 10, marginBottom: 18,
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
      }}>
        {Object.entries(FRAMEWORK_DEFS).map(([key, fw]) => {
          const active = state.framework === key;
          return (
            <button key={key} type="button" onClick={() => set({ framework: key, cred: {} })}
                    style={frameworkCard(t, active, fw.recommended)}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: t.white }}>{fw.title}</span>
                {fw.recommended && (
                  <span style={recommendedBadge(t)}>Recommended</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 8, lineHeight: 1.5 }}>{fw.blurb}</div>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 11.5, color: t.textDim, lineHeight: 1.7 }}>
                {fw.bullets.map(b => <li key={b}>• {b}</li>)}
              </ul>
            </button>
          );
        })}
      </div>

      {def && (
        <div style={{
          background: t.bgSurface, border: `1px solid ${t.border}`,
          borderRadius: 12, padding: 16,
        }}>
          <div style={{ fontSize: 12, color: t.textMuted, marginBottom: 12 }}>
            Paste credentials for <strong style={{ color: t.white }}>{def.title}</strong>. They never go on-chain — encrypted at rest in our backend.
          </div>
          <Grid>
            {def.fields.map(f => (
              <Field key={f.key} t={t} label={f.label} hint={f.required ? "Required" : "Optional"} span={f.key === "external_id" ? 1 : 2}>
                <input
                  type={f.secret ? "password" : "text"}
                  value={state.cred[f.key] || ""}
                  onChange={e => set({ cred: { ...state.cred, [f.key]: e.target.value } })}
                  placeholder={f.placeholder}
                  style={input(t)}
                />
              </Field>
            ))}
          </Grid>

          <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
            <button type="button" onClick={test} disabled={testing} style={secondaryBtn(t, testing)}>
              {testing ? <Loader2 size={13} style={{ animation: "ma-spin 0.9s linear infinite" }} /> : <Shield size={13} />}
              Test connection
            </button>
            {testResult && (
              <span style={{
                fontSize: 12, fontWeight: 600,
                color: testResult.ok ? "#10b981" : "#fca5a5",
              }}>
                {testResult.ok
                  ? `✓ Connected — ${testResult.info?.name || "agent reachable"}`
                  : `✕ ${testResult.error || "Failed"}`}
              </span>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

/* ─────────────── Right rail: live preview ─────────────── */

function PreviewRail({ t, state }) {
  const def = FRAMEWORK_DEFS[state.framework];
  return (
    <aside style={{
      background: t.bgCard, border: `1px solid ${t.border}`,
      borderRadius: 14, padding: 18, position: "sticky", top: 16,
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: t.white, marginBottom: 4 }}>Agent preview</div>
      <div style={{ fontSize: 11.5, color: t.textMuted, marginBottom: 14 }}>How your agent will appear.</div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <AgentAvatar value={state.avatarUrl} size={48} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: t.white }}>
            {state.name || "Your agent"}
          </div>
          <div style={{ fontSize: 11.5, color: t.textMuted, fontFamily: "var(--font-jetbrains-mono), monospace" }}>
            {state.handle ? `@${state.handle}.near` : "@—"}
          </div>
        </div>
      </div>

      <div style={{ fontSize: 12.5, color: t.text, lineHeight: 1.5, marginBottom: 14 }}>
        {state.bio || "Your description will appear here."}
      </div>

      <div style={{
        padding: 12, background: t.bgSurface, border: `1px solid ${t.border}`,
        borderRadius: 10, marginBottom: 12,
      }}>
        <div style={{ fontSize: 11, color: t.textDim, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>Summary</div>
        <SummaryRow t={t} k="Framework"  v={def?.title || "—"} />
        <SummaryRow t={t} k="Personality" v={state.personality} />
        <SummaryRow t={t} k="Status"     v="Not deployed" />
      </div>

      <div style={{
        fontSize: 11.5, color: t.textMuted, lineHeight: 1.5,
        padding: 10, background: `${t.accent}10`, borderRadius: 8,
      }}>
        Permissions, tools, and skills can be configured after launch from the agent dashboard.
      </div>
    </aside>
  );
}

function SummaryRow({ t, k, v }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      fontSize: 12, padding: "3px 0",
    }}>
      <span style={{ color: t.textMuted }}>{k}</span>
      <span style={{ color: t.white, fontWeight: 600 }}>{v}</span>
    </div>
  );
}

/* ─────────────── Helpers ─────────────── */

const Section = ({ t, step, title, hint, children }) => (
  <section className="ix-wizard-section" style={{
    background: t.bgCard, border: `1px solid ${t.border}`,
    borderRadius: 14, padding: 22, marginBottom: 14,
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
      <span style={{
        width: 26, height: 26, borderRadius: "50%",
        background: `${t.accent}22`, color: t.accent,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 12, fontWeight: 800, flexShrink: 0,
      }}>{step}</span>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: t.white }}>{title}</h2>
    </div>
    <p style={{ margin: "0 0 16px 38px", fontSize: 12.5, color: t.textMuted }}>{hint}</p>
    <div style={{ marginLeft: 0 }}>{children}</div>
  </section>
);

const Grid = ({ children }) => (
  <div style={{
    display: "grid", gap: 14,
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  }} className="ix-wizard-grid">{children}</div>
);

const Field = ({ t, label, hint, span = 1, children }) => (
  <div className="ix-wizard-field"
       style={{ gridColumn: span === 2 ? "span 2" : undefined, minWidth: 0 }}>
    <div style={{ fontSize: 11.5, color: t.textMuted, fontWeight: 600, marginBottom: 6 }}>{label}</div>
    {children}
    {hint && <div style={{ fontSize: 11, color: t.textDim, marginTop: 4 }}>{hint}</div>}
  </div>
);

const input = (t) => ({
  width: "100%", padding: "10px 12px",
  background: t.bgSurface, border: `1px solid ${t.border}`,
  borderRadius: 10, color: t.white, fontSize: 13,
  outline: "none", fontFamily: "inherit",
});

const channelCard = (t) => ({
  display: "flex", alignItems: "center", gap: 10,
  padding: "12px 14px",
  background: t.bgSurface, border: `1px solid ${t.border}`,
  borderRadius: 10, color: "inherit", textDecoration: "none",
});

const iconChip = (t) => ({
  width: 32, height: 32, flexShrink: 0, borderRadius: 8,
  background: `${t.accent}22`, color: t.accent,
  display: "inline-flex", alignItems: "center", justifyContent: "center",
});

const frameworkCard = (t, active, recommended) => ({
  textAlign: "left", padding: "14px 16px",
  background: active ? `${t.accent}14` : t.bgSurface,
  border: `1.5px solid ${active ? t.accent : (recommended ? "rgba(168,85,247,0.4)" : t.border)}`,
  borderRadius: 12, cursor: "pointer", color: "inherit",
  transition: "border-color 120ms ease, background 120ms ease",
  boxShadow: active ? `0 0 0 1px ${t.accent}33 inset` : "none",
});

const recommendedBadge = (t) => ({
  fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
  background: "rgba(168,85,247,0.22)", color: "#c4b8ff",
});

const primaryBtn = (t, busy) => ({
  display: "inline-flex", alignItems: "center", gap: 8,
  padding: "10px 18px",
  background: busy ? t.bgSurface : `linear-gradient(135deg, #a855f7, ${t.accent})`,
  border: "none", borderRadius: 10,
  fontSize: 13, fontWeight: 700, color: "#fff",
  cursor: busy ? "not-allowed" : "pointer",
  boxShadow: busy ? "none" : `0 10px 24px rgba(168,85,247,0.3)`,
});

const secondaryBtn = (t, busy) => ({
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "9px 14px",
  background: t.bgSurface, border: `1px solid ${t.border}`,
  borderRadius: 10, fontSize: 12.5, fontWeight: 700, color: t.text,
  cursor: busy ? "not-allowed" : "pointer",
  opacity: busy ? 0.6 : 1,
});

/* ─────────────── Page ─────────────── */

export default function AgentCreatorWizard() {
  const t = useTheme();
  const { connected, address, showModal } = useWallet?.() || {};
  const agent = useAgent();
  const conn  = useAgentConnections();
  // `agent.profile` is populated by useAgent's auto-fetch on address
  // change. Used to swap the wizard's header copy + the launch
  // button label between "first agent" and "additional agent".
  const hasPrimary = Boolean(agent.profile);

  const [state, setState] = useState({
    name: "", handle: "", bio: "", avatarUrl: defaultAvatar(), personality: "Helpful",
    framework: "openclaw",
    cred: {}, // external_id, endpoint, auth
  });
  const [launching, setLaunching] = useState(false);
  const [error, setError]         = useState(null);

  const set = useCallback((patch) => setState(s => ({ ...s, ...patch })), []);

  const handleValid = useMemo(() =>
    /^[a-z0-9_-]{3,32}$/.test(state.handle), [state.handle]);

  // Single-page form: gate Launch on every required field across all
  // sections. Identity needs name + valid handle, framework section
  // needs every required cred for the chosen framework. Channels are
  // pass-through and don't gate launch.
  const canLaunch = useMemo(() => {
    if (state.name.length < 1 || !handleValid) return false;
    const def = FRAMEWORK_DEFS[state.framework];
    const required = def.fields.filter(f => f.required).map(f => f.key);
    return required.every(k => state.cred[k] && state.cred[k].length > 0);
  }, [state, handleValid]);

  const launch = async () => {
    setLaunching(true);
    setError(null);
    try {
      // Three branches for "where does this agent's identity come from":
      //
      //   (a) Caller already has a primary AgentProfile + the handle
      //       matches → reuse the primary, just attach the framework
      //       connection. agent_account === their NEAR account.
      //
      //   (b) Caller has NO primary profile yet → register the primary
      //       (register_agent on-chain). This is the fix for first-time
      //       users coming from /skills install gate; the previous code
      //       jumped to createSubAgent which the contract rejects when
      //       there's no parent profile.
      //
      //   (c) Caller has a primary, but with a different handle → spin
      //       up a sub-agent on a new sub-account (createSubAgent).
      //
      // We figure out which branch by reading on-chain state up front.
      const myProfile = await agent.fetchProfile?.().catch(() => null);
      let agent_account;

      if (!myProfile) {
        // (b) First-time. Register the primary.
        await agent.registerAgent({ handle: state.handle, bio: state.bio });
        agent_account = address;
      } else if (myProfile.handle === state.handle) {
        // (a) Reuse — same handle, same owner.
        agent_account = address;
      } else {
        // (c) Additional agent for an already-registered owner.
        const res = await agent.createSubAgent({
          handle: state.handle,
          bio:    state.bio,
        });
        agent_account = res?.subAccountId;
      }
      if (!agent_account) throw new Error("Couldn't allocate an agent identity");

      // 2. backend: persist framework connection (carries auth, encrypted).
      const meta = {
        display_name: state.name,
        avatar_url:   state.avatarUrl || null,
        personality:  state.personality,
      };
      await conn.connect({
        agent_account,
        framework:   state.framework,
        external_id: state.cred.external_id || null,
        endpoint:    state.cred.endpoint    || null,
        auth:        state.cred.auth        || null,
        meta,
      });

      // 3. on-chain: register the *public* binding so the framework
      //    attached to this agent is auditable without trusting our
      //    backend. Auth never goes here — only framework + endpoint
      //    + display metadata. Best-effort: a chain-write failure
      //    doesn't roll back the backend connection (the user can
      //    retry from the dashboard).
      try {
        await agent.setAgentConnection?.({
          agent_account,
          framework:   state.framework,
          external_id: state.cred.external_id || "",
          endpoint:    state.cred.endpoint    || "",
          meta:        JSON.stringify(meta).slice(0, 1000),
        });
      } catch (chainErr) {
        console.warn("On-chain set_agent_connection failed (backend already persisted):", chainErr?.message || chainErr);
      }

      // 3. route to the dashboard.
      if (typeof window !== "undefined") {
        window.location.href = `/agents/view?account=${encodeURIComponent(agent_account)}`;
      }
    } catch (e) {
      setError(e?.message || "Launch failed");
    } finally {
      setLaunching(false);
    }
  };

  if (!connected) {
    return (
      <div style={{
        padding: 44, borderRadius: 14, textAlign: "center",
        background: t.bgCard, border: `1px dashed ${t.border}`,
      }}>
        <Wallet size={28} color={t.accent} style={{ marginBottom: 12 }} />
        <div style={{ fontSize: 16, fontWeight: 800, color: t.white, marginBottom: 6 }}>
          Connect a wallet to launch an agent
        </div>
        <button type="button" onClick={() => showModal?.()} style={{
          ...primaryBtn(t, false), marginTop: 14,
        }}>Connect wallet</button>
      </div>
    );
  }

  return (
    <>
      <header style={{
        display: "flex", alignItems: "flex-end", justifyContent: "space-between",
        gap: 16, marginBottom: 22, flexWrap: "wrap",
      }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{
            fontSize: "clamp(24px, 2.4vw, 32px)", margin: 0,
            fontWeight: 800, color: t.white, letterSpacing: -0.4,
          }}>
            {hasPrimary ? "Add another agent" : "Launch your first agent"}
            <span style={{
              fontSize: 11, padding: "3px 8px", verticalAlign: "middle",
              background: `${t.accent}22`, color: t.accent,
              borderRadius: 999, marginLeft: 8, fontWeight: 700,
              letterSpacing: 1.2,
            }}>BETA</span>
          </h1>
          <p style={{ fontSize: 13, color: t.textMuted, marginTop: 6, maxWidth: 640 }}>
            Bring your agent or build one — IronShield wraps it with NEAR-native identity, a skills marketplace, and a cross-framework control plane. We don't run the runtime; your framework does.
          </p>
        </div>

        {/* Top-right Launch CTA — duplicated from the bottom button so
            users with completed forms don't have to scroll to launch.
            On phones it goes full-width below the title. */}
        <button type="button" onClick={launch} disabled={!canLaunch || launching}
                className="ix-wizard-header-cta"
                style={{ ...primaryBtn(t, !canLaunch || launching), justifyContent: "center" }}>
          {launching
            ? <><Loader2 size={13} style={{ animation: "ma-spin 0.9s linear infinite" }} /> Launching…</>
            : <><Plus size={13} /> Launch agent</>}
        </button>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 18 }} className="ix-wizard-shell">
        <div>
          {error && (
            <div style={{
              padding: "10px 14px", marginBottom: 14, borderRadius: 10,
              border: `1px solid ${t.border}`, background: "rgba(239,68,68,0.12)",
              color: "#fca5a5", fontSize: 13,
            }}>{error}</div>
          )}

          <SectionIdentity  t={t} state={state} set={set} isHandleAvail={handleValid} />
          <SectionFramework t={t} state={state} set={set} validateFn={conn.validate} />
          <SectionChannels  t={t} framework={state.framework} />

          {/* Bottom Launch row — primary CTA + a small explainer that
              clarifies what actually happens on click. Helps remove
              the "what am I about to approve in my wallet?" anxiety. */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 16, marginTop: 6, padding: "16px 18px",
            background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
            flexWrap: "wrap",
          }}>
            <div style={{ fontSize: 12.5, color: t.textMuted, lineHeight: 1.55, minWidth: 0, flex: "1 1 280px" }}>
              <strong style={{ color: t.white, display: "block", marginBottom: 2 }}>
                Ready to launch?
              </strong>
              We'll register your agent on-chain and persist the framework connection in one wallet approval. Auth tokens stay encrypted in our backend — never on-chain.
            </div>
            <button type="button" onClick={launch} disabled={!canLaunch || launching}
                    style={primaryBtn(t, !canLaunch || launching)}>
              {launching
                ? <><Loader2 size={13} style={{ animation: "ma-spin 0.9s linear infinite" }} /> Launching…</>
                : <><Plus size={13} /> Launch agent</>}
            </button>
          </div>
        </div>

        <div className="ix-wizard-rail">
          <PreviewRail t={t} state={state} />
        </div>
      </div>

      <style jsx global>{`
        @keyframes ma-spin { to { transform: rotate(360deg); } }
        @media (max-width: 1100px) {
          .ix-wizard-shell { grid-template-columns: 1fr !important; }
          .ix-wizard-rail  { display: none; }
        }
        @media (max-width: 720px) {
          /* One column for the form grid. Also force any field that
             requested span:2 back down to a single column — otherwise
             the inline gridColumn:"span 2" creates an implicit second
             track and items overlap. */
          .ix-wizard-grid  { grid-template-columns: 1fr !important; }
          .ix-wizard-field { grid-column: auto !important; }

          /* Section card padding tightens on phones — 22px on a 343px-
             wide viewport eats half the screen. */
          .ix-wizard-section { padding: 16px !important; }

          /* Header CTA stacks below the title on phones. The title +
             subtitle form one block; the launch button gets full width
             below so it's tappable. */
          .ix-wizard-header-cta { width: 100%; }
        }
      `}</style>
    </>
  );
}
