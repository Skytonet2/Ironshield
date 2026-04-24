"use client";
// Marketplace (/skills). Reads entirely from the ironshield.near contract:
//   • list_skills(limit, offset)  → base list
//   • get_skills_count            → hero stat "Total Skills"
//   • install_count per row       → derived totals + featured sort
//   • get_public_agents           → "Creators" count (distinct authors)
//
// Sections:
//   • Hero: headline + stats + Create CTA
//   • Filter bar: search + All/Free/Paid chips (Verified hidden until
//     Phase 7 adds a verified flag on-chain)
//   • Featured skills: top 6 by install_count
//   • Top skills: full table, install_count desc (previously "Top this
//     week"; title changed until the backend surfaces a weekly ranking)
//   • Right rail: Become a top creator CTA + Newest skills feed (from
//     created_at desc)
//
// Empty states are honest: zero skills → "No skills published yet"
// with a primary CTA to /skills/create. No mock rows.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Filter, Zap, Star, CheckCircle2, DollarSign,
  Flame, ArrowRight, Sparkles, ChevronRight, Tag, Package, Plus,
} from "lucide-react";
import { useTheme } from "@/lib/contexts";
import useAgent from "@/hooks/useAgent";

const YOCTO_PER_NEAR = 1_000_000_000_000_000_000_000_000n;

/* ──────────────────── Helpers ──────────────────── */

function formatPrice(priceYocto) {
  try {
    const y = BigInt(priceYocto ?? "0");
    if (y === 0n) return "Free";
    // Show up to 3 decimal places, trim trailing zeros.
    const whole   = y / YOCTO_PER_NEAR;
    const remYocto = y % YOCTO_PER_NEAR;
    const frac    = Number(remYocto) / 1e24;
    const combined = Number(whole) + frac;
    const str     = combined.toFixed(3).replace(/\.?0+$/, "");
    return `${str} NEAR`;
  } catch {
    return "—";
  }
}

function formatCount(n) {
  const v = Number(n || 0);
  if (v < 1000) return String(v);
  if (v < 1_000_000) return `${(v / 1000).toFixed(v >= 9950 ? 0 : 1)}K`;
  return `${(v / 1_000_000).toFixed(1)}M`;
}

function truncAuthor(addr) {
  if (!addr) return "anon";
  if (addr.length > 20) return `${addr.slice(0, 10)}…${addr.slice(-6)}`;
  return addr;
}

function accentFor(id) {
  // Stable per-skill accent so the featured tiles aren't all one color.
  const palette = ["#a855f7", "#10b981", "#3b82f6", "#f97316", "#fb923c", "#14b8a6", "#ec4899", "#eab308"];
  return palette[Number(id || 0) % palette.length];
}

/* ──────────────────── Hero ──────────────────── */

function Hero({ t, stats }) {
  const rows = [
    { label: "Total Skills",   value: stats.totalSkills   != null ? formatCount(stats.totalSkills)   : "—" },
    { label: "Total Installs", value: stats.totalInstalls != null ? formatCount(stats.totalInstalls) : "—" },
    { label: "Creators",       value: stats.creators      != null ? formatCount(stats.creators)      : "—" },
    { label: "Paid / Free",    value: stats.paidCount != null ? `${stats.paidCount}/${stats.freeCount}` : "—" },
  ];
  return (
    <div className="mk-hero" style={{
      position: "relative", overflow: "hidden",
      borderRadius: 18,
      padding: "28px 32px",
      background: `linear-gradient(135deg, ${t.bgCard} 0%, ${t.bgSurface} 100%)`,
      border: `1px solid ${t.border}`,
      marginBottom: 24,
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr) minmax(0, 0.9fr) auto",
      gap: 24, alignItems: "center",
    }}>
      <div aria-hidden style={{
        position: "absolute", right: -80, top: -40, width: 360, height: 360,
        background: `radial-gradient(circle at center, rgba(168,85,247,0.25), transparent 65%)`,
        pointerEvents: "none",
      }} />
      <div style={{ minWidth: 0 }}>
        <h1 style={{
          fontSize: "clamp(24px, 2.6vw, 34px)", lineHeight: 1.15, letterSpacing: -0.4,
          fontWeight: 800, color: t.white, margin: 0, marginBottom: 10,
        }}>
          Extend what your{" "}
          <span style={{
            background: `linear-gradient(90deg, #60a5fa, #a855f7)`,
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
          }}>
            agents
          </span>{" "}can do
        </h1>
        <p style={{ fontSize: 13.5, color: t.textMuted, margin: 0 }}>
          Explore powerful skills built by the community.
        </p>
      </div>

      <div className="mk-hero-stats" style={{
        display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 18,
        padding: "16px 18px",
        background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12,
      }}>
        {rows.map(s => (
          <div key={s.label} style={{ minWidth: 0, textAlign: "left" }}>
            <div style={{
              fontSize: 22, fontWeight: 800, color: t.white, lineHeight: 1.1,
              fontFamily: "var(--font-jetbrains-mono), monospace",
            }}>{s.value}</div>
            <div style={{ fontSize: 10.5, color: t.textDim, marginTop: 4, textTransform: "uppercase", letterSpacing: 0.6 }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      <Link href="/skills/create" className="mk-hero-cta" style={{
        padding: "11px 18px",
        background: `linear-gradient(135deg, #a855f7, ${t.accent})`,
        border: "none", borderRadius: 12,
        fontSize: 13, fontWeight: 700, color: "#fff",
        display: "inline-flex", alignItems: "center", gap: 8,
        textDecoration: "none", whiteSpace: "nowrap",
        boxShadow: `0 10px 28px rgba(168,85,247,0.4)`,
      }}>
        <Zap size={14} /> Create a skill
      </Link>
    </div>
  );
}

/* ──────────────────── Filter bar ──────────────────── */

function FilterBar({ t, query, setQuery, filter, setFilter }) {
  const filters = [
    { key: "all",  label: "All" },
    { key: "free", label: "Free", icon: DollarSign },
    { key: "paid", label: "Paid" },
  ];
  return (
    <div style={{ marginBottom: 24 }}>
      <label style={{
        display: "flex", alignItems: "center", gap: 10,
        width: "100%", maxWidth: 480,
        padding: "10px 14px",
        background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12,
        marginBottom: 14,
      }}>
        <Search size={15} color={t.textDim} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search skills…"
          style={{
            flex: 1, minWidth: 0, border: "none", background: "transparent", outline: "none",
            color: t.text, fontSize: 13,
          }}
        />
      </label>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {filters.map((f) => {
          const active = f.key === filter;
          const Icon = f.icon;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              style={{
                padding: "7px 14px",
                background: active ? `linear-gradient(135deg, #a855f7, ${t.accent})` : t.bgCard,
                border: active ? "none" : `1px solid ${t.border}`,
                borderRadius: 999, cursor: "pointer",
                fontSize: 12.5, fontWeight: 600,
                color: active ? "#fff" : t.textMuted,
                display: "inline-flex", alignItems: "center", gap: 6,
              }}
            >
              {Icon && <Icon size={12} />}
              {f.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ──────────────────── Empty state ──────────────────── */

function EmptyState({ t, loading }) {
  return (
    <div style={{
      padding: "44px 24px", borderRadius: 14,
      background: t.bgCard, border: `1px dashed ${t.border}`,
      textAlign: "center",
    }}>
      <span aria-hidden style={{
        width: 52, height: 52, borderRadius: 14,
        background: `linear-gradient(135deg, rgba(168,85,247,0.22), rgba(59,130,246,0.12))`,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        color: "#c4b8ff", marginBottom: 14,
      }}>
        <Package size={22} />
      </span>
      <div style={{ fontSize: 16, fontWeight: 800, color: t.white, marginBottom: 6 }}>
        {loading ? "Loading skills…" : "No skills published yet"}
      </div>
      <div style={{ fontSize: 13, color: t.textMuted, marginBottom: 18, maxWidth: 360, margin: "0 auto 18px" }}>
        {loading
          ? "Fetching the marketplace from ironshield.near."
          : "Be the first to publish a capability. Creators earn every time another agent installs."}
      </div>
      {!loading && (
        <Link href="/skills/create" style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          padding: "11px 18px",
          background: `linear-gradient(135deg, #a855f7, #3b82f6)`,
          border: "none", borderRadius: 10,
          fontSize: 13, fontWeight: 700, color: "#fff", textDecoration: "none",
          boxShadow: `0 10px 28px rgba(168,85,247,0.35)`,
        }}>
          <Plus size={14} /> Create a skill
        </Link>
      )}
    </div>
  );
}

/* ──────────────────── Featured ──────────────────── */

function FeaturedCard({ skill, t }) {
  const accent = accentFor(skill.id);
  const price  = formatPrice(skill.price_yocto);
  const free   = price === "Free";
  return (
    <Link href={`/skills/${skill.id}`} className="mk-featured-card" style={{
      flex: "0 0 220px",
      scrollSnapAlign: "start",
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: 14, textDecoration: "none", color: "inherit",
      display: "flex", flexDirection: "column", gap: 10,
      minWidth: 0,
    }}>
      <div style={{
        position: "relative",
        height: 72, borderRadius: 10,
        background: `linear-gradient(135deg, ${accent}33, ${accent}12)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 28,
      }}>
        <Package size={24} color={accent} />
        {skill.install_count > 0 && (
          <span style={{
            position: "absolute", top: 6, left: 6,
            fontSize: 10, fontWeight: 700,
            padding: "2px 8px",
            background: "rgba(0,0,0,0.45)", color: "#fff", borderRadius: 999,
            display: "inline-flex", alignItems: "center", gap: 4,
          }}>
            <Flame size={10} /> {formatCount(skill.install_count)}
          </span>
        )}
        <span style={{
          position: "absolute", top: 6, right: 6,
          fontSize: 10, fontWeight: 700,
          padding: "2px 8px",
          background: free ? "rgba(16,185,129,0.22)" : "rgba(255,255,255,0.12)",
          color: free ? "#10b981" : "#fff",
          borderRadius: 999,
        }}>
          {price}
        </span>
      </div>

      <div style={{ fontSize: 14, fontWeight: 700, color: t.white, lineHeight: 1.3 }}>
        {skill.name}
      </div>
      <div style={{ fontSize: 11, color: t.textDim, display: "inline-flex", alignItems: "center", gap: 4 }}>
        by {truncAuthor(skill.author)}
      </div>
      <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.45, minHeight: 34, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {skill.description || ""}
      </div>
      <div style={{
        marginTop: "auto",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        paddingTop: 8, borderTop: `1px solid ${t.border}`,
      }}>
        <div style={{ fontSize: 11, color: t.textDim }}>
          {formatCount(skill.install_count)} {skill.install_count === 1 ? "install" : "installs"}
        </div>
      </div>
    </Link>
  );
}

function FeaturedSection({ t, skills }) {
  if (!skills.length) return null;
  return (
    <section style={{ marginBottom: 28 }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 12,
      }}>
        <h2 style={{ fontSize: 17, fontWeight: 800, color: t.white, margin: 0 }}>
          Featured skills
        </h2>
        <Link href="/skills/top" style={{
          fontSize: 12, color: t.accent, fontWeight: 600, textDecoration: "none",
          display: "inline-flex", alignItems: "center", gap: 4,
        }}>
          View all <ChevronRight size={13} />
        </Link>
      </div>
      <div className="mk-featured-row" style={{
        display: "grid",
        gridAutoFlow: "column",
        gridAutoColumns: "minmax(220px, 1fr)",
        gap: 12,
        overflowX: "auto",
        scrollSnapType: "x mandatory",
        paddingBottom: 4,
      }}>
        {skills.map(s => <FeaturedCard key={s.id} skill={s} t={t} />)}
      </div>
    </section>
  );
}

/* ──────────────────── Top table ──────────────────── */

function TopTable({ t, skills }) {
  if (!skills.length) return null;
  return (
    <section className="mk-weekly" style={{
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: 16, marginBottom: 24,
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 14, padding: "0 4px",
      }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: t.white, margin: 0 }}>
          Top skills
        </h2>
      </div>

      <div role="table" style={{ fontSize: 13 }}>
        <div role="row" className="mk-tbl-header" style={{
          display: "grid",
          gridTemplateColumns: "44px minmax(0, 2fr) minmax(0, 1fr) 100px 80px",
          gap: 10, padding: "8px 10px",
          fontSize: 11, fontWeight: 700, color: t.textDim,
          textTransform: "uppercase", letterSpacing: 0.8,
          borderBottom: `1px solid ${t.border}`,
        }}>
          <div>#</div>
          <div>Skill</div>
          <div>Author</div>
          <div>Installs</div>
          <div>Price</div>
        </div>
        {skills.map((s, i) => {
          const accent = accentFor(s.id);
          const price  = formatPrice(s.price_yocto);
          return (
            <Link
              key={s.id}
              href={`/skills/${s.id}`}
              role="row"
              className="mk-tbl-row"
              style={{
                display: "grid",
                gridTemplateColumns: "44px minmax(0, 2fr) minmax(0, 1fr) 100px 80px",
                gap: 10, padding: "12px 10px",
                alignItems: "center",
                borderBottom: `1px solid ${t.border}`,
                textDecoration: "none", color: "inherit",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: t.textMuted }}>{i + 1}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span aria-hidden style={{
                  width: 32, height: 32, flexShrink: 0, borderRadius: 8,
                  background: `linear-gradient(135deg, ${accent}33, ${accent}14)`,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  color: accent,
                }}>
                  <Package size={14} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.white, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.name}
                  </div>
                  <div style={{
                    fontSize: 11, color: t.textDim, marginTop: 2,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {s.description || ""}
                  </div>
                </div>
              </div>
              <div style={{
                fontSize: 12, color: t.textMuted,
                fontFamily: "var(--font-jetbrains-mono), monospace",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {truncAuthor(s.author)}
              </div>
              <div style={{ fontFamily: "var(--font-jetbrains-mono), monospace", color: t.textMuted }}>
                {formatCount(s.install_count)}
              </div>
              <div style={{
                fontSize: 12, fontWeight: 700,
                color: price === "Free" ? "#10b981" : t.white,
              }}>
                {price}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/* ──────────────────── Right rail ──────────────────── */

function BecomeTopCreator({ t }) {
  return (
    <div style={{
      position: "relative", overflow: "hidden",
      borderRadius: 14, padding: "18px 18px 18px",
      background: `linear-gradient(145deg, rgba(168,85,247,0.16), rgba(59,130,246,0.10) 60%, transparent)`,
      border: `1px solid ${t.border}`,
      marginBottom: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <div aria-hidden style={{
          width: 36, height: 36, borderRadius: 10,
          background: `linear-gradient(135deg, #fbbf24, #f59e0b)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18,
        }}>🏆</div>
        <div style={{ fontSize: 14, fontWeight: 800, color: t.white }}>
          Become a top creator
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: t.textMuted, marginBottom: 14, lineHeight: 1.55 }}>
        Publish quality skills and earn from every install.
      </div>
      <Link href="/skills/create" style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "8px 14px",
        background: "rgba(255,255,255,0.05)", border: `1px solid ${t.border}`,
        borderRadius: 10, fontSize: 12, fontWeight: 700, color: t.accent,
        textDecoration: "none",
      }}>
        Learn more <ArrowRight size={12} />
      </Link>
    </div>
  );
}

function NewestSkills({ t, skills }) {
  if (!skills.length) return null;
  return (
    <div style={{
      borderRadius: 14, padding: "16px 16px 14px",
      background: t.bgCard, border: `1px solid ${t.border}`,
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: t.white, marginBottom: 12 }}>
        Newest skills
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {skills.slice(0, 5).map((s) => {
          const accent = accentFor(s.id);
          return (
            <Link
              key={s.id}
              href={`/skills/${s.id}`}
              style={{
                display: "flex", alignItems: "flex-start", gap: 10,
                textDecoration: "none", color: "inherit",
              }}
            >
              <span aria-hidden style={{
                width: 28, height: 28, flexShrink: 0, borderRadius: 8,
                background: `${accent}22`, border: `1px solid ${t.border}`,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                color: accent,
              }}>
                <Sparkles size={12} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12, fontWeight: 700, color: t.white,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{s.name}</div>
                <div style={{ fontSize: 11, color: t.textDim }}>
                  by {truncAuthor(s.author)}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* ──────────────────── Page ──────────────────── */

export default function MarketplacePage() {
  const t = useTheme();
  const agent = useAgent();

  // Pin hook callbacks — useAgent returns new identities each render,
  // which would retrigger this fetch forever if listed in effect deps.
  const agentRef = useRef(agent);
  agentRef.current = agent;

  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const [creators, setCreators] = useState(null);

  const [query, setQuery]   = useState("");
  const [filter, setFilter] = useState("all");

  // Single on-mount fetch: skills list + public-agents count for the
  // Creators stat. Empty deps + a ref-pinned caller.
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const a = agentRef.current;
        const [rows, creators] = await Promise.all([
          a.listSkills({ limit: 100, offset: 0 }),
          a.getPublicAgents({ limit: 100, offset: 0 }).catch(() => []),
        ]);
        if (!alive) return;
        setSkills(Array.isArray(rows) ? rows : []);
        setCreators(Array.isArray(creators) ? creators.length : 0);
      } catch (e) {
        if (!alive) return;
        setError(e?.message || "Failed to load marketplace");
        setSkills([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Derived stats + filtered list.
  const stats = useMemo(() => {
    const totalInstalls = skills.reduce((sum, s) => sum + Number(s.install_count || 0), 0);
    const freeCount = skills.filter(s => String(s.price_yocto ?? "0") === "0").length;
    const paidCount = skills.length - freeCount;
    return {
      totalSkills: skills.length,
      totalInstalls,
      creators,
      freeCount,
      paidCount,
    };
  }, [skills, creators]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills.filter(s => {
      if (filter === "free" && String(s.price_yocto ?? "0") !== "0") return false;
      if (filter === "paid" && String(s.price_yocto ?? "0") === "0") return false;
      if (q) {
        const hay = `${s.name || ""} ${s.description || ""} ${s.author || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [skills, query, filter]);

  const featured = useMemo(() => {
    const byInstalls = [...visible].sort((a, b) => Number(b.install_count || 0) - Number(a.install_count || 0));
    return byInstalls.slice(0, 6);
  }, [visible]);

  const topTable = useMemo(() => {
    const byInstalls = [...visible].sort((a, b) => Number(b.install_count || 0) - Number(a.install_count || 0));
    return byInstalls.slice(0, 10);
  }, [visible]);

  const newest = useMemo(() => {
    const byCreated = [...skills].sort((a, b) => BigInt(b.created_at || 0) > BigInt(a.created_at || 0) ? 1 : -1);
    return byCreated.slice(0, 5);
  }, [skills]);

  const isEmpty = !loading && skills.length === 0;
  const filteredEmpty = !loading && skills.length > 0 && visible.length === 0;

  return (
    <>
      <Hero t={t} stats={stats} />
      <FilterBar t={t} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} />

      {error && (
        <div style={{
          padding: "14px 16px", marginBottom: 20,
          borderRadius: 12, border: `1px solid rgba(239,68,68,0.35)`,
          background: "rgba(239,68,68,0.06)",
          fontSize: 13, color: "#fda4af",
        }}>
          Couldn't load marketplace: {error}
        </div>
      )}

      <div className="mk-grid" style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 320px",
        gap: 24,
        alignItems: "flex-start",
      }}>
        <div style={{ minWidth: 0 }}>
          {isEmpty && <EmptyState t={t} loading={loading} />}
          {filteredEmpty && (
            <div style={{
              padding: "36px 24px", borderRadius: 14,
              background: t.bgCard, border: `1px dashed ${t.border}`,
              textAlign: "center", color: t.textMuted, fontSize: 13,
            }}>
              No skills match your search. Clear the query or try a different filter.
            </div>
          )}
          {!isEmpty && !filteredEmpty && (
            <>
              <FeaturedSection t={t} skills={featured} />
              <TopTable t={t} skills={topTable} />
            </>
          )}
        </div>
        <aside className="mk-right" style={{
          position: "sticky", top: 76,
          display: "flex", flexDirection: "column", gap: 14,
          minWidth: 0,
        }}>
          <BecomeTopCreator t={t} />
          <NewestSkills t={t} skills={newest} />
        </aside>
      </div>

      <style jsx global>{`
        @media (max-width: 1100px) {
          .mk-hero { grid-template-columns: 1fr auto !important; }
          .mk-hero-stats { grid-column: 1 / -1; order: 2; }
          .mk-grid { grid-template-columns: 1fr !important; }
          .mk-right { position: static !important; }
        }
        @media (max-width: 820px) {
          .mk-hero { padding: 22px 22px !important; grid-template-columns: 1fr !important; }
          .mk-hero-cta { width: 100%; justify-content: center; }
          .mk-hero-stats { grid-template-columns: repeat(2, 1fr) !important; }
          .mk-tbl-header, .mk-tbl-row {
            grid-template-columns: 28px minmax(0, 2fr) 80px !important;
          }
          .mk-tbl-header > :nth-child(n+4),
          .mk-tbl-row > :nth-child(n+4) {
            display: none !important;
          }
        }
      `}</style>
    </>
  );
}
