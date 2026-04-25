"use client";
// AgentCreatorWizard — /agents/create
//
// Four-step launchpad flow:
//   1. Identity        (handle, bio, avatar URL, personality label)
//   2. Channels        (pass-through guidance — link to framework docs)
//   3. Framework pick  (OpenClaw / IronClaw / Self-hosted) + credentials
//   4. Review + Launch (calls /api/agents/connect once the user confirms)
//
// IronShield doesn't host runtimes. Step 3's credentials hand off to
// the chosen framework's adapter (validate first, persist on success).
// On-chain `register_sub_agent` is invoked at launch time so the agent
// gets a NEAR-native identity (handle.<owner>.near) before the
// connection record is persisted.

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  Plus, ArrowRight, ArrowLeft, Check, Loader2, ExternalLink,
  Wallet, Bot, Shield, Send, Globe, MessageSquare,
} from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import useAgent from "@/hooks/useAgent";
import useAgentConnections from "@/hooks/useAgentConnections";

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

/* ─────────────── Stepper ─────────────── */

function Stepper({ t, step, total }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 22 }}>
      {Array.from({ length: total }, (_, i) => i + 1).map(n => (
        <div key={n} style={{
          flex: 1, height: 6, borderRadius: 999,
          background: n <= step
            ? `linear-gradient(90deg, #a855f7, ${t.accent})`
            : t.bgSurface,
          transition: "background 200ms ease",
        }} />
      ))}
    </div>
  );
}

/* ─────────────── Step 1: identity ─────────────── */

function Step1Identity({ t, state, set, isHandleAvail }) {
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
        <Field t={t} label="Avatar URL" hint="Paste a public image URL (square, ≥256×256). Cloudflare-image upload coming soon.">
          <input value={state.avatarUrl} onChange={e => set({ avatarUrl: e.target.value })}
                 placeholder="https://example.com/avatar.png" style={input(t)} />
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
    </Section>
  );
}

/* ─────────────── Step 2: channels (pass-through) ─────────────── */

function Step2Channels({ t, framework }) {
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
    <Section t={t} step={2} title="Connect channels (optional)"
             hint="Channels are wired inside your chosen framework, not on IronShield. Pick where your agent should reach users — we'll deep-link you to the setup guide.">
      <div style={{
        padding: "10px 14px", marginBottom: 14, borderRadius: 10,
        background: `${t.accent}10`, border: `1px solid ${t.border}`,
        fontSize: 12.5, color: t.textMuted,
      }}>
        <strong style={{ color: t.white }}>Heads up —</strong> IronShield doesn't run Telegram bots or Discord apps for you. Your framework does. Skip this step if you'll wire channels later.
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

/* ─────────────── Step 3: framework + credentials ─────────────── */

function Step3Framework({ t, state, set, validateFn }) {
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
    <Section t={t} step={3} title="Choose framework"
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

/* ─────────────── Step 4: review + launch ─────────────── */

function Step4Review({ t, state }) {
  const def = FRAMEWORK_DEFS[state.framework];
  return (
    <Section t={t} step={4} title="Review + launch"
             hint="We'll register the agent on-chain and persist the framework connection in one approval.">
      <div style={{
        display: "grid", gap: 0,
        gridTemplateColumns: "max-content 1fr",
        padding: 14, background: t.bgSurface,
        border: `1px solid ${t.border}`, borderRadius: 12,
        rowGap: 6, columnGap: 16, fontSize: 13,
      }}>
        <Row label="Name"        value={state.name || "—"} t={t} />
        <Row label="Handle"      value={state.handle ? `@${state.handle}` : "—"} t={t} />
        <Row label="Personality" value={state.personality} t={t} />
        <Row label="Framework"   value={def?.title || "—"} t={t} />
        <Row label="External ID" value={state.cred.external_id || "—"} t={t} />
        <Row label="Endpoint"    value={state.cred.endpoint || "default"} t={t} />
      </div>
    </Section>
  );
}

function Row({ label, value, t }) {
  return (
    <>
      <span style={{ color: t.textMuted, fontSize: 12 }}>{label}</span>
      <span style={{ color: t.white, fontFamily: "var(--font-jetbrains-mono), monospace", fontSize: 12.5 }}>{value}</span>
    </>
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
        {state.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={state.avatarUrl} alt="" width={48} height={48}
               style={{ borderRadius: "50%", flexShrink: 0, objectFit: "cover" }}
               onError={(e) => { e.currentTarget.style.display = "none"; }} />
        ) : (
          <span style={{
            width: 48, height: 48, borderRadius: "50%", flexShrink: 0,
            background: `linear-gradient(135deg, #a855f7, ${t.accent})`,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            color: "#fff",
          }}><Bot size={20} /></span>
        )}
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
  <section style={{
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
  <div style={{ gridColumn: span === 2 ? "span 2" : undefined, minWidth: 0 }}>
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

const TOTAL_STEPS = 4;

export default function AgentCreatorWizard() {
  const t = useTheme();
  const { connected, address, showModal } = useWallet?.() || {};
  const agent = useAgent();
  const conn  = useAgentConnections();

  const [step, setStep] = useState(1);
  const [state, setState] = useState({
    name: "", handle: "", bio: "", avatarUrl: "", personality: "Helpful",
    framework: "openclaw",
    cred: {}, // external_id, endpoint, auth
  });
  const [launching, setLaunching] = useState(false);
  const [error, setError]         = useState(null);

  const set = useCallback((patch) => setState(s => ({ ...s, ...patch })), []);

  const handleValid = useMemo(() =>
    /^[a-z0-9_-]{3,32}$/.test(state.handle), [state.handle]);

  const stepValid = useMemo(() => {
    if (step === 1) return state.name.length >= 1 && handleValid;
    if (step === 3) {
      const def = FRAMEWORK_DEFS[state.framework];
      const required = def.fields.filter(f => f.required).map(f => f.key);
      return required.every(k => state.cred[k] && state.cred[k].length > 0);
    }
    return true;
  }, [step, state, handleValid]);

  const launch = async () => {
    setLaunching(true);
    setError(null);
    try {
      // 1. on-chain: register sub-agent (creates handle.<owner>.near
      //    in spirit; the actual sub-account creation is delegated to
      //    useAgent.createSubAgent which batches it with the contract
      //    call). Skip if the user already has a primary handle that
      //    matches — they want to reuse it.
      const existing = await agent.getAgentByHandle?.(state.handle).catch(() => null);
      let agent_account;
      if (existing && existing.owner === address) {
        // Reuse the primary identity; framework connection attaches to it.
        agent_account = address;
      } else {
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
      <header style={{ marginBottom: 22 }}>
        <h1 style={{
          fontSize: "clamp(24px, 2.4vw, 32px)", margin: 0,
          fontWeight: 800, color: t.white, letterSpacing: -0.4,
        }}>
          Launch your AI agent <span style={{
            fontSize: 11, padding: "3px 8px", verticalAlign: "middle",
            background: `${t.accent}22`, color: t.accent,
            borderRadius: 999, marginLeft: 8, fontWeight: 700,
            letterSpacing: 1.2,
          }}>BETA</span>
        </h1>
        <p style={{ fontSize: 13, color: t.textMuted, marginTop: 6 }}>
          Bring your agent or build one — IronShield wraps it with NEAR identity, skills, and a control plane.
        </p>
      </header>

      <Stepper t={t} step={step} total={TOTAL_STEPS} />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 18 }} className="ix-wizard-shell">
        <div>
          {error && (
            <div style={{
              padding: "10px 14px", marginBottom: 14, borderRadius: 10,
              border: `1px solid ${t.border}`, background: "rgba(239,68,68,0.12)",
              color: "#fca5a5", fontSize: 13,
            }}>{error}</div>
          )}

          {step === 1 && <Step1Identity t={t} state={state} set={set} isHandleAvail={handleValid} />}
          {step === 2 && <Step2Channels t={t} framework={state.framework} />}
          {step === 3 && <Step3Framework t={t} state={state} set={set} validateFn={conn.validate} />}
          {step === 4 && <Step4Review t={t} state={state} />}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
            <button type="button" onClick={() => setStep(s => Math.max(1, s - 1))}
                    disabled={step === 1 || launching}
                    style={secondaryBtn(t, step === 1 || launching)}>
              <ArrowLeft size={13} /> Back
            </button>

            {step < TOTAL_STEPS ? (
              <button type="button" onClick={() => setStep(s => s + 1)}
                      disabled={!stepValid || launching}
                      style={primaryBtn(t, !stepValid || launching)}>
                Next <ArrowRight size={13} />
              </button>
            ) : (
              <button type="button" onClick={launch} disabled={launching}
                      style={primaryBtn(t, launching)}>
                {launching
                  ? <><Loader2 size={13} style={{ animation: "ma-spin 0.9s linear infinite" }} /> Launching…</>
                  : <><Plus size={13} /> Launch agent</>}
              </button>
            )}
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
          .ix-wizard-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </>
  );
}
