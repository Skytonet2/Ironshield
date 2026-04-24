"use client";
// Skills marketplace — browse all skills, install into your agent, create new
// skills as an author. Install is free in pre-token mode; `price_yocto` is
// informational until the paid-install flow ships in the marketplace v2 slice.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Zap, Plus, Search, ChevronLeft, Check, X as XIcon, Package } from "lucide-react";
import { Section, Badge, Btn } from "./Primitives";
import { useTheme, useWallet } from "@/lib/contexts";
import useAgent from "@/hooks/useAgent";

const fmt = (n) => Number(n ?? 0).toLocaleString();

function yoctoToNearShort(y) {
  if (!y || y === "0") return "Free";
  try {
    const b = BigInt(y);
    const whole = b / 1_000_000_000_000_000_000_000_000n;
    return `${whole} NEAR`;
  } catch { return "—"; }
}

export default function SkillsMarketplacePage({ openWallet }) {
  const t = useTheme();
  const violet = "#a855f7";
  const { connected, address } = useWallet();
  const {
    listSkills, getInstalledSkills, createSkill, installSkill, uninstallSkill,
    profile: agentProfile,
  } = useAgent();

  const [skills, setSkills]         = useState([]);
  const [installed, setInstalled]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [query, setQuery]           = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy]             = useState(null); // skill_id being mutated

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, mine] = await Promise.all([
        listSkills({ limit: 100, offset: 0 }),
        connected && agentProfile ? getInstalledSkills(address) : Promise.resolve([]),
      ]);
      setSkills(Array.isArray(list) ? list : []);
      setInstalled(Array.isArray(mine) ? mine : []);
    } catch (err) {
      console.warn("skills refresh:", err?.message || err);
    } finally {
      setLoading(false);
    }
  }, [listSkills, getInstalledSkills, connected, address, agentProfile]);

  useEffect(() => { refresh(); }, [refresh]);

  const installedIds = useMemo(() => new Set(installed.map((s) => s.id)), [installed]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((s) =>
      (s.name || "").toLowerCase().includes(q) ||
      (s.description || "").toLowerCase().includes(q) ||
      (s.author || "").toLowerCase().includes(q)
    );
  }, [skills, query]);

  const handleInstall = async (skillId) => {
    setBusy(skillId);
    try {
      await installSkill(skillId);
      await refresh();
    } catch (err) {
      alert("Install failed: " + (err?.message || err));
    } finally {
      setBusy(null);
    }
  };

  const handleUninstall = async (skillId) => {
    setBusy(skillId);
    try {
      await uninstallSkill(skillId);
      await refresh();
    } catch (err) {
      alert("Uninstall failed: " + (err?.message || err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section style={{ paddingTop: 100 }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <Link href="/earn" style={{ color: t.textMuted, fontSize: 12, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <ChevronLeft size={13} /> Earn
        </Link>
        {connected && agentProfile && (
          <button onClick={() => setShowCreate(true)} style={{
            background: `linear-gradient(135deg, ${violet}, ${t.accent})`,
            border: "none", borderRadius: 10, padding: "8px 14px",
            fontSize: 12, fontWeight: 700, color: "#fff", cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 6,
            boxShadow: `0 8px 22px ${violet}44`,
          }}>
            <Plus size={13} /> Create skill
          </button>
        )}
      </div>

      {/* Hero */}
      <div style={{
        background: `linear-gradient(135deg, ${violet}1a, ${t.bgCard})`,
        border: `1px solid ${t.border}`, borderRadius: 16,
        padding: "26px 28px", marginBottom: 20,
      }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: `${violet}22`, color: violet, padding: "3px 10px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 }}>
          <Zap size={11} /> Skills Marketplace
        </div>
        <h1 style={{ fontSize: "clamp(24px, 3vw, 32px)", fontWeight: 800, color: t.white, margin: "0 0 8px", letterSpacing: -0.4 }}>
          Install{" "}
          <span style={{
            background: `linear-gradient(90deg, ${violet}, ${t.accent})`,
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
          }}>
            skills
          </span>{" "}into your agent
        </h1>
        <p style={{ fontSize: 14, color: t.textMuted, lineHeight: 1.6, maxWidth: 620 }}>
          Skills extend your agent with reusable capabilities — airdrop hunting, alpha scouting,
          content generation, trading. Authors publish skills; you install the ones your agent should use.
        </p>
      </div>

      {/* Search */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: t.bgCard, border: `1px solid ${t.border}`,
          borderRadius: 10, padding: "9px 14px", width: 340, maxWidth: "100%",
        }}>
          <Search size={13} color={t.textDim} />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skills…"
            style={{ background: "none", border: "none", outline: "none", color: t.text, fontSize: 13, flex: 1 }}
          />
        </div>
        <div style={{ fontSize: 12, color: t.textMuted, display: "inline-flex", alignItems: "center", gap: 10 }}>
          <span>{loading ? "Loading…" : `${filtered.length} skill${filtered.length === 1 ? "" : "s"}`}</span>
          {connected && agentProfile && (
            <span style={{ color: violet }}>
              · {installed.length} installed
            </span>
          )}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ fontSize: 13, color: t.textDim, textAlign: "center", padding: 40 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{
          background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
          padding: 44, textAlign: "center",
        }}>
          <Package size={36} color={t.textDim} style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: t.white, marginBottom: 6 }}>
            {query ? "No skills match that search" : "No skills published yet"}
          </div>
          <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 18, lineHeight: 1.55 }}>
            {query
              ? "Try different terms or clear the search."
              : "Be the first — skills are free to publish and take under a minute."}
          </div>
          {!query && connected && agentProfile && (
            <Btn primary onClick={() => setShowCreate(true)}><Plus size={13} /> Create skill</Btn>
          )}
          {!query && !connected && openWallet && (
            <Btn primary onClick={openWallet}><Plus size={13} /> Connect to create</Btn>
          )}
        </div>
      ) : (
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 14,
        }}>
          {filtered.map((sk) => (
            <SkillCard
              key={sk.id} skill={sk} t={t} violet={violet}
              isInstalled={installedIds.has(sk.id)}
              canInstall={connected && Boolean(agentProfile)}
              isBusy={busy === sk.id}
              onInstall={() => handleInstall(sk.id)}
              onUninstall={() => handleUninstall(sk.id)}
              openWallet={openWallet}
              hasAgent={Boolean(agentProfile)}
            />
          ))}
        </div>
      )}

      {/* Create skill modal */}
      {showCreate && (
        <CreateSkillModal
          t={t} violet={violet}
          createSkill={createSkill}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh(); }}
        />
      )}
    </Section>
  );
}

function SkillCard({ skill, t, violet, isInstalled, canInstall, isBusy, onInstall, onUninstall, openWallet, hasAgent }) {
  return (
    <div style={{
      background: t.bgCard, border: `1px solid ${isInstalled ? violet + "55" : t.border}`,
      borderRadius: 14, padding: "18px 20px",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{
          background: `${violet}22`, borderRadius: 10, width: 38, height: 38,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          <Zap size={18} color={violet} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: t.white }}>{skill.name}</span>
            {isInstalled && <Badge color={violet}>Installed</Badge>}
          </div>
          <div style={{ fontSize: 10.5, color: t.textDim, marginTop: 2 }}>
            by {skill.author}
          </div>
        </div>
      </div>

      <div style={{ fontSize: 12.5, color: t.textMuted, lineHeight: 1.55, minHeight: 38 }}>
        {skill.description || <span style={{ fontStyle: "italic", color: t.textDim }}>No description</span>}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: "auto" }}>
        <div style={{ fontSize: 11, color: t.textMuted, display: "inline-flex", alignItems: "center", gap: 10 }}>
          <span>{yoctoToNearShort(skill.price_yocto)}</span>
          <span>·</span>
          <span>{fmt(skill.install_count)} installs</span>
        </div>
        {canInstall ? (
          isInstalled ? (
            <button onClick={onUninstall} disabled={isBusy} style={{
              background: "transparent", border: `1px solid ${t.border}`, borderRadius: 8,
              padding: "6px 12px", fontSize: 11, color: t.textMuted, cursor: isBusy ? "wait" : "pointer",
              fontWeight: 700,
            }}>
              {isBusy ? "…" : "Uninstall"}
            </button>
          ) : (
            <button onClick={onInstall} disabled={isBusy} style={{
              background: `linear-gradient(135deg, ${violet}, ${t.accent})`,
              border: "none", borderRadius: 8, padding: "6px 14px",
              fontSize: 11, fontWeight: 700, color: "#fff", cursor: isBusy ? "wait" : "pointer",
              boxShadow: `0 4px 12px ${violet}44`,
            }}>
              {isBusy ? "Installing…" : "Install"}
            </button>
          )
        ) : (
          <button onClick={hasAgent ? undefined : openWallet} style={{
            background: "transparent", border: `1px solid ${t.border}`, borderRadius: 8,
            padding: "6px 12px", fontSize: 11, color: t.textDim, cursor: "pointer",
          }}
            title={hasAgent ? "Connect wallet" : "Create an agent first"}>
            {hasAgent ? "Connect" : "Needs agent"}
          </button>
        )}
      </div>
    </div>
  );
}

function CreateSkillModal({ t, violet, onClose, onCreated, createSkill }) {
  const [name, setName]               = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice]             = useState("0");
  const [stage, setStage]             = useState("compose"); // compose | signing | error
  const [error, setError]             = useState("");

  const handleCreate = async () => {
    const n = name.trim();
    const d = description.trim();
    if (!n) { setError("Name required"); return; }
    if (n.length > 48) { setError("Name must be ≤48 chars"); return; }
    if (d.length > 240) { setError("Description must be ≤240 chars"); return; }
    setStage("signing");
    setError("");
    try {
      // price entered as NEAR, converted to yocto here
      const priceNear = Number(price || "0");
      const priceYocto = BigInt(Math.round(priceNear * 1e6)) * 1_000_000_000_000_000_000n;
      await createSkill({ name: n, description: d, priceYocto: priceYocto.toString() });
      onCreated?.();
    } catch (err) {
      setError(err?.message || String(err));
      setStage("error");
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, backdropFilter: "blur(8px)",
    }}>
      <div style={{
        background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 20,
        padding: 28, width: 520, maxWidth: "92vw",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: t.white, display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Zap size={18} color={violet} /> Create a skill
            </div>
            <div style={{ fontSize: 12, color: t.textMuted, marginTop: 4, lineHeight: 1.55 }}>
              Publish a capability other agents can install. Free to author.
            </div>
          </div>
          <button onClick={onClose} style={{
            background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 8,
            width: 30, height: 30, cursor: "pointer", color: t.textMuted,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <XIcon size={13} />
          </button>
        </div>

        <div style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6 }}>
          Name <span style={{ color: t.textDim, fontWeight: 400 }}>({name.length}/48)</span>
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 48))}
          placeholder="e.g. Airdrop Hunter"
          style={{
            width: "100%", background: t.bgSurface, border: `1px solid ${t.border}`,
            borderRadius: 10, padding: "10px 12px", color: t.text, fontSize: 13,
            outline: "none", boxSizing: "border-box", marginBottom: 14,
          }}
        />

        <div style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6 }}>
          Description <span style={{ color: t.textDim, fontWeight: 400 }}>({description.length}/240)</span>
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 240))}
          rows={4}
          placeholder="What does this skill do? What can an agent with it accomplish?"
          style={{
            width: "100%", background: t.bgSurface, border: `1px solid ${t.border}`,
            borderRadius: 10, padding: "10px 12px", color: t.text, fontSize: 13,
            outline: "none", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box",
            marginBottom: 14, lineHeight: 1.55,
          }}
        />

        <div style={{ fontSize: 12, fontWeight: 600, color: t.textMuted, marginBottom: 6 }}>
          Install price (NEAR) — set 0 for free
        </div>
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="0"
          inputMode="decimal"
          style={{
            width: "100%", background: t.bgSurface, border: `1px solid ${t.border}`,
            borderRadius: 10, padding: "10px 12px", color: t.text, fontSize: 13,
            outline: "none", boxSizing: "border-box", marginBottom: 6, fontFamily: "'JetBrains Mono', monospace",
          }}
        />
        <div style={{ fontSize: 11, color: t.textDim, marginBottom: 16 }}>
          Pricing is informational for now. Paid installs activate with the marketplace v2 slice.
        </div>

        {error && (
          <div style={{
            background: `${t.red}14`, border: `1px solid ${t.red}44`, borderRadius: 8,
            padding: "10px 12px", marginBottom: 14, fontSize: 12, color: t.red, wordBreak: "break-word",
          }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <Btn onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>Cancel</Btn>
          <Btn primary onClick={handleCreate}
            disabled={stage === "signing" || !name.trim()}
            style={{ flex: 1, justifyContent: "center" }}>
            {stage === "signing" ? "Publishing…" : <><Check size={13} /> Publish</>}
          </Btn>
        </div>
      </div>
    </div>
  );
}
