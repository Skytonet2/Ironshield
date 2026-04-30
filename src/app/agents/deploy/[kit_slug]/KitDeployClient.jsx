"use client";
// /agents/deploy/[kit_slug] — Kit deployment wizard.
//
// 4-step (Details → Permissions → Connections → Review/Deploy) clone of
// the skill-create wizard's visual language, scoped to the much smaller
// surface area of "wire this Kit to my wallet." Steps:
//
//   1. Details      — Kit summary + preset_config_schema_json form
//   2. Permissions  — pick an existing auth_profile (or system default)
//   3. Connections  — list the required Web2 connectors (Phase 4 deps;
//                     marked "coming soon" so the wizard still ships)
//   4. Review+Deploy — sign register_agent on-chain, then POST a
//                     /api/kit-deployments row tagged with the IronGuide
//                     session if one was attached.
//
// State stays in React only — no localStorage between steps. The
// ?ironguide=<id> query param links the deployment back to the
// concierge session (so /onboard can flip its status to 'deployed').

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, ArrowRight, Check, Loader2, ShieldCheck, Plug,
  Sparkles, AlertTriangle, Wallet, Send, CreditCard,
} from "lucide-react";
import { useWallet } from "@/lib/contexts";
import useAgent from "@/hooks/useAgent";
import { API_BASE } from "@/lib/apiBase";
import { apiFetch } from "@/lib/apiFetch";

// Best-effort detect of Nigerian buyers so we can surface the
// fiat-on-ramp gap (PingPay supports crypto-only on the Nigerian
// on-ramp; naira card/bank funding lands via a separate PSP). We use
// the browser timezone — no IP geolocation, no sketchy fingerprinting.
function isLikelyNigerian() {
  if (typeof Intl === "undefined") return false;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    return tz === "Africa/Lagos";
  } catch { return false; }
}

const STEPS = [
  { key: "details",     label: "Details" },
  { key: "permissions", label: "Permissions" },
  { key: "connections", label: "Connections" },
  { key: "review",      label: "Review & Deploy" },
];

export default function DeployKitPage() {
  // Next 16 wraps the page in a Suspense boundary so useParams + useSearchParams
  // both resolve client-side without the page-arg Promise dance.
  const params = useParams();
  const slug = decodeURIComponent(String(params?.kit_slug || ""));
  const router = useRouter();
  const search = useSearchParams();
  const ironguideSessionId = search.get("ironguide");

  const { address: wallet, connected, showModal } = useWallet?.() || {};
  const { registerAgent, profile, hasAgent } = useAgent();

  const [kit, setKit]                = useState(null);
  const [authProfiles, setAuthProfiles] = useState([]);
  const [step, setStep]              = useState(0);
  const [presets, setPresets]        = useState({});
  const [authProfileId, setAuthProfileId] = useState(null);
  const [agentHandle, setAgentHandle] = useState("");
  const [submitting, setSubmitting]  = useState(false);
  const [error, setError]            = useState(null);
  const [loading, setLoading]        = useState(true);
  const [deploymentId, setDeploymentId] = useState(null);

  // ── Load Kit + the user's auth profiles (best-effort; route may be
  //    absent in early Phase 10 deploys — we degrade gracefully). ──
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(`${API_BASE}/api/kits/${encodeURIComponent(slug)}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Kit not found");
        if (cancelled) return;
        setKit(j.kit);
        setPresets(seedPresets(j.kit, search));
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (slug) load();
    return () => { cancelled = true; };
  }, [slug, search]);

  // Best-effort: load this user's auth profiles. The /auth-profiles
  // route may not exist yet — falls through to "system default" choice.
  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/auth-profiles?mine=1`, {
      headers: { "x-wallet": String(wallet).toLowerCase() },
    })
      .then((r) => r.ok ? r.json() : { profiles: [] })
      .then((j) => { if (!cancelled) setAuthProfiles(Array.isArray(j.profiles) ? j.profiles : []); })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, [wallet]);

  // Default the agent handle off the existing profile or the wallet's
  // first segment so the user has something sensible to edit.
  useEffect(() => {
    if (agentHandle) return;
    const seed = profile?.handle || (wallet ? String(wallet).split(".")[0] : "");
    if (seed) setAgentHandle(seed);
  }, [profile, wallet, agentHandle]);

  const presetSchema = kit?.preset_config_schema_json || {};
  const presetProps  = presetSchema.properties || presetSchema || {};
  const presetEntries = Object.entries(presetProps).filter(([, def]) => def && typeof def === "object");

  const stepValid = useMemo(() => {
    if (step === 0) {
      // Required preset fields must be filled.
      const required = (presetSchema.required || []).filter((k) => k in presetProps);
      return required.every((k) => presets[k] !== undefined && presets[k] !== "" && presets[k] !== null);
    }
    if (step === 1) {
      // Either a chosen profile or the system default — both fine.
      return true;
    }
    if (step === 2) return true;
    if (step === 3) return Boolean(agentHandle.trim()) && connected;
    return true;
  }, [step, presets, presetProps, presetSchema, agentHandle, connected]);

  const goNext = () => {
    if (!stepValid) return;
    if (step === STEPS.length - 1) {
      doDeploy();
      return;
    }
    setStep((s) => s + 1);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const goBack = () => setStep((s) => Math.max(0, s - 1));

  const doDeploy = useCallback(async () => {
    if (!connected) { showModal?.(); return; }
    setSubmitting(true);
    setError(null);
    try {
      // Step 1 — register the agent on-chain if the wallet doesn't
      // already have a profile. Existing-profile users skip the contract
      // call; the deployment row simply attaches to their existing agent.
      if (!hasAgent) {
        await registerAgent({
          handle: agentHandle.trim().slice(0, 32),
          bio:    `Deployed via Kit: ${kit?.title || slug}`,
        });
      }

      // Step 2 — record the deployment row off-chain.
      const r = await fetch(`${API_BASE}/api/kit-deployments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet":     String(wallet).toLowerCase(),
        },
        body: JSON.stringify({
          kit_slug: slug,
          preset_config_json: presets,
          ironguide_session_id: ironguideSessionId ? Number(ironguideSessionId) : null,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not record deployment");
      setDeploymentId(j.deployment.id);

      // Done — bounce to /agents/me so the user sees their new agent
      // alongside its first kit row. Path may not exist; fall back to
      // root.
      setTimeout(() => router.push("/agents/me"), 1200);
    } catch (e) {
      setError(e?.message || "Deploy failed");
    } finally {
      setSubmitting(false);
    }
  }, [connected, showModal, hasAgent, registerAgent, agentHandle, kit, slug, presets, ironguideSessionId, wallet, router]);

  if (loading) {
    return (
      <div style={pageStyle}>
        <div style={containerStyle}>
          <div style={emptyStyle}><Loader2 size={18} style={{ animation: "kw-spin 0.9s linear infinite" }} /> Loading Kit…</div>
        </div>
      </div>
    );
  }

  if (error && !kit) {
    return (
      <div style={pageStyle}>
        <div style={containerStyle}>
          <div style={errorStyle}>{error}</div>
          <Link href="/marketplace/kits" style={ghostBtn}>← Back to Kits</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        <header style={topBarStyle}>
          <div>
            <Link href="/marketplace/kits" style={{ ...linkStyle, fontSize: 11.5 }}>← Kits</Link>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: "6px 0 2px", color: "var(--text-1)" }}>
              Deploy {kit?.title || slug}
            </h1>
            <div style={{ fontSize: 12, color: "var(--text-2)" }}>{kit?.description}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={goBack} disabled={step === 0 || submitting} style={ghostBtn}>
              <ArrowLeft size={13} /> <span>Back</span>
            </button>
            <button type="button" onClick={goNext} disabled={!stepValid || submitting} style={primaryBtn}>
              {step === STEPS.length - 1
                ? (submitting ? <><Loader2 size={13} style={{ animation: "kw-spin 0.9s linear infinite" }} /> Deploying…</> : <><Sparkles size={13} /> Deploy</>)
                : <><span>Next</span> <ArrowRight size={13} /></>}
            </button>
          </div>
        </header>

        <ProgressNav step={step} onJump={setStep} />

        {step === 0 && (
          <DetailsStep kit={kit} presets={presets} setPresets={setPresets} presetEntries={presetEntries} requiredKeys={presetSchema.required || []} ironguideSessionId={ironguideSessionId} />
        )}
        {step === 1 && (
          <PermissionsStep authProfiles={authProfiles} authProfileId={authProfileId} setAuthProfileId={setAuthProfileId} />
        )}
        {step === 2 && (
          <ConnectionsStep kit={kit} />
        )}
        {step === 3 && (
          <ReviewStep
            kit={kit}
            slug={slug}
            presets={presets}
            authProfileId={authProfileId}
            authProfiles={authProfiles}
            agentHandle={agentHandle}
            setAgentHandle={setAgentHandle}
            connected={connected}
            wallet={wallet}
            hasAgent={hasAgent}
            error={error}
            submitting={submitting}
            deploymentId={deploymentId}
            showModal={showModal}
          />
        )}
      </div>

      <style jsx global>{`
        @keyframes kw-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

/* ── Steps ─────────────────────────────────────────────────────────── */

function DetailsStep({ kit, presets, setPresets, presetEntries, requiredKeys, ironguideSessionId }) {
  return (
    <div style={cardStyle}>
      {ironguideSessionId && (
        <div style={hintStyle}>
          <Sparkles size={13} /> AZUKA Guide pre-filled some answers below. Edit anything that doesn't fit.
        </div>
      )}

      <h2 style={cardTitleStyle}>About this Kit</h2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <Stat k="Vertical"  v={kit?.vertical || "—"} />
        <Stat k="Status"    v={kit?.status || "—"} />
        <Stat k="Skills"    v={String((kit?.bundled_skill_ids || []).length)} />
        <Stat k="Connectors" v={String((kit?.required_connectors || []).length)} />
      </div>

      <h2 style={cardTitleStyle}>Preset configuration</h2>
      {presetEntries.length === 0 ? (
        <div style={muted}>No presets — this Kit deploys with built-in defaults.</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {presetEntries.map(([key, def]) => (
            <PresetField
              key={key}
              k={key}
              def={def}
              required={requiredKeys.includes(key)}
              value={presets[key]}
              onChange={(v) => setPresets((p) => ({ ...p, [key]: v }))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PresetField({ k, def, required, value, onChange }) {
  const label = def.title || k;
  const desc  = def.description;
  const type  = def.type || (Array.isArray(def.enum) ? "string" : "string");

  const commonInputStyle = {
    width: "100%",
    background: "var(--bg-input)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "8px 10px",
    color: "var(--text-1)",
    fontSize: 13,
    outline: "none",
  };

  // Tier 4 Kit manifests use type:object (price_range, year_range)
  // and type:array (fb_group_ids). Render those before the legacy
  // string/number/boolean/enum branch.
  if (type === "object" && def.properties && typeof def.properties === "object") {
    const obj = (value && typeof value === "object") ? value : {};
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)" }}>
          {label} {required && <span style={{ color: "var(--red)" }}>*</span>}
        </span>
        {desc && <span style={{ fontSize: 11, color: "var(--text-2)" }}>{desc}</span>}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 8, padding: 10, borderRadius: 9, border: "1px dashed var(--border)",
        }}>
          {Object.entries(def.properties).map(([subKey, subDef]) => (
            <PresetField
              key={subKey}
              k={subKey}
              def={subDef}
              required={(def.required || []).includes(subKey)}
              value={obj[subKey]}
              onChange={(v) => onChange({ ...obj, [subKey]: v })}
            />
          ))}
        </div>
      </div>
    );
  }

  if (type === "array") {
    const arr = Array.isArray(value) ? value : [];
    return (
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)" }}>
          {label} {required && <span style={{ color: "var(--red)" }}>*</span>}
        </span>
        {desc && <span style={{ fontSize: 11, color: "var(--text-2)" }}>{desc}</span>}
        <input
          type="text"
          value={arr.join(", ")}
          onChange={(e) => {
            const parts = e.target.value
              .split(",").map((s) => s.trim()).filter(Boolean);
            onChange(parts);
          }}
          placeholder="comma-separated"
          style={commonInputStyle}
        />
        <span style={{ fontSize: 10.5, color: "var(--text-3)" }}>
          {arr.length} item{arr.length === 1 ? "" : "s"}
        </span>
      </label>
    );
  }

  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)" }}>
        {label} {required && <span style={{ color: "var(--red)" }}>*</span>}
      </span>
      {desc && <span style={{ fontSize: 11, color: "var(--text-2)" }}>{desc}</span>}
      {Array.isArray(def.enum) ? (
        <select
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          style={commonInputStyle}
        >
          <option value="" style={{ background: "var(--bg-surface)" }}>Pick one…</option>
          {def.enum.map((opt) => (
            <option key={String(opt)} value={String(opt)} style={{ background: "var(--bg-surface)" }}>{String(opt)}</option>
          ))}
        </select>
      ) : type === "boolean" ? (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-1)" }}>
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          Enable
        </label>
      ) : type === "number" || type === "integer" ? (
        <input
          type="number"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          style={commonInputStyle}
        />
      ) : (
        <input
          type="text"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          style={commonInputStyle}
          maxLength={def.maxLength || 200}
        />
      )}
    </label>
  );
}

function PermissionsStep({ authProfiles, authProfileId, setAuthProfileId }) {
  return (
    <div style={cardStyle}>
      <h2 style={cardTitleStyle}>Authorization profile</h2>
      <p style={muted}>
        Pick which auth profile decides when this agent can act on its own and when it
        should ask you first. The system default holds high-risk actions for approval.
      </p>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        <ProfileChoice
          active={authProfileId === null}
          onClick={() => setAuthProfileId(null)}
          title="System default"
          subtitle="Asks you to approve withdrawals, transfers, and posts on your behalf."
          icon={<ShieldCheck size={14} />}
        />
        {authProfiles.map((p) => (
          <ProfileChoice
            key={p.id}
            active={authProfileId === p.id}
            onClick={() => setAuthProfileId(p.id)}
            title={p.is_default ? "Your default" : `Profile #${p.id}`}
            subtitle={`${(p.rules_json || []).length} custom rules`}
            icon={<ShieldCheck size={14} />}
          />
        ))}
      </div>
    </div>
  );
}

function ProfileChoice({ active, onClick, title, subtitle, icon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: "left",
        display: "flex",
        gap: 10,
        alignItems: "center",
        padding: 12,
        borderRadius: 10,
        background: active ? "var(--accent-dim)" : "var(--bg-card)",
        border: `1px solid ${active ? "var(--accent-border)" : "var(--border)"}`,
        cursor: "pointer",
        color: "var(--text-1)",
      }}
    >
      <span style={{
        width: 28, height: 28, borderRadius: 8,
        background: active ? "var(--accent)" : "var(--bg-input)",
        color: active ? "#fff" : "var(--text-2)",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-2)" }}>{subtitle}</div>
      </div>
      {active && <Check size={14} style={{ color: "var(--accent)" }} />}
    </button>
  );
}

function ConnectionsStep({ kit }) {
  const required = Array.isArray(kit?.required_connectors) ? kit.required_connectors : [];
  const optional = Array.isArray(kit?.optional_connectors) ? kit.optional_connectors : [];
  const [mine, setMine] = useState([]);
  const [loadingMine, setLoadingMine] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { apiFetch } = await import("@/lib/apiFetch");
        const r = await apiFetch("/api/connectors/me");
        if (!r.ok) throw new Error();
        const j = await r.json();
        if (!cancelled) setMine(Array.isArray(j.connections) ? j.connections : []);
      } catch {
        if (!cancelled) setMine([]); // not signed in / 401 — treat as none connected
      } finally {
        if (!cancelled) setLoadingMine(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const connectedSet = new Set(mine.map((m) => m.connector_name));
  const missing = required.filter((n) => !connectedSet.has(n));

  return (
    <div style={cardStyle}>
      <h2 style={cardTitleStyle}>Web2 connectors</h2>
      <p style={muted}>
        This Kit needs your accounts to act on your behalf. Each connector is
        encrypted at rest and only used by missions you start.{" "}
        <Link href="/connectors" target="_blank" style={linkStyle}>Open the Connectors page →</Link>
      </p>

      {loadingMine && (
        <div style={{ ...muted, marginTop: 14 }}>
          <Loader2 size={13} style={{ animation: "spin 0.9s linear infinite" }} /> Checking your connections…
        </div>
      )}

      {!loadingMine && required.length === 0 && optional.length === 0 && (
        <div style={{ ...muted, marginTop: 14 }}>
          <Plug size={13} /> No external connectors required.
        </div>
      )}

      {!loadingMine && missing.length > 0 && (
        <div style={{
          ...hintStyle,
          marginTop: 12,
          background: "rgba(245, 158, 11, 0.08)",
          borderColor: "rgba(245, 158, 11, 0.3)",
          color: "var(--amber, #f59e0b)",
        }}>
          <AlertTriangle size={13} />
          <span>
            <strong>{missing.length} required connector{missing.length === 1 ? "" : "s"}</strong>{" "}
            not connected yet. The Kit will deploy, but missions that need {missing.join(", ")} will
            fail until you connect.
          </span>
        </div>
      )}

      {!loadingMine && [...required, ...optional].length > 0 && (
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {[...required.map((n) => ({ name: n, kind: "required" })),
            ...optional.map((n) => ({ name: n, kind: "optional" }))].map(({ name, kind }) => {
            const connected = connectedSet.has(name);
            return (
              <div key={name} style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 9,
                border: "1px solid var(--border)",
                background: "var(--bg-card)",
              }}>
                <span style={{
                  width: 28, height: 28, borderRadius: 8,
                  background: connected ? "rgba(16, 185, 129, 0.15)" : "var(--bg-input)",
                  color: connected ? "var(--green, #10B981)" : "var(--text-2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  {connected ? <Check size={13} /> : <Plug size={13} />}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>
                    {name}{" "}
                    {kind === "optional" && (
                      <span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-3)", marginLeft: 4 }}>
                        optional
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: connected ? "var(--green, #10B981)" : "var(--text-2)" }}>
                    {connected ? "Connected" : "Not connected"}
                  </div>
                </div>
                {!connected && (
                  <Link
                    href={`/connectors`}
                    target="_blank"
                    style={{
                      fontSize: 11.5, fontWeight: 700, padding: "6px 10px", borderRadius: 7,
                      border: "1px solid var(--accent-border)", color: "var(--accent)",
                      textDecoration: "none",
                    }}
                  >
                    Connect →
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReviewStep({ kit, slug, presets, authProfileId, authProfiles, agentHandle, setAgentHandle, connected, wallet, hasAgent, error, submitting, deploymentId, showModal }) {
  const profileLabel = authProfileId === null
    ? "System default"
    : `Profile #${authProfileId}`;

  return (
    <div style={cardStyle}>
      {!hasAgent && (
        <div style={hintStyle}>
          <Wallet size={13} /> First-time agent — deploy will register your agent on-chain
          (one wallet signature) before recording the Kit deployment.
        </div>
      )}
      <h2 style={cardTitleStyle}>Review</h2>
      <Stat k="Kit"        v={kit?.title || "—"} />
      <Stat k="Vertical"   v={kit?.vertical || "—"} />
      <Stat k="Auth"       v={profileLabel} />
      <Stat k="Connectors" v={String((kit?.required_connectors || []).length)} />

      <div style={{ marginTop: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)" }}>Agent handle <span style={{ color: "var(--red)" }}>*</span></span>
          <input
            type="text"
            value={agentHandle}
            onChange={(e) => setAgentHandle(e.target.value.replace(/\s+/g, "_"))}
            disabled={hasAgent}
            placeholder="e.g. ada-trader"
            maxLength={32}
            style={{
              width: "100%",
              background: hasAgent ? "var(--bg-card)" : "var(--bg-input)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "8px 10px",
              color: "var(--text-1)",
              fontSize: 13,
              outline: "none",
            }}
          />
          {hasAgent
            ? <span style={{ fontSize: 11, color: "var(--text-2)" }}>You already have an agent — this Kit attaches to it.</span>
            : <span style={{ fontSize: 11, color: "var(--text-2)" }}>3–32 chars, lowercase + underscores. Locked once registered.</span>}
        </label>
      </div>

      <details style={{ marginTop: 14, fontSize: 12 }}>
        <summary style={{ cursor: "pointer", color: "var(--text-2)" }}>Show preset values</summary>
        <pre style={{
          marginTop: 8,
          padding: 10,
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          fontSize: 11.5,
          overflow: "auto",
          color: "var(--text-1)",
        }}>{JSON.stringify(presets, null, 2)}</pre>
      </details>

      {error && <div style={{ ...errorStyle, marginTop: 14 }}>{error}</div>}
      {!connected && (
        <div style={{ ...hintStyle, marginTop: 14 }}>
          <AlertTriangle size={13} /> Connect a wallet to deploy.
          <button type="button" onClick={showModal} style={{ ...primaryBtn, marginLeft: 8 }}>Connect wallet</button>
        </div>
      )}
      {deploymentId && (
        <div style={{ ...hintStyle, marginTop: 14, color: "var(--green)", borderColor: "rgba(0,210,106,0.4)", background: "rgba(0,210,106,0.06)" }}>
          <Check size={13} /> Deployed (id #{deploymentId}). Redirecting to your agents…
        </div>
      )}

      <FundFirstMission
        slug={slug}
        kit={kit}
        presets={presets}
        connected={connected}
        showModal={showModal}
      />
    </div>
  );
}

// ── Optional: fund a first mission via PingPay ──
// Sits below the deploy CTA on the review step. Two payment options:
// PingPay (default — fiat / card / USDC) and NEAR wallet (advanced —
// for crypto-native buyers who already hold NEAR). The NEAR-wallet
// option points the buyer at the missions surface that owns the
// direct-to-contract create_mission flow, rather than re-implementing
// it inline (the wizard's contract today is "deploy a kit", not
// "post a mission" — keeping mission creation on /missions/create
// avoids tangling the two flows).
function FundFirstMission({ slug, kit, presets, connected, showModal }) {
  const [escrow, setEscrow]       = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr]             = useState(null);
  const showNigeriaNote           = isLikelyNigerian();

  const handlePingPay = useCallback(async () => {
    setErr(null);
    if (!connected) { showModal?.(); return; }
    const usd = Number(escrow);
    if (!Number.isFinite(usd) || usd <= 0) {
      setErr("Enter the amount you want to fund the mission with.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await apiFetch(`/api/payments/pingpay/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mission_template_slug: kit?.default_mission_template || null,
          kit_slug: slug,
          inputs_json: presets || {},
          escrow_amount_usd: usd,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not start checkout");
      if (!j.sessionUrl) throw new Error("No sessionUrl returned");
      // Drop a cookie-free hint so the success page knows which session
      // to poll without leaking the id through the URL only.
      try {
        sessionStorage.setItem(
          `pingpay:last_session`,
          JSON.stringify({ sessionId: j.sessionId, pendingMissionId: j.pending_mission_id, kitSlug: slug }),
        );
      } catch { /* private mode → ignored */ }
      window.location.assign(j.sessionUrl);
    } catch (e) {
      setErr(e?.message || "PingPay checkout failed");
    } finally {
      setSubmitting(false);
    }
  }, [connected, showModal, escrow, kit, slug, presets]);

  return (
    <div style={{ ...cardStyle, marginTop: 18 }}>
      <h2 style={cardTitleStyle}>
        <CreditCard size={13} style={{ marginRight: 6, verticalAlign: "-2px" }} />
        Fund a first mission (optional)
      </h2>
      <p style={muted}>
        Set how much you want to escrow. Your agent picks up the work
        as soon as the mission goes live on-chain.
      </p>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-1)" }}>Escrow amount (USD)</span>
        <input
          type="number"
          inputMode="decimal"
          min="1"
          step="1"
          value={escrow}
          onChange={(e) => setEscrow(e.target.value)}
          placeholder="e.g. 25"
          style={{
            width: "100%",
            background: "var(--bg-input)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "8px 10px",
            color: "var(--text-1)",
            fontSize: 13,
            outline: "none",
          }}
        />
        <span style={{ fontSize: 11, color: "var(--text-2)" }}>
          Fees: 0.75% PingPay + 0.0001% NEAR Intents. The 5% platform fee is taken from the payout when the mission is approved.
        </span>
      </label>

      {showNigeriaNote && (
        <div style={{ ...hintStyle, marginTop: 12, background: "rgba(245, 158, 11, 0.08)", borderColor: "rgba(245, 158, 11, 0.3)" }}>
          <AlertTriangle size={13} />
          <span style={{ fontSize: 11.5 }}>
            Nigeria: PingPay only supports crypto funding here today. Naira card and bank
            funding via a separate PSP is on the roadmap.
          </span>
        </div>
      )}

      {err && <div style={{ ...errorStyle, marginTop: 12 }}>{err}</div>}

      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={handlePingPay}
          disabled={submitting}
          style={{ ...primaryBtn, opacity: submitting ? 0.6 : 1 }}
        >
          {submitting
            ? <><Loader2 size={13} style={{ animation: "kw-spin 0.9s linear infinite" }} /> Starting checkout…</>
            : <><CreditCard size={13} /> Pay with PingPay</>}
        </button>
        <Link
          href={`/missions/create?kit=${encodeURIComponent(slug)}`}
          style={{ ...ghostBtn, textDecoration: "none" }}
          title="Sign create_mission directly with your NEAR wallet"
        >
          <Wallet size={13} /> Pay with NEAR wallet (advanced)
        </Link>
      </div>
    </div>
  );
}

/* ── UI helpers ───────────────────────────────────────────────────── */

function ProgressNav({ step, onJump }) {
  return (
    <div style={{
      display: "flex",
      gap: 8,
      padding: 8,
      background: "var(--bg-card)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      margin: "12px 0 18px",
      overflowX: "auto",
    }}>
      {STEPS.map((s, i) => {
        const active = i === step;
        const done = i < step;
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onJump(i)}
            style={{
              flex: 1,
              minWidth: 120,
              padding: "8px 10px",
              borderRadius: 9,
              border: `1px solid ${active ? "var(--accent-border)" : "transparent"}`,
              background: active ? "var(--accent-dim)" : "transparent",
              color: active ? "var(--accent)" : (done ? "var(--text-1)" : "var(--text-2)"),
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{
              width: 18, height: 18, borderRadius: 99,
              border: `1px solid ${done ? "var(--green)" : (active ? "var(--accent-border)" : "var(--border)")}`,
              background: done ? "var(--green)" : "transparent",
              color: "#000",
              fontSize: 10, fontWeight: 800,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>{done ? <Check size={10} /> : i + 1}</span>
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

function Stat({ k, v }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px dashed var(--border)" }}>
      <span style={{ fontSize: 11.5, color: "var(--text-2)" }}>{k}</span>
      <span style={{ fontSize: 12.5, color: "var(--text-1)", fontWeight: 700 }}>{v}</span>
    </div>
  );
}

function seedPresets(kit, search) {
  // If IronGuide attached this session and the URL carries presets in
  // the query string, hydrate from there. The concierge backend does
  // NOT pass presets via URL today (kept off the URL to avoid leaking
  // PII into history), but the deploy wizard could be called by other
  // surfaces that do — staying schema-tolerant is cheap.
  const out = {};
  const props = kit?.preset_config_schema_json?.properties
            || kit?.preset_config_schema_json
            || {};
  for (const [key, def] of Object.entries(props)) {
    const fromQuery = search?.get?.(`preset.${key}`);
    if (fromQuery !== null && fromQuery !== undefined) {
      out[key] = def?.type === "boolean"
        ? fromQuery === "true"
        : (def?.type === "number" || def?.type === "integer" ? Number(fromQuery) : fromQuery);
    } else if (def?.default !== undefined) {
      out[key] = def.default;
    }
  }
  return out;
}

/* ── Styles ───────────────────────────────────────────────────────── */

const pageStyle = { minHeight: "100vh", background: "var(--bg-app)" };
const containerStyle = { maxWidth: 920, margin: "0 auto", padding: "32px 20px 64px" };
const topBarStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-end",
  gap: 16,
  flexWrap: "wrap",
  marginBottom: 6,
};
const cardStyle = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 14,
  padding: 22,
};
const cardTitleStyle = { fontSize: 14, fontWeight: 800, color: "var(--text-1)", margin: "0 0 10px" };
const muted = { fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55, display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" };
const hintStyle = {
  display: "flex", alignItems: "center", gap: 8,
  padding: "10px 12px",
  borderRadius: 9,
  background: "rgba(168, 85, 247, 0.06)",
  border: "1px solid rgba(168, 85, 247, 0.3)",
  color: "var(--text-1)",
  fontSize: 12,
  marginBottom: 12,
};
const primaryBtn = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "9px 14px",
  borderRadius: 10,
  background: "linear-gradient(135deg, #a855f7, #60a5fa)",
  color: "#fff",
  fontSize: 12.5, fontWeight: 700,
  border: "1px solid var(--accent-border)",
  cursor: "pointer",
};
const ghostBtn = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "9px 12px",
  borderRadius: 10,
  background: "var(--bg-card)",
  color: "var(--text-1)",
  fontSize: 12.5, fontWeight: 600,
  border: "1px solid var(--border)",
  cursor: "pointer",
  textDecoration: "none",
};
const errorStyle = {
  padding: 12, borderRadius: 9,
  background: "rgba(255, 77, 77, 0.08)",
  border: "1px solid rgba(255, 77, 77, 0.3)",
  color: "var(--red)",
  fontSize: 12,
};
const emptyStyle = {
  padding: 40, textAlign: "center",
  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
  color: "var(--text-2)", fontSize: 13,
};
const linkStyle = { color: "var(--accent)", textDecoration: "none", fontWeight: 700 };
