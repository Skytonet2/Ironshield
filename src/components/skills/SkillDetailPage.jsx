"use client";
// /skills/view?id=<n> — full detail for one on-chain skill listing.
//
// Shows everything that's visible on a marketplace card plus the
// content the cards omit: full description, tag chips, runtime
// binding (built-in / HTTP / metadata-only), author profile link,
// and per-runtime parameter schema for built-ins.
//
// Install button mirrors the marketplace cards but only enables when
// the viewer has a connected wallet + registered agent + the skill
// isn't already installed for them.

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Loader2, CheckCircle2, Package, Tag, Globe, Settings, Zap,
  ExternalLink, ShieldCheck, Box, Wallet, AlertCircle,
} from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import useAgent from "@/hooks/useAgent";
import useSkillRegistry from "@/hooks/useSkillRegistry";

function formatNear(yocto) {
  try {
    const v = BigInt(yocto || 0);
    if (v === 0n) return "Free";
    const whole = v / 1_000_000_000_000_000_000_000_000n;
    const frac  = v % 1_000_000_000_000_000_000_000_000n;
    if (frac === 0n) return `${whole} NEAR`;
    const fracStr = frac.toString().padStart(24, "0").slice(0, 4).replace(/0+$/, "");
    return `${whole}${fracStr ? "." + fracStr : ""} NEAR`;
  } catch { return "—"; }
}

function timeAgo(nsStr) {
  if (!nsStr) return "—";
  try {
    const ms = Number(BigInt(nsStr) / 1_000_000n);
    const diff = Date.now() - ms;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000)   return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000)  return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  } catch { return "—"; }
}

function shortAddr(a) {
  if (!a) return "";
  return a.length > 24 ? `${a.slice(0, 12)}…${a.slice(-8)}` : a;
}

/** Classify a skill's runtime binding from its metadata.category:
 *    "builtin:<id>"   → first-party module on our orchestrator
 *    "http:<url>"     → author-hosted endpoint we POST to
 *    anything else    → metadata-only listing (not yet runnable)
 */
function classifyRuntime(category) {
  if (!category) return { kind: "metadata" };
  if (category.startsWith("builtin:")) return { kind: "builtin", key: category.slice(8) };
  if (category.startsWith("http:")) {
    // category is "http:" + raw URL (which starts with http(s)://). Strip
    // exactly the prefix once.
    return { kind: "http", url: category.replace(/^http:/, "") };
  }
  return { kind: "metadata" };
}

/* ─────────────── Page ─────────────── */

export default function SkillDetailPage() {
  const t = useTheme();
  const { connected, address, showModal } = useWallet?.() || {};
  const agent = useAgent();
  const registry = useSkillRegistry();

  // Pin the hook so our load effect doesn't refire on every wallet
  // re-render — same pattern useAgentConnections uses.
  const agentRef = useRef(agent);
  agentRef.current = agent;

  // Resolve skill id from query string. Static export friendly.
  const skillId = useMemo(() => {
    if (typeof window === "undefined") return null;
    const sp = new URLSearchParams(window.location.search);
    const raw = sp.get("id");
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }, []);

  const [skill, setSkill]       = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [installed, setInstalled] = useState([]);
  const [installing, setInstalling] = useState(false);
  const [error, setError]       = useState(null);
  const [success, setSuccess]   = useState(null);

  useEffect(() => {
    if (skillId == null) { setLoading(false); setError("No skill specified."); return; }
    let alive = true;
    (async () => {
      const a = agentRef.current;
      try {
        const [s, m, inst] = await Promise.all([
          a.getSkill?.(skillId).catch(() => null),
          a.getSkillMetadata?.(skillId).catch(() => null),
          address
            ? a.getInstalledSkills?.(address).catch(() => [])
            : Promise.resolve([]),
        ]);
        if (!alive) return;
        if (!s) { setError("Skill not found."); }
        setSkill(s || null);
        setMetadata(m || null);
        setInstalled(Array.isArray(inst) ? inst : []);
      } catch (e) {
        if (alive) setError(e?.message || "Failed to load skill");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [skillId, address]);

  const isInstalled = installed.some(s => Number(s.id) === Number(skillId));
  const runtime = classifyRuntime(metadata?.category);
  const builtinDef = runtime.kind === "builtin"
    ? registry.skills.find(r => r.id === runtime.key) || null
    : null;

  const handleInstall = useCallback(async () => {
    if (!connected) { showModal?.(); return; }
    if (!skill) return;
    setInstalling(true);
    setError(null);
    setSuccess(null);
    try {
      // Same agent-profile gate the marketplace enforces. The contract
      // would reject the install_skill call anyway; doing the check here
      // gives a clean redirect to the launchpad instead of a wallet
      // panic.
      const profile = await agentRef.current.fetchProfile?.();
      if (!profile) {
        if (typeof window !== "undefined") {
          window.alert("Register an agent before installing skills. Taking you to the launchpad.");
          window.location.href = "/agents/create";
        }
        return;
      }
      await agentRef.current.installSkill?.(skill.id, String(skill.price_yocto || "0"));
      setSuccess("Installed.");
      const inst = await agentRef.current.getInstalledSkills?.(address).catch(() => []);
      setInstalled(Array.isArray(inst) ? inst : []);
    } catch (e) {
      setError(e?.message || "Install failed");
    } finally {
      setInstalling(false);
    }
  }, [connected, showModal, skill, address]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, color: t.textMuted, fontSize: 13 }}>
        <Loader2 size={14} style={{ animation: "ma-spin 0.9s linear infinite" }} /> Loading skill…
      </div>
    );
  }
  if (error || !skill) {
    return (
      <div>
        <BackLink t={t} />
        <div style={{
          padding: 30, marginTop: 14, textAlign: "center",
          background: t.bgCard, border: `1px dashed ${t.border}`, borderRadius: 14,
        }}>
          <AlertCircle size={28} color={t.amber} style={{ marginBottom: 10 }} />
          <div style={{ fontSize: 15, fontWeight: 800, color: t.white, marginBottom: 6 }}>
            {error || "Skill not found"}
          </div>
          <div style={{ fontSize: 12.5, color: t.textMuted }}>
            Check the link or browse the <Link href="/skills" style={{ color: t.accent, textDecoration: "none", fontWeight: 600 }}>marketplace</Link>.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <BackLink t={t} />

      {/* Hero */}
      <header style={{
        marginTop: 14, marginBottom: 18,
        background: t.bgCard, border: `1px solid ${t.border}`,
        borderRadius: 16, padding: 24,
        display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 18, alignItems: "center",
      }} className="ix-skill-hero">
        <span aria-hidden style={{
          width: 72, height: 72, flexShrink: 0, borderRadius: 14,
          background: metadata?.image_url
            ? `url("${metadata.image_url}") center/cover, linear-gradient(135deg, #a855f7, ${t.accent})`
            : `linear-gradient(135deg, #a855f7, ${t.accent})`,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          color: "#fff",
        }}>
          {!metadata?.image_url && <Package size={30} />}
        </span>

        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: t.white, letterSpacing: -0.4 }}>
              {skill.name}
            </h1>
            {metadata?.verified && (
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                background: "rgba(59,130,246,0.18)", color: "#60a5fa",
                display: "inline-flex", alignItems: "center", gap: 4,
              }}>
                <CheckCircle2 size={11} /> Verified
              </span>
            )}
            <RuntimeBadge t={t} runtime={runtime} />
          </div>
          <p style={{ margin: "6px 0 8px", fontSize: 14, color: t.text, lineHeight: 1.5 }}>
            {skill.description || "No description provided."}
          </p>
          <div style={{ fontSize: 11.5, color: t.textDim, fontFamily: "var(--font-jetbrains-mono), monospace" }}>
            Skill #{skill.id} · by {shortAddr(skill.author)}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }} className="ix-skill-cta">
          <div style={{ fontSize: 22, fontWeight: 800, color: t.white }}>{formatNear(skill.price_yocto)}</div>
          {isInstalled ? (
            <Link href="/skills/mine" style={{
              padding: "10px 18px",
              background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 10,
              fontSize: 12.5, fontWeight: 700, color: "#10b981", textDecoration: "none",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}>
              <CheckCircle2 size={12} /> Installed
            </Link>
          ) : (
            <button type="button" onClick={handleInstall} disabled={installing}
                    style={{
                      padding: "10px 18px",
                      background: installing ? t.bgSurface : `linear-gradient(135deg, #a855f7, ${t.accent})`,
                      border: installing ? `1px solid ${t.border}` : "none",
                      borderRadius: 10,
                      fontSize: 12.5, fontWeight: 700,
                      color: installing ? t.textMuted : "#fff",
                      cursor: installing ? "wait" : "pointer",
                      display: "inline-flex", alignItems: "center", gap: 6,
                      boxShadow: installing ? "none" : "0 10px 24px rgba(168,85,247,0.3)",
                    }}>
              {installing
                ? <><Loader2 size={12} style={{ animation: "ma-spin 0.9s linear infinite" }} /> Installing…</>
                : "Install"}
            </button>
          )}
          <div style={{ fontSize: 11, color: t.textDim }}>
            {Number(skill.install_count || 0)} installs
          </div>
        </div>
      </header>

      {success && <Banner t={t} kind="ok">{success}</Banner>}
      {error   && <Banner t={t} kind="err">{error}</Banner>}
      {!connected && (
        <Banner t={t} kind="warn">
          Connect a wallet to install this skill —
          <button type="button" onClick={() => showModal?.()} style={{
            background: "transparent", border: "none", padding: 0, marginLeft: 4,
            color: t.accent, fontWeight: 700, cursor: "pointer", fontSize: "inherit",
          }}>open the wallet picker</button>.
        </Banner>
      )}

      {/* Detail grid */}
      <div style={{
        display: "grid", gap: 14, gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)",
      }} className="ix-skill-grid">
        <Section t={t} icon={Tag} title="About this skill">
          <p style={{ margin: 0, fontSize: 13, color: t.text, lineHeight: 1.65 }}>
            {skill.description || "No description provided."}
          </p>

          {metadata?.tags?.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
              {metadata.tags.map(tag => (
                <span key={tag} style={{
                  fontSize: 11, padding: "3px 10px", borderRadius: 999,
                  background: t.bgSurface, border: `1px solid ${t.border}`,
                  color: t.textMuted,
                }}>#{tag}</span>
              ))}
            </div>
          )}

          {metadata?.category && (
            <div style={{
              marginTop: 14, padding: "10px 12px",
              background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 10,
              fontSize: 12, color: t.textMuted, fontFamily: "var(--font-jetbrains-mono), monospace",
            }}>
              category: <span style={{ color: t.text }}>{metadata.category}</span>
            </div>
          )}
        </Section>

        <Section t={t} icon={Zap} title="Runtime">
          <RuntimeDetails t={t} runtime={runtime} builtinDef={builtinDef} skill={skill} />
        </Section>

        {builtinDef?.params?.length > 0 && (
          <Section t={t} icon={Settings} title="Parameters" wide>
            <p style={{ margin: "0 0 10px", fontSize: 12.5, color: t.textMuted, lineHeight: 1.5 }}>
              Defaults shown below. You'll be able to override them when you wire this skill into an automation rule.
            </p>
            <div style={{ display: "grid", gap: 6 }}>
              {builtinDef.params.map(p => (
                <div key={p.key} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "8px 10px",
                  background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8,
                  fontSize: 12.5,
                }}>
                  <code style={{
                    fontFamily: "var(--font-jetbrains-mono), monospace",
                    color: t.white, fontWeight: 700, minWidth: 100,
                  }}>{p.key}</code>
                  <span style={{
                    fontSize: 11, padding: "2px 6px", borderRadius: 4,
                    background: t.bgCard, border: `1px solid ${t.border}`,
                    color: t.textMuted,
                  }}>{p.type}</span>
                  <span style={{ color: t.textDim, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.hint || (p.required ? "Required" : `Default: ${Array.isArray(p.default) ? p.default.join(", ") : (p.default ?? "—")}`)}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section t={t} icon={Box} title="Listing">
          <Row t={t} k="Author"        v={shortAddr(skill.author)} />
          <Row t={t} k="Skill ID"      v={`#${skill.id}`} />
          <Row t={t} k="Price"         v={formatNear(skill.price_yocto)} />
          <Row t={t} k="Installs"      v={Number(skill.install_count || 0)} />
          <Row t={t} k="Listed"        v={timeAgo(skill.created_at)} />
          <Row t={t} k="Verified"      v={metadata?.verified ? "Yes" : "No"} />
        </Section>
      </div>

      <style jsx global>{`
        @keyframes ma-spin { to { transform: rotate(360deg); } }
        @media (max-width: 880px) {
          .ix-skill-grid { grid-template-columns: 1fr !important; }
          .ix-skill-hero { grid-template-columns: auto 1fr !important; }
          .ix-skill-cta  { grid-column: 1 / -1; align-items: flex-start !important; flex-direction: row !important; }
        }
      `}</style>
    </div>
  );
}

/* ─────────────── Helpers ─────────────── */

function BackLink({ t }) {
  return (
    <Link href="/skills" style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      fontSize: 12.5, color: t.textMuted, textDecoration: "none",
    }}>
      <ArrowLeft size={13} /> Back to marketplace
    </Link>
  );
}

function Section({ t, icon: Icon, title, wide, children }) {
  return (
    <section style={{
      gridColumn: wide ? "1 / -1" : undefined,
      background: t.bgCard, border: `1px solid ${t.border}`,
      borderRadius: 14, padding: 18,
    }}>
      <h2 style={{
        margin: "0 0 12px",
        fontSize: 14, fontWeight: 800, color: t.white,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <Icon size={14} color={t.accent} /> {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ t, k, v }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      fontSize: 12.5, padding: "5px 0",
      borderBottom: `1px solid ${t.border}33`,
    }}>
      <span style={{ color: t.textMuted }}>{k}</span>
      <span style={{
        color: t.white, fontFamily: "var(--font-jetbrains-mono), monospace",
        fontSize: 12, fontWeight: 600,
      }}>{v}</span>
    </div>
  );
}

function Banner({ t, kind, children }) {
  const palette = kind === "ok"
    ? { bg: "rgba(16,185,129,0.12)", color: "#10b981" }
    : kind === "warn"
    ? { bg: "rgba(245,158,11,0.12)", color: "#f59e0b" }
    : { bg: "rgba(239,68,68,0.12)", color: "#fca5a5" };
  return (
    <div style={{
      padding: "10px 14px", marginBottom: 14, borderRadius: 10,
      border: `1px solid ${t.border}`,
      background: palette.bg, color: palette.color,
      fontSize: 12.5,
    }}>{children}</div>
  );
}

function RuntimeBadge({ t, runtime }) {
  if (runtime.kind === "builtin") {
    return (
      <span style={{
        fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
        background: "rgba(168,85,247,0.18)", color: "#c4b8ff",
        display: "inline-flex", alignItems: "center", gap: 4,
      }}>
        <ShieldCheck size={11} /> Built-in
      </span>
    );
  }
  if (runtime.kind === "http") {
    return (
      <span style={{
        fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
        background: "rgba(59,130,246,0.18)", color: "#60a5fa",
        display: "inline-flex", alignItems: "center", gap: 4,
      }}>
        <Globe size={11} /> Author-hosted
      </span>
    );
  }
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
      background: "rgba(245,158,11,0.18)", color: "#f59e0b",
      display: "inline-flex", alignItems: "center", gap: 4,
    }}>
      Metadata-only
    </span>
  );
}

function RuntimeDetails({ t, runtime, builtinDef, skill }) {
  const Common = ({ children }) => (
    <p style={{ margin: 0, fontSize: 12.5, color: t.textMuted, lineHeight: 1.55 }}>{children}</p>
  );

  if (runtime.kind === "builtin") {
    return (
      <>
        <Common>
          Runs in IronShield's orchestrator. Calls your connected agent for any LLM step — your framework, your privacy.
        </Common>
        <div style={{
          marginTop: 12, padding: "8px 10px",
          background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8,
          fontSize: 11.5, color: t.text,
          fontFamily: "var(--font-jetbrains-mono), monospace",
        }}>
          registry: <strong>{runtime.key}</strong>
          {builtinDef && <span style={{ color: t.textDim }}> · {builtinDef.title}</span>}
        </div>
      </>
    );
  }

  if (runtime.kind === "http") {
    return (
      <>
        <Common>
          Hosted by the skill's author at the URL below. We POST to <code>{`/run`}</code> with your params and a callback token; the server can call back through your connected framework.
        </Common>
        <a href={runtime.url} target="_blank" rel="noopener noreferrer"
           style={{
             display: "inline-flex", alignItems: "center", gap: 4,
             marginTop: 10, padding: "6px 10px",
             background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8,
             fontSize: 11.5, color: t.accent, textDecoration: "none",
             fontFamily: "var(--font-jetbrains-mono), monospace",
           }}>
          {runtime.url} <ExternalLink size={11} />
        </a>
      </>
    );
  }

  return (
    <Common>
      This skill is metadata-only — there's no executor bound to it yet. Authors can submit code to make it runnable; until then, installing keeps it on your shelf as a placeholder.
    </Common>
  );
}
