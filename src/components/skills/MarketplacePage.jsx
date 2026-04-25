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
import { useTheme, useWallet } from "@/lib/contexts";
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
    { key: "all",      label: "All" },
    { key: "free",     label: "Free",     icon: DollarSign },
    { key: "paid",     label: "Paid" },
    { key: "verified", label: "Verified", icon: CheckCircle2 },
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

function FeaturedCard({ skill, metadata, t, onInstall, installing }) {
  const accent = accentFor(skill.id);
  const price  = formatPrice(skill.price_yocto);
  const free   = price === "Free";
  const verified = !!metadata?.verified;
  const category = metadata?.category || "";
  return (
    <div className="mk-featured-card" style={{
      flex: "0 0 240px",
      scrollSnapAlign: "start",
      background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
      padding: 14,
      display: "flex", flexDirection: "column", gap: 10,
      minWidth: 0,
    }}>
      <Link href={`/skills/view?id=${skill.id}`} style={{ display: "block", textDecoration: "none", color: "inherit" }}>
        <div style={{
          position: "relative",
          height: 80, borderRadius: 10,
          background: metadata?.image_url
            ? `url("${metadata.image_url}") center/cover no-repeat, linear-gradient(135deg, ${accent}33, ${accent}12)`
            : `linear-gradient(135deg, ${accent}33, ${accent}12)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 10,
        }}>
          {!metadata?.image_url && <Package size={24} color={accent} />}
          {skill.install_count > 0 && (
            <span style={{
              position: "absolute", top: 6, left: 6,
              fontSize: 10, fontWeight: 700,
              padding: "2px 8px",
              background: "rgba(0,0,0,0.55)", color: "#fff", borderRadius: 999,
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

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: t.white, lineHeight: 1.3, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {skill.name}
          </span>
          {verified && (
            <CheckCircle2 size={13} color={t.accent} aria-label="Verified" title="Verified" />
          )}
        </div>
        <div style={{ fontSize: 11, color: t.textDim, marginBottom: 6 }}>
          by {truncAuthor(skill.author)}
        </div>
        <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.45, minHeight: 34, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {skill.description || ""}
        </div>
        {category && (
          <div style={{ marginTop: 8 }}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 10.5, fontWeight: 700,
              padding: "2px 10px", borderRadius: 999,
              background: `${accent}22`, color: accent,
            }}>
              <Tag size={10} /> {category}
            </span>
          </div>
        )}
      </Link>
      <button
        type="button"
        onClick={() => onInstall(skill)}
        disabled={installing}
        style={{
          marginTop: "auto",
          padding: "8px 12px",
          background: installing ? t.bgSurface : `linear-gradient(135deg, #a855f7, ${t.accent})`,
          border: installing ? `1px solid ${t.border}` : "none",
          borderRadius: 8,
          fontSize: 12, fontWeight: 700,
          color: installing ? t.textMuted : "#fff",
          cursor: installing ? "progress" : "pointer",
          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        }}
      >
        {installing ? "Installing…" : free ? "Install" : `Install · ${price}`}
      </button>
    </div>
  );
}

function FeaturedSection({ t, rows, onInstall, installingId }) {
  if (!rows.length) return null;
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
        gridAutoColumns: "minmax(240px, 1fr)",
        gap: 12,
        overflowX: "auto",
        scrollSnapType: "x mandatory",
        paddingBottom: 4,
      }}>
        {rows.map(({ skill, metadata }) => (
          <FeaturedCard
            key={skill.id}
            skill={skill}
            metadata={metadata}
            t={t}
            onInstall={onInstall}
            installing={installingId === skill.id}
          />
        ))}
      </div>
    </section>
  );
}

/* ──────────────────── Top table ──────────────────── */

function TopTable({ t, rows, onInstall, installingId }) {
  if (!rows.length) return null;
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
          gridTemplateColumns: "40px minmax(0, 2fr) minmax(0, 1fr) 90px 80px 80px",
          gap: 10, padding: "8px 10px",
          fontSize: 11, fontWeight: 700, color: t.textDim,
          textTransform: "uppercase", letterSpacing: 0.8,
          borderBottom: `1px solid ${t.border}`,
        }}>
          <div>#</div>
          <div>Skill</div>
          <div>Category</div>
          <div>Installs</div>
          <div>Price</div>
          <div />
        </div>
        {rows.map(({ skill, metadata }, i) => {
          const accent    = accentFor(skill.id);
          const price     = formatPrice(skill.price_yocto);
          const verified  = !!metadata?.verified;
          const category  = metadata?.category || "—";
          const installing = installingId === skill.id;
          return (
            <div
              key={skill.id}
              role="row"
              className="mk-tbl-row"
              style={{
                display: "grid",
                gridTemplateColumns: "40px minmax(0, 2fr) minmax(0, 1fr) 90px 80px 80px",
                gap: 10, padding: "12px 10px",
                alignItems: "center",
                borderBottom: `1px solid ${t.border}`,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: t.textMuted }}>{i + 1}</div>
              <Link href={`/skills/view?id=${skill.id}`} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, textDecoration: "none", color: "inherit" }}>
                <span aria-hidden style={{
                  width: 32, height: 32, flexShrink: 0, borderRadius: 8,
                  background: `linear-gradient(135deg, ${accent}33, ${accent}14)`,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  color: accent,
                }}>
                  <Package size={14} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: t.white, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {skill.name}
                    </span>
                    {verified && <CheckCircle2 size={11} color={t.accent} aria-label="Verified" title="Verified" />}
                  </div>
                  <div style={{
                    fontSize: 11, color: t.textDim, marginTop: 2,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    by {truncAuthor(skill.author)}
                  </div>
                </div>
              </Link>
              <div style={{ minWidth: 0 }}>
                {category !== "—" ? (
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    fontSize: 11, fontWeight: 600, color: accent,
                    padding: "2px 10px", borderRadius: 999,
                    background: `${accent}22`,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    maxWidth: "100%",
                  }}>
                    <Tag size={10} /> {category}
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: t.textDim }}>—</span>
                )}
              </div>
              <div style={{ fontFamily: "var(--font-jetbrains-mono), monospace", color: t.textMuted }}>
                {formatCount(skill.install_count)}
              </div>
              <div style={{
                fontSize: 12, fontWeight: 700,
                color: price === "Free" ? "#10b981" : t.white,
              }}>
                {price}
              </div>
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onInstall(skill); }}
                disabled={installing}
                style={{
                  padding: "6px 10px",
                  background: installing ? t.bgSurface : `linear-gradient(135deg, #a855f7, ${t.accent})`,
                  border: installing ? `1px solid ${t.border}` : "none",
                  borderRadius: 8,
                  fontSize: 11.5, fontWeight: 700,
                  color: installing ? t.textMuted : "#fff",
                  cursor: installing ? "progress" : "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {installing ? "…" : "Install"}
              </button>
            </div>
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

function NewestSkills({ t, rows }) {
  if (!rows.length) return null;
  return (
    <div style={{
      borderRadius: 14, padding: "16px 16px 14px",
      background: t.bgCard, border: `1px solid ${t.border}`,
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: t.white, marginBottom: 12 }}>
        Newest skills
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.slice(0, 5).map(({ skill, metadata }) => {
          const accent = accentFor(skill.id);
          return (
            <Link
              key={skill.id}
              href={`/skills/view?id=${skill.id}`}
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
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{
                    fontSize: 12, fontWeight: 700, color: t.white,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    flex: 1, minWidth: 0,
                  }}>{skill.name}</span>
                  {metadata?.verified && <CheckCircle2 size={10} color={t.accent} />}
                </div>
                <div style={{ fontSize: 11, color: t.textDim }}>
                  by {truncAuthor(skill.author)}
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
  const { connected, address, showModal } = useWallet?.() || {};

  // Pin hook callbacks — useAgent returns new identities each render,
  // which would retrigger this fetch forever if listed in effect deps.
  const agentRef = useRef(agent);
  agentRef.current = agent;

  // skills is now Array<{ skill, metadata }> joined via list_skills_with_metadata
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const [creators, setCreators] = useState(null);

  const [query, setQuery]   = useState("");
  const [filter, setFilter] = useState("all");
  const [installingId, setInstallingId] = useState(null);

  // Single on-mount fetch: skills + metadata joined, plus public-agents
  // count for the Creators stat. Empty deps + a ref-pinned caller.
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const a = agentRef.current;
        const [rows, creators] = await Promise.all([
          a.listSkillsWithMetadata({ limit: 100, offset: 0 }),
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

  // Install handler — called from the featured grid + top table. Sends
  // the skill's `price_yocto` as attached deposit; contract validates +
  // splits 99/1 + refunds overpay. Free skills sign a 0-deposit tx.
  //
  // The contract's install_skill panics if the caller has no
  // registered AgentProfile, so we pre-flight here: no wallet →
  // open the connect modal; no profile → route to the wizard.
  // That's a real check (chain view), not a UI cosmetic.
  const handleInstall = async (skill) => {
    if (!connected) { showModal?.(); return; }
    setInstallingId(skill.id);
    try {
      const profile = await agentRef.current.fetchProfile?.();
      if (!profile) {
        if (typeof window !== "undefined") {
          window.alert("Register an agent before installing skills. Taking you to the launchpad.");
          window.location.href = "/agents/create";
        }
        return;
      }
      await agentRef.current.installSkill(skill.id, skill.price_yocto || "0");
      setSkills(list => list.map(row =>
        row.skill.id === skill.id
          ? { ...row, skill: { ...row.skill, install_count: Number(row.skill.install_count || 0) + 1 } }
          : row
      ));
    } catch (e) {
      alert(e?.message || "Install failed");
    } finally {
      setInstallingId(null);
    }
  };

  // Derived stats + filtered list. All rows are now { skill, metadata }
  // tuples — we reach through to .skill for price/install/author and
  // .metadata for category/tags/verified when present.
  const stats = useMemo(() => {
    const totalInstalls = skills.reduce((sum, r) => sum + Number(r.skill?.install_count || 0), 0);
    const freeCount = skills.filter(r => String(r.skill?.price_yocto ?? "0") === "0").length;
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
    return skills.filter(({ skill, metadata }) => {
      if (!skill) return false;
      if (filter === "free"     && String(skill.price_yocto ?? "0") !== "0") return false;
      if (filter === "paid"     && String(skill.price_yocto ?? "0") === "0") return false;
      if (filter === "verified" && !metadata?.verified) return false;
      if (q) {
        const tagBlob = Array.isArray(metadata?.tags) ? metadata.tags.join(" ") : "";
        const hay = `${skill.name || ""} ${skill.description || ""} ${skill.author || ""} ${metadata?.category || ""} ${tagBlob}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [skills, query, filter]);

  const featured = useMemo(() => {
    const byInstalls = [...visible].sort((a, b) => Number(b.skill.install_count || 0) - Number(a.skill.install_count || 0));
    return byInstalls.slice(0, 6);
  }, [visible]);

  const topTable = useMemo(() => {
    const byInstalls = [...visible].sort((a, b) => Number(b.skill.install_count || 0) - Number(a.skill.install_count || 0));
    return byInstalls.slice(0, 10);
  }, [visible]);

  const newest = useMemo(() => {
    const byCreated = [...skills].sort((a, b) =>
      BigInt(b.skill?.created_at || 0) > BigInt(a.skill?.created_at || 0) ? 1 : -1
    );
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
              <FeaturedSection t={t} rows={featured} onInstall={handleInstall} installingId={installingId} />
              <TopTable      t={t} rows={topTable} onInstall={handleInstall} installingId={installingId} />
            </>
          )}
        </div>
        <aside className="mk-right" style={{
          position: "sticky", top: 76,
          display: "flex", flexDirection: "column", gap: 14,
          minWidth: 0,
        }}>
          <BecomeTopCreator t={t} />
          <NewestSkills t={t} rows={newest} />
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
