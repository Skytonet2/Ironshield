"use client";
// ConceptsSection — "what could be built" backlog rendered on the
// marketplace. Reads from src/data/skillsCatalog{,V2}.json (the
// 400-skill catalog at /docs/skills-catalog{,-v2}). These are NOT
// installable — they're spec drafts. The card UI is intentionally
// distinct from real skill cards: no Install button, a Concept
// badge instead of a price chip, a status pill, and a link to the
// catalog page for full I/O details. Putting them inline on the
// marketplace gives discovery without faking installability.

import Link from "next/link";
import { useMemo, useState } from "react";
import { Lightbulb, ChevronRight, BookOpen, ArrowRight } from "lucide-react";
import catalogV1 from "@/data/skillsCatalog.json";
import catalogV2 from "@/data/skillsCatalogV2.json";

const STATUS_META = {
  green:  { label: "Buildable today",         color: "#10b981", dot: "🟢" },
  yellow: { label: "One missing piece",       color: "#eab308", dot: "🟡" },
  red:    { label: "Needs platform work",     color: "#ef4444", dot: "🔴" },
};

// Curated picks per volume — the same "ship-first" candidates we
// called out in each catalog PR. Shows users the highest-confidence
// concepts before they explore the long tail. Order matters: each
// pick is a deliberate cross-section, not a copy of the listing.
const FEATURED_CONCEPTS = [
  // v1 ship-first (from PR #99 description)
  { volume: "v1", slug: "newscoin-sniper" },
  { volume: "v1", slug: "dm-triager" },
  { volume: "v1", slug: "gov-proposal-summarizer" },
  { volume: "v1", slug: "risk-allowance-auditor" },
  { volume: "v1", slug: "room-recap-generator" },
  // v2 ship-first (from PR #103 description)
  { volume: "v2", slug: "validator-picker" },
  { volume: "v2", slug: "autocompounder" },
  { volume: "v2", slug: "agent-debate" },
  { volume: "v2", slug: "runway-estimator" },
  { volume: "v2", slug: "agent-output-validator" },
];

function findConcept(volume, slug) {
  const cat = volume === "v1" ? catalogV1 : catalogV2;
  for (const c of cat.categories) {
    const s = c.skills.find(s => s.slug === slug);
    if (s) return { ...s, category: c.name, volume };
  }
  return null;
}

function ConceptCard({ concept, t }) {
  const sm = STATUS_META[concept.status?.kind] || STATUS_META.yellow;
  const docsHref = concept.volume === "v1"
    ? `/docs/skills-catalog#${slugAnchor(concept.slug)}`
    : `/docs/skills-catalog-v2#${slugAnchor(concept.slug)}`;
  return (
    <article style={{
      flex: "0 0 280px", scrollSnapAlign: "start",
      background: t.bgCard,
      border: `1px solid ${t.border}`,
      borderRadius: 14,
      padding: 14,
      display: "flex", flexDirection: "column", gap: 10,
      minWidth: 0,
      position: "relative",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          padding: "3px 8px", fontSize: 10.5, fontWeight: 700,
          color: "#c4b8ff", background: "rgba(168,85,247,0.14)",
          border: "1px solid rgba(168,85,247,0.32)", borderRadius: 6,
          textTransform: "uppercase", letterSpacing: 0.5,
        }}>
          <Lightbulb size={10} /> Concept · {concept.volume}
        </span>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          fontSize: 10, fontWeight: 700,
          color: sm.color, background: `${sm.color}1a`,
          border: `1px solid ${sm.color}3a`, borderRadius: 6,
          padding: "2px 6px",
        }}>
          {sm.dot} {concept.status?.kind || "—"}
        </span>
      </div>

      <code style={{
        fontFamily: "var(--font-jetbrains-mono), monospace",
        fontSize: 12.5, fontWeight: 700, color: t.white,
        wordBreak: "break-word",
      }}>
        {concept.slug}
      </code>

      <p style={{
        fontSize: 12.5, color: t.textMuted, lineHeight: 1.5,
        margin: 0, display: "-webkit-box", WebkitLineClamp: 3,
        WebkitBoxOrient: "vertical", overflow: "hidden",
      }}>
        {concept.pitch}
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "auto" }}>
        <span style={{
          fontSize: 11, color: t.textDim, fontWeight: 600,
          flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {concept.pricing.replace(/\.$/, "")}
        </span>
        <Link href={docsHref} style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          fontSize: 11.5, fontWeight: 600,
          color: t.accent, textDecoration: "none",
        }}>
          Read spec <ChevronRight size={11} />
        </Link>
      </div>
    </article>
  );
}

function slugAnchor(slug) {
  // GitHub renders `### `slug`` as a heading with id like "slug-1"
  // or just the slug, depending on how the markdown engine slugifies.
  // The catalog page itself doesn't currently render anchors per-skill
  // (entries are inside grouped category sections). Linking to the
  // top is fine until per-skill anchors land — the search box on the
  // catalog page makes the slug findable in two keystrokes.
  return slug;
}

export default function ConceptsSection({ t }) {
  const [tab, setTab] = useState("featured");

  const featured = useMemo(
    () => FEATURED_CONCEPTS.map(({ volume, slug }) => findConcept(volume, slug)).filter(Boolean),
    []
  );

  const totalCount = catalogV1.meta.total + catalogV2.meta.total;

  return (
    <section id="concepts" style={{ marginBottom: 28, scrollMarginTop: 72 }}>
      <header style={{
        display: "flex", alignItems: "center", gap: 10,
        marginBottom: 12, flexWrap: "wrap",
      }}>
        <h2 style={{
          fontSize: 18, fontWeight: 800, color: t.white, margin: 0,
          display: "inline-flex", alignItems: "center", gap: 8,
        }}>
          <Lightbulb size={16} color="#a855f7" />
          Concepts — what could be built
        </h2>
        <span style={{
          fontSize: 11, color: t.textDim, fontWeight: 600,
          padding: "2px 8px",
          background: "rgba(168,85,247,0.10)",
          border: "1px solid rgba(168,85,247,0.28)",
          borderRadius: 6,
        }}>
          {totalCount} ideas
        </span>
        <Link href="/docs/skills-catalog" style={{
          marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4,
          fontSize: 12, fontWeight: 600, color: t.accent, textDecoration: "none",
        }}>
          Browse the full catalog <ArrowRight size={11} />
        </Link>
      </header>

      <p style={{
        fontSize: 12.5, color: t.textMuted, lineHeight: 1.6,
        margin: "0 0 14px", maxWidth: 720,
      }}>
        Spec drafts for skills the community could build. Each entry has
        proposed inputs, outputs, pricing, and a status flag for whether
        the underlying infra ships today. <strong>These aren't installable
        yet</strong> — they're a backlog. Click "Read spec" for full I/O,
        or build one and list it for real.
      </p>

      <div style={{
        display: "flex", gap: 12, overflowX: "auto",
        scrollSnapType: "x mandatory", paddingBottom: 6,
        margin: "0 -2px",
      }}>
        {featured.map(c => (
          <ConceptCard key={`${c.volume}-${c.slug}`} concept={c} t={t} />
        ))}
      </div>

      <div style={{
        display: "flex", gap: 10, alignItems: "center", marginTop: 12,
        padding: "10px 14px",
        background: t.bgCard, border: `1px dashed ${t.border}`,
        borderRadius: 10,
        flexWrap: "wrap",
      }}>
        <BookOpen size={14} color={t.textMuted} />
        <span style={{ fontSize: 12, color: t.textMuted }}>
          Want to ship one of these as a real skill? Open a PR with the
          implementation under <code style={{
            fontFamily: "var(--font-jetbrains-mono), monospace",
            fontSize: 11, padding: "1px 5px",
            background: "rgba(168,85,247,0.12)", color: "#c4b8ff",
            borderRadius: 4,
          }}>backend/services/skills/</code> and call <code style={{
            fontFamily: "var(--font-jetbrains-mono), monospace",
            fontSize: 11, padding: "1px 5px",
            background: "rgba(168,85,247,0.12)", color: "#c4b8ff",
            borderRadius: 4,
          }}>create_skill</code> on the contract.
        </span>
        <Link href="/docs/skills" style={{
          marginLeft: "auto",
          fontSize: 11.5, fontWeight: 600, color: t.accent, textDecoration: "none",
        }}>
          How to ship a skill →
        </Link>
      </div>
    </section>
  );
}
