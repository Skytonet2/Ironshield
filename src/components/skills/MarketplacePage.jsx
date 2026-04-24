"use client";
// Marketplace (/skills). Pixel-hewing to the mock:
//   • Hero strip: headline + subhead + stats + "Create a skill" CTA
//   • Search + filter chip row (All / Free / Paid / Verified / Filters)
//   • Featured skills — horizontal row of 6 cards (scroll on mobile)
//   • Top skills this week — table with rank, skill, category, installs,
//     rating, price
//   • Right rail: "Become a top creator" CTA + "Recent activity" list
//
// All data is placeholder right now; the follow-up PR wires contract
// + backend fetches. Keeping every card shape keyed by id so swapping
// mock → real is a one-line change in the data arrays.

import Link from "next/link";
import {
  Search, Filter, Zap, Trophy, Star, CheckCircle2, DollarSign,
  Flame, ArrowRight, Sparkles, ChevronRight, Tag,
} from "lucide-react";
import { useTheme } from "@/lib/contexts";

/* ──────────────────── Data (mock) ──────────────────── */

const HERO_STATS = [
  { label: "Total Skills",   value: "1,320"   },
  { label: "Total Installs", value: "18.6K"   },
  { label: "Creators",       value: "320"     },
  { label: "Volume (NEAR)",  value: "$24.8K"  },
];

const FILTERS = [
  { key: "all",      label: "All",      icon: null      },
  { key: "free",     label: "Free",     icon: DollarSign },
  { key: "paid",     label: "Paid",     icon: null      },
  { key: "verified", label: "Verified", icon: CheckCircle2 },
];

const FEATURED = [
  { id: 1, name: "Airdrop Hunter",       author: "0xYourn…near", verified: true,  installs: "12.4K", rating: 4.9, price: "Free",    badge: "Trending", accent: "#a855f7", desc: "Find potential airdrops across multiple networks.", emoji: "🪂" },
  { id: 2, name: "DeFi Portfolio Tracker", author: "DefiWizard.near", verified: true,  installs: "9.2K",  rating: 4.8, price: "Free",    badge: "Trending", accent: "#10b981", desc: "Track and analyze your DeFi portfolio in real-time.", emoji: "📈" },
  { id: 3, name: "Auto Swap",            author: "SwapMaster.near", verified: true,  installs: "7.1K",  rating: 4.7, price: "0.5 NEAR", badge: "Popular",  accent: "#3b82f6", desc: "Automatically swap tokens with best routes.", emoji: "🔁" },
  { id: 4, name: "Smart Market Alert",   author: "MarketSense.near", verified: true, installs: "6.3K",  rating: 4.6, price: "0.3 NEAR", badge: "Hot",      accent: "#f97316", desc: "Get real-time alerts for market movements.", emoji: "📊" },
  { id: 5, name: "Twitter Assistant",    author: "SocialBot.near",   verified: true, installs: "5.8K",  rating: 4.5, price: "Free",    badge: "Popular",  accent: "#fb923c", desc: "Automate tweets, replies and engagement.", emoji: "🤖" },
  { id: 6, name: "Contract Scanner",     author: "BlockGuard.near",  verified: true, installs: "3.9K",  rating: 4.8, price: "0.2 NEAR", badge: "New",      accent: "#14b8a6", desc: "Scan smart contracts for vulnerabilities.", emoji: "🛡️" },
];

const TOP_THIS_WEEK = FEATURED.slice(0, 5).map((s, i) => ({
  rank: i + 1,
  ...s,
  category: i === 0 ? "Airdrops & Rewards" : i === 1 ? "DeFi" : i === 2 ? "Trading" : i === 3 ? "Analytics" : "Social",
}));

const RECENT_ACTIVITY = [
  { skill: "DeFi Yield Optimizer", author: "YieldKing.near",   event: "was installed", when: "2m ago"  },
  { skill: "Wallet Guard",         author: "BlockGuard.near",  event: "was installed", when: "5m ago"  },
  { skill: "NFT Floor Tracker",    author: "NFTAlert.near",    event: "was installed", when: "12m ago" },
  { skill: "Cross-chain Bridge",   author: "BridgeMaster.near",event: "was installed", when: "18m ago" },
];

/* ──────────────────── Hero ──────────────────── */

function Hero({ t }) {
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
      {/* Radial blob bg */}
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
        {HERO_STATS.map(s => (
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

function FilterBar({ t }) {
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
          placeholder="Search skills…"
          style={{
            flex: 1, minWidth: 0, border: "none", background: "transparent", outline: "none",
            color: t.text, fontSize: 13,
          }}
        />
      </label>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {FILTERS.map((f, i) => {
          const active = i === 0;
          const Icon = f.icon;
          return (
            <button key={f.key} type="button" style={{
              padding: "7px 14px",
              background: active ? `linear-gradient(135deg, #a855f7, ${t.accent})` : t.bgCard,
              border: active ? "none" : `1px solid ${t.border}`,
              borderRadius: 999, cursor: "pointer",
              fontSize: 12.5, fontWeight: 600,
              color: active ? "#fff" : t.textMuted,
              display: "inline-flex", alignItems: "center", gap: 6,
            }}>
              {Icon && <Icon size={12} />}
              {f.label}
            </button>
          );
        })}
        <button type="button" style={{
          padding: "7px 14px",
          background: t.bgCard, border: `1px solid ${t.border}`,
          borderRadius: 999, cursor: "pointer",
          fontSize: 12.5, fontWeight: 600, color: t.textMuted,
          display: "inline-flex", alignItems: "center", gap: 6,
        }}>
          <Filter size={12} /> Filters
        </button>
      </div>
    </div>
  );
}

/* ──────────────────── Featured card ──────────────────── */

function FeaturedCard({ skill, t }) {
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
        background: `linear-gradient(135deg, ${skill.accent}33, ${skill.accent}12)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 28,
      }}>
        <span aria-hidden>{skill.emoji}</span>
        <span style={{
          position: "absolute", top: 6, left: 6,
          fontSize: 10, fontWeight: 700,
          padding: "2px 8px",
          background: "rgba(0,0,0,0.45)", color: "#fff", borderRadius: 999,
          display: "inline-flex", alignItems: "center", gap: 4,
        }}>
          <Flame size={10} /> {skill.badge}
        </span>
        <span style={{
          position: "absolute", top: 6, right: 6,
          fontSize: 10, fontWeight: 700,
          padding: "2px 8px",
          background: skill.price === "Free" ? "rgba(16,185,129,0.22)" : "rgba(255,255,255,0.12)",
          color: skill.price === "Free" ? "#10b981" : "#fff",
          borderRadius: 999,
        }}>
          {skill.price}
        </span>
      </div>

      <div style={{ fontSize: 14, fontWeight: 700, color: t.white, lineHeight: 1.3 }}>
        {skill.name}
      </div>
      <div style={{ fontSize: 11, color: t.textDim, display: "inline-flex", alignItems: "center", gap: 4 }}>
        by {skill.author}
        {skill.verified && <CheckCircle2 size={11} color={t.accent} />}
      </div>
      <div style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.45, minHeight: 34 }}>
        {skill.desc}
      </div>
      <div style={{
        marginTop: "auto",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        paddingTop: 8, borderTop: `1px solid ${t.border}`,
      }}>
        <div style={{ fontSize: 11, color: t.textDim }}>{skill.installs} installs</div>
        <div style={{ fontSize: 11, color: t.textMuted, display: "inline-flex", alignItems: "center", gap: 3 }}>
          <Star size={11} color="#f59e0b" fill="#f59e0b" /> {skill.rating}
        </div>
      </div>
    </Link>
  );
}

function FeaturedSection({ t }) {
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
        {FEATURED.map(s => <FeaturedCard key={s.id} skill={s} t={t} />)}
      </div>
    </section>
  );
}

/* ──────────────────── Weekly table ──────────────────── */

function WeeklyTable({ t }) {
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
          Top skills this week
        </h2>
        <Link href="/skills/top" style={{
          fontSize: 12, color: t.accent, fontWeight: 600, textDecoration: "none",
        }}>
          View all
        </Link>
      </div>

      <div role="table" style={{ fontSize: 13 }}>
        <div role="row" className="mk-tbl-header" style={{
          display: "grid",
          gridTemplateColumns: "44px minmax(0, 1.7fr) minmax(0, 1fr) 80px 110px 80px",
          gap: 10, padding: "8px 10px",
          fontSize: 11, fontWeight: 700, color: t.textDim,
          textTransform: "uppercase", letterSpacing: 0.8,
          borderBottom: `1px solid ${t.border}`,
        }}>
          <div>#</div>
          <div>Skill</div>
          <div>Category</div>
          <div>Installs</div>
          <div>Rating</div>
          <div>Price</div>
        </div>
        {TOP_THIS_WEEK.map(s => (
          <Link
            key={s.rank}
            href={`/skills/${s.id}`}
            role="row"
            className="mk-tbl-row"
            style={{
              display: "grid",
              gridTemplateColumns: "44px minmax(0, 1.7fr) minmax(0, 1fr) 80px 110px 80px",
              gap: 10, padding: "12px 10px",
              alignItems: "center",
              borderBottom: `1px solid ${t.border}`,
              textDecoration: "none", color: "inherit",
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: t.textMuted }}>{s.rank}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span aria-hidden style={{
                width: 32, height: 32, flexShrink: 0, borderRadius: 8,
                background: `linear-gradient(135deg, ${s.accent}33, ${s.accent}14)`,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: 16,
              }}>
                {s.emoji}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.white, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.name}
                </div>
                <div style={{
                  fontSize: 11, color: t.textDim, marginTop: 2,
                  display: "inline-flex", alignItems: "center", gap: 4,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  by {s.author}
                  {s.verified && <CheckCircle2 size={10} color={t.accent} />}
                </div>
              </div>
            </div>
            <div>
              <span style={{
                fontSize: 11, padding: "3px 10px", borderRadius: 999,
                background: `${s.accent}22`, color: s.accent, fontWeight: 600,
                display: "inline-flex", alignItems: "center", gap: 4,
              }}>
                <Tag size={10} /> {s.category}
              </span>
            </div>
            <div style={{ fontFamily: "var(--font-jetbrains-mono), monospace", color: t.textMuted }}>
              {s.installs}
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 4, color: t.textMuted }}>
              <Star size={11} color="#f59e0b" fill="#f59e0b" /> {s.rating}{" "}
              <span style={{ color: t.textDim, fontSize: 11 }}>
                ({Math.round(Math.random() * 300 + 100)})
              </span>
            </div>
            <div style={{
              fontSize: 12, fontWeight: 700,
              color: s.price === "Free" ? "#10b981" : t.white,
            }}>
              {s.price}
            </div>
          </Link>
        ))}
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
        }}>
          🏆
        </div>
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

function RecentActivity({ t }) {
  return (
    <div style={{
      borderRadius: 14, padding: "16px 16px 14px",
      background: t.bgCard, border: `1px solid ${t.border}`,
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: t.white, marginBottom: 12 }}>
        Recent activity
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {RECENT_ACTIVITY.map((a, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <span aria-hidden style={{
              width: 28, height: 28, flexShrink: 0, borderRadius: 8,
              background: `${t.accent}20`, border: `1px solid ${t.border}`,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, color: t.accent,
            }}>
              <Sparkles size={12} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 12, fontWeight: 700, color: t.white,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{a.skill}</div>
              <div style={{ fontSize: 11, color: t.textDim }}>
                by {a.author} {a.event}
              </div>
            </div>
            <div style={{ fontSize: 10.5, color: t.textDim, whiteSpace: "nowrap" }}>
              {a.when}
            </div>
          </div>
        ))}
      </div>
      <Link href="/skills/activity" style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        marginTop: 12, fontSize: 12, color: t.accent, fontWeight: 600,
        textDecoration: "none",
      }}>
        View all activity <ArrowRight size={12} />
      </Link>
    </div>
  );
}

/* ──────────────────── Page ──────────────────── */

export default function MarketplacePage() {
  const t = useTheme();
  return (
    <>
      <Hero t={t} />
      <FilterBar t={t} />

      <div className="mk-grid" style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 320px",
        gap: 24,
        alignItems: "flex-start",
      }}>
        <div style={{ minWidth: 0 }}>
          <FeaturedSection t={t} />
          <WeeklyTable t={t} />
        </div>
        <aside className="mk-right" style={{
          position: "sticky", top: 76,
          display: "flex", flexDirection: "column", gap: 14,
          minWidth: 0,
        }}>
          <BecomeTopCreator t={t} />
          <RecentActivity t={t} />
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
