"use client";
// /docs/skills-catalog — rendered version of docs/skills-catalog.md.
// 200 plausible skills grouped by category, with search + status
// filters. Source data is parsed at build time from the markdown by
// scripts/build-skills-catalog.mjs into src/data/skillsCatalog.json
// so we don't pay a runtime markdown dep on every page view.

import { useMemo, useState } from "react";
import {
  BookOpen, Search, Filter, ExternalLink, Hash, Wallet, ChevronDown,
} from "lucide-react";
import { useTheme } from "@/lib/contexts";
import catalog from "@/data/skillsCatalog.json";

const STATUS_META = {
  green:  { dot: "🟢", label: "Buildable today",         color: "#10b981" },
  yellow: { dot: "🟡", label: "Needs one missing piece", color: "#eab308" },
  red:    { dot: "🔴", label: "Needs platform work",     color: "#ef4444" },
};

function StatusPill({ kind, t, compact = false }) {
  const meta = STATUS_META[kind];
  if (!meta) return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: compact ? "2px 6px" : "3px 8px",
      fontSize: compact ? 10 : 11, fontWeight: 700,
      color: meta.color, background: `${meta.color}1f`,
      border: `1px solid ${meta.color}3a`, borderRadius: 6,
      whiteSpace: "nowrap",
    }}>
      <span style={{ fontSize: compact ? 9 : 10 }}>{meta.dot}</span>
      {compact ? kind : meta.label}
    </span>
  );
}

function Code({ children, t }) {
  return (
    <code style={{
      fontFamily: "var(--font-jetbrains-mono), monospace",
      fontSize: 11.5,
      padding: "1px 5px",
      background: "rgba(168,85,247,0.12)", color: "#c4b8ff",
      borderRadius: 4, wordBreak: "break-word",
    }}>{children}</code>
  );
}

// Strip surrounding backticks from a parsed field; returns raw text
// for monospaced rendering.
function stripBackticks(s) {
  if (!s) return "";
  const m = s.match(/^`([\s\S]+)`$/);
  return m ? m[1] : s;
}

function SkillCard({ skill, t }) {
  const [open, setOpen] = useState(false);
  return (
    <article style={{
      padding: "14px 16px", borderRadius: 12,
      background: t.bgCard, border: `1px solid ${t.border}`,
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <header style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <code style={{
          fontFamily: "var(--font-jetbrains-mono), monospace",
          fontSize: 13, fontWeight: 700,
          color: t.white, padding: "3px 8px",
          background: "rgba(255,255,255,0.04)",
          border: `1px solid ${t.border}`, borderRadius: 6,
        }}>{skill.slug}</code>
        <StatusPill kind={skill.status?.kind} t={t} compact />
        <span style={{ marginLeft: "auto", fontSize: 12, color: t.textMuted, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <Wallet size={12} /> {skill.pricing.replace(/\.$/, "")}
        </span>
      </header>

      <p style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.55, margin: 0 }}>
        {skill.pitch}
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {skill.tags.map(tg => (
          <span key={tg} style={{
            fontSize: 10.5, padding: "1px 6px",
            color: t.textMuted, background: t.bgPanel || "rgba(255,255,255,0.03)",
            border: `1px solid ${t.border}`, borderRadius: 4,
          }}>{tg}</span>
        ))}
      </div>

      <button
        onClick={() => setOpen(o => !o)}
        style={{
          alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 4,
          padding: "2px 0", margin: 0,
          background: "transparent", border: "none", cursor: "pointer",
          color: t.accent, fontSize: 11.5, fontWeight: 600,
        }}>
        <ChevronDown size={12} style={{ transform: open ? "rotate(-180deg)" : "none", transition: "transform 0.15s" }} />
        {open ? "Hide" : "Show"} I/O + status
      </button>

      {open && (
        <div style={{
          marginTop: 4, padding: "10px 12px",
          background: "rgba(255,255,255,0.02)", border: `1px solid ${t.border}`,
          borderRadius: 8, display: "flex", flexDirection: "column", gap: 8,
        }}>
          <Field t={t} label="Inputs"     value={stripBackticks(skill.inputs)}  monospace />
          <Field t={t} label="Outputs"    value={stripBackticks(skill.outputs)} monospace />
          <Field t={t} label="Categories" value={skill.categories.join(", ")} />
          <Field t={t} label="Status"     value={skill.status?.reason || "—"} />
        </div>
      )}
    </article>
  );
}

function Field({ t, label, value, monospace }) {
  return (
    <div style={{ display: "flex", gap: 10, fontSize: 12 }}>
      <span style={{ minWidth: 80, color: t.textMuted, fontWeight: 600 }}>{label}</span>
      <span style={{
        color: t.white, lineHeight: 1.5, wordBreak: "break-word", flex: 1,
        fontFamily: monospace ? "var(--font-jetbrains-mono), monospace" : undefined,
        fontSize: monospace ? 11.5 : 12,
      }}>{value || "—"}</span>
    </div>
  );
}

export default function SkillsCatalogPage() {
  const t = useTheme();
  const [query, setQuery]       = useState("");
  const [statusKinds, setKinds] = useState({ green: true, yellow: true, red: true });
  const [openCats, setOpenCats] = useState(() =>
    Object.fromEntries(catalog.categories.map(c => [c.num, true])));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.categories.map(cat => {
      const skills = cat.skills.filter(s => {
        if (s.status?.kind && !statusKinds[s.status.kind]) return false;
        if (!q) return true;
        const hay = (s.slug + " " + s.pitch + " " + s.tags.join(" ") + " " + s.categories.join(" "))
          .toLowerCase();
        return hay.includes(q);
      });
      return { ...cat, skills };
    }).filter(c => c.skills.length > 0);
  }, [query, statusKinds]);

  const totalShown = filtered.reduce((sum, c) => sum + c.skills.length, 0);

  return (
    <>
      <header style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{
            width: 32, height: 32, borderRadius: 8,
            background: `${t.accent}22`, color: t.accent,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}><BookOpen size={16} /></span>
          <h1 style={{
            fontSize: "clamp(22px, 2.4vw, 30px)", margin: 0,
            fontWeight: 800, color: t.white, letterSpacing: -0.4,
          }}>Skills Catalog</h1>
        </div>
        <p style={{ fontSize: 13.5, color: t.textMuted, marginTop: 4, marginBottom: 12, lineHeight: 1.5 }}>
          {catalog.meta.blurb}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: t.textMuted }}>
            {catalog.meta.total} skills · {catalog.categories.length} categories
          </span>
          <a
            href="https://github.com/Skytonet2/Ironshield/blob/main/docs/skills-catalog.md"
            target="_blank" rel="noopener noreferrer"
            style={{
              marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 12, color: t.accent, fontWeight: 600, textDecoration: "none",
              padding: "5px 10px", border: `1px solid ${t.border}`, borderRadius: 6,
            }}>
            View source on GitHub <ExternalLink size={11} />
          </a>
        </div>
      </header>

      {/* Filter bar */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center",
        marginBottom: 18, padding: "10px 12px",
        background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12,
        position: "sticky", top: 64, zIndex: 5,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "1 1 240px" }}>
          <Search size={14} color={t.textMuted} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search slug, pitch, tag…"
            style={{
              flex: 1, background: "transparent", border: "none",
              color: t.white, fontSize: 13, outline: "none",
            }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Filter size={14} color={t.textMuted} />
          {Object.entries(STATUS_META).map(([k, m]) => (
            <button
              key={k}
              onClick={() => setKinds(s => ({ ...s, [k]: !s[k] }))}
              style={{
                padding: "4px 8px", fontSize: 11, fontWeight: 600,
                color: statusKinds[k] ? m.color : t.textMuted,
                background: statusKinds[k] ? `${m.color}1a` : "transparent",
                border: `1px solid ${statusKinds[k] ? `${m.color}3a` : t.border}`,
                borderRadius: 6, cursor: "pointer",
                opacity: statusKinds[k] ? 1 : 0.55,
              }}>
              {m.dot} {k}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 11.5, color: t.textMuted }}>
          {totalShown} match{totalShown === 1 ? "" : "es"}
        </span>
      </div>

      {/* Category jump bar */}
      <nav style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 18 }}>
        {filtered.map(cat => (
          <a key={cat.num} href={`#cat-${cat.num}`} style={{
            fontSize: 11, padding: "3px 8px", borderRadius: 5,
            color: t.textMuted, textDecoration: "none",
            border: `1px solid ${t.border}`,
            display: "inline-flex", alignItems: "center", gap: 4,
          }}>
            <Hash size={10} />
            {cat.name} <span style={{ opacity: 0.6 }}>{cat.skills.length}</span>
          </a>
        ))}
      </nav>

      {/* Categories */}
      {filtered.length === 0 && (
        <p style={{ color: t.textMuted, fontSize: 13, padding: "30px 0", textAlign: "center" }}>
          No skills match the current filters.
        </p>
      )}

      {filtered.map(cat => {
        const isOpen = openCats[cat.num];
        return (
          <section key={cat.num} id={`cat-${cat.num}`} style={{ marginBottom: 22 }}>
            <button
              onClick={() => setOpenCats(o => ({ ...o, [cat.num]: !o[cat.num] }))}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10,
                padding: "10px 14px", marginBottom: 10,
                background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 10,
                cursor: "pointer", textAlign: "left",
              }}>
              <ChevronDown size={14}
                color={t.textMuted}
                style={{ transform: isOpen ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }} />
              <h2 style={{ fontSize: 15, fontWeight: 800, color: t.white, margin: 0 }}>
                {cat.num}. {cat.name}
              </h2>
              <span style={{ fontSize: 11.5, color: t.textMuted }}>
                {cat.skills.length} skill{cat.skills.length === 1 ? "" : "s"}
              </span>
            </button>

            {isOpen && (
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))" }}>
                {cat.skills.map(s => (
                  <SkillCard key={s.slug} skill={s} t={t} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
