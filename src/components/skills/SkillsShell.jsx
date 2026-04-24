"use client";
// SkillsShell — the chrome for the skills marketplace + agent management
// product vertical. Parallel to src/components/shell/AppShell.jsx; do
// NOT consolidate. AppShell is the social/feed chrome (Feed, Messages,
// Portfolio, etc.). SkillsShell is everything inside /skills/** and
// /agents/me, /agents/[handle]/*.
//
// Layout (desktop ≥ 1024px):
//   ┌─ TopNav (56px) ──────────────────────────────────────────────┐
//   ├ LeftSidebar (240px) ┬ Main ─────────────────────────────────┤
//   │  IronShield Skills  │  {children}                           │
//   │  Discover           │                                       │
//   │  Categories         │                                       │
//   │  ...                │                                       │
//   │  ╭ Earn CTA ╮       │                                       │
//   └─────────────────────┴───────────────────────────────────────┘
//
// Mobile (< 768px): sidebar collapses into a drawer toggled from a
// hamburger in the top nav; the CTA card hides (too tall).
//
// Matches the mock's IA, intentionally independent from AppShell —
// the skills vertical has its own top-tabs (Marketplace / My Skills /
// Analytics / Documentation) that would pollute AppShell if shared.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Zap, Search, Bell, ChevronDown, Menu, X as XIcon,
  Compass, LayoutGrid, Trophy, Sparkles, Crown, TrendingUp,
} from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";

const TOP_TABS = [
  { key: "marketplace",    label: "Marketplace",    href: "/skills"        },
  { key: "my-skills",      label: "My Skills",      href: "/skills/mine"   },
  { key: "analytics",      label: "Analytics",      href: "/skills/analytics" },
  { key: "documentation",  label: "Documentation",  href: "/docs/skills"   },
];

const SIDEBAR_PRIMARY = [
  { key: "discover",     label: "Discover",         Icon: Compass,    href: "/skills"            },
  { key: "categories",   label: "Categories",       Icon: LayoutGrid, href: "/skills/categories" },
  { key: "top-skills",   label: "Top Skills",       Icon: Trophy,     href: "/skills/top"        },
  { key: "new",          label: "New & Noteworthy", Icon: Sparkles,   href: "/skills/new"        },
  { key: "top-paid",     label: "Top Paid",         Icon: Crown,      href: "/skills/paid"       },
  { key: "trending",     label: "Trending",         Icon: TrendingUp, href: "/skills/trending"   },
];

const SIDEBAR_CATEGORIES = [
  { label: "DeFi",              count: 128, href: "/skills/category/defi"       },
  { label: "Airdrops & Rewards", count:  96, href: "/skills/category/airdrops"   },
  { label: "Trading",           count:  87, href: "/skills/category/trading"    },
  { label: "Analytics",         count:  74, href: "/skills/category/analytics"  },
  { label: "Social",            count:  62, href: "/skills/category/social"     },
  { label: "Security",          count:  45, href: "/skills/category/security"   },
  { label: "Gaming",            count:  31, href: "/skills/category/gaming"     },
  { label: "Productivity",      count:  28, href: "/skills/category/productivity" },
  { label: "Other",             count:  15, href: "/skills/category/other"      },
];

/* ──────────────────────────────────────────────────────────────
   Top Nav
   ────────────────────────────────────────────────────────────── */

function TopNav({ t, onToggleDrawer, onOpenConnect }) {
  const pathname = usePathname() || "";
  const { connected, address, balance } = useWallet?.() || {};

  const isActive = (href) => {
    if (href === "/skills") {
      // Marketplace tab is active on /skills exactly and all other
      // /skills/* routes not covered by a more specific top tab.
      return pathname === "/skills" || pathname === "/skills/"
        || (pathname.startsWith("/skills/") && !TOP_TABS.slice(1).some(x => pathname.startsWith(x.href)));
    }
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <header className="sk-topnav" style={{
      position: "sticky", top: 0, zIndex: 20,
      background: t.bg,
      borderBottom: `1px solid ${t.border}`,
      height: 56,
      display: "flex", alignItems: "center",
      padding: "0 20px", gap: 20,
    }}>
      {/* Mobile hamburger */}
      <button
        type="button"
        aria-label="Toggle menu"
        onClick={onToggleDrawer}
        className="sk-hamburger"
        style={{
          display: "none", // shown via media query
          border: "none", background: "transparent", color: t.text,
          padding: 6, cursor: "pointer",
        }}
      >
        <Menu size={20} />
      </button>

      <Link href="/skills" aria-label="IronShield Skills" style={{
        display: "inline-flex", alignItems: "center", gap: 10,
        textDecoration: "none", color: t.white,
      }}>
        <span style={{
          width: 30, height: 30, borderRadius: 8,
          background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          boxShadow: `0 6px 18px ${t.accent}33`,
        }}>
          <Zap size={16} color="#fff" strokeWidth={2.6} />
        </span>
        <span style={{ fontWeight: 800, letterSpacing: -0.3, fontSize: 16, whiteSpace: "nowrap" }}>
          IronShield <span style={{
            background: "linear-gradient(90deg, #60a5fa, #a855f7)",
            WebkitBackgroundClip: "text", backgroundClip: "text",
            WebkitTextFillColor: "transparent", color: "transparent",
          }}>Skills</span>
        </span>
      </Link>

      <nav className="sk-toptabs" style={{
        display: "flex", alignItems: "center", gap: 4, marginLeft: 28,
      }}>
        {TOP_TABS.map(tab => {
          const active = isActive(tab.href);
          return (
            <Link key={tab.key} href={tab.href} style={{
              position: "relative",
              padding: "18px 14px", fontSize: 13, fontWeight: 600,
              color: active ? t.white : t.textMuted,
              textDecoration: "none", whiteSpace: "nowrap",
            }}>
              {tab.label}
              {active && (
                <span style={{
                  position: "absolute", left: 14, right: 14, bottom: 0, height: 2,
                  background: `linear-gradient(90deg, #60a5fa, #a855f7)`,
                  borderRadius: 2,
                }} />
              )}
            </Link>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />

      <label className="sk-search" style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        width: 320, maxWidth: "40vw",
        padding: "8px 12px",
        background: t.bgCard, border: `1px solid ${t.border}`,
        borderRadius: 10, color: t.textMuted, fontSize: 13,
      }}>
        <Search size={14} color={t.textDim} />
        <input
          placeholder="Search skills, categories, creators…"
          style={{
            flex: 1, minWidth: 0,
            border: "none", background: "transparent", outline: "none",
            color: t.text, fontSize: 13,
          }}
        />
        <kbd style={{
          fontFamily: "var(--font-jetbrains-mono), monospace",
          fontSize: 10.5, padding: "2px 6px",
          background: t.bgSurface, border: `1px solid ${t.border}`,
          borderRadius: 4, color: t.textDim,
        }}>⌘K</kbd>
      </label>

      <button
        type="button"
        aria-label="Notifications"
        className="sk-notif"
        style={{
          width: 36, height: 36, borderRadius: 10,
          background: t.bgCard, border: `1px solid ${t.border}`,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          color: t.text, cursor: "pointer",
        }}
      >
        <Bell size={15} />
      </button>

      {/* Profile chip. When disconnected, opens the Connect Account
          modal (mock-matching multi-provider chooser). When connected,
          the click is a no-op for now — the profile menu ships in the
          functionality PR. */}
      <button
        type="button"
        onClick={() => !connected && onOpenConnect?.()}
        className="sk-profile"
        style={{
          display: "inline-flex", alignItems: "center", gap: 10,
          padding: "6px 12px 6px 6px",
          background: t.bgCard, border: `1px solid ${t.border}`,
          borderRadius: 10, color: t.text, cursor: "pointer",
          minWidth: 0,
        }}
      >
        <span style={{
          width: 28, height: 28, borderRadius: "50%",
          background: `linear-gradient(135deg, #fb923c, #f59e0b)`,
          flexShrink: 0,
        }} />
        <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.15, minWidth: 0 }}>
          <span style={{
            fontSize: 12, fontWeight: 700, color: t.white,
            maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>
            {connected && address ? address : "Sign in"}
          </span>
          <span style={{ fontSize: 10.5, color: t.textDim }}>
            {connected ? (balance ? `${balance} NEAR` : "— NEAR") : "Connect wallet"}
          </span>
        </span>
        <ChevronDown size={13} color={t.textDim} />
      </button>
    </header>
  );
}

/* ──────────────────────────────────────────────────────────────
   Left Sidebar
   ────────────────────────────────────────────────────────────── */

function SidebarItem({ item, active, t }) {
  const { Icon, label, href } = item;
  return (
    <Link href={href} style={{
      position: "relative",
      display: "flex", alignItems: "center", gap: 10,
      padding: "9px 14px", borderRadius: 10,
      fontSize: 13, fontWeight: active ? 700 : 500,
      color: active ? t.white : t.textMuted,
      background: active ? `linear-gradient(90deg, ${t.accent}20, transparent)` : "transparent",
      textDecoration: "none",
    }}>
      {active && (
        <span style={{
          position: "absolute", left: 0, top: 6, bottom: 6, width: 3,
          background: `linear-gradient(180deg, #a855f7, ${t.accent})`,
          borderRadius: 2, boxShadow: `0 0 10px #a855f7`,
        }} />
      )}
      <Icon size={15} style={{ flexShrink: 0 }} />
      {label}
    </Link>
  );
}

function LeftSidebar({ t, onClose }) {
  const pathname = usePathname() || "";
  const isActive = (href) => pathname === href || pathname === href + "/"
    || (href !== "/skills" && pathname.startsWith(href));

  return (
    <aside className="sk-sidebar" style={{
      width: 240, flexShrink: 0,
      padding: "20px 14px 20px",
      borderRight: `1px solid ${t.border}`,
      background: t.bg,
      display: "flex", flexDirection: "column", gap: 18,
      height: "calc(100vh - 56px)",
      position: "sticky", top: 56,
      overflowY: "auto",
    }}>
      {/* Close button for mobile drawer */}
      {onClose && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={onClose}
          className="sk-sidebar-close"
          style={{
            display: "none", // shown on mobile via media query
            position: "absolute", top: 12, right: 12,
            border: "none", background: "transparent", color: t.text, cursor: "pointer",
          }}
        >
          <XIcon size={20} />
        </button>
      )}

      <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {SIDEBAR_PRIMARY.map(item => (
          <SidebarItem key={item.key} item={item} active={isActive(item.href)} t={t} />
        ))}
      </nav>

      <div>
        <div style={{
          padding: "0 14px 8px",
          fontSize: 10, fontWeight: 700, letterSpacing: 1.2,
          textTransform: "uppercase", color: t.textDim,
        }}>
          Categories
        </div>
        <nav style={{ display: "flex", flexDirection: "column" }}>
          {SIDEBAR_CATEGORIES.map(c => (
            <Link key={c.label} href={c.href} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 14px", fontSize: 12.5,
              color: t.textMuted, textDecoration: "none",
              borderRadius: 8,
            }}>
              <span>{c.label}</span>
              <span style={{
                fontSize: 11, fontFamily: "var(--font-jetbrains-mono), monospace",
                color: t.textDim,
              }}>
                {c.count}
              </span>
            </Link>
          ))}
        </nav>
      </div>

      <div style={{ flex: 1 }} />

      <EarnCta t={t} />
    </aside>
  );
}

function EarnCta({ t }) {
  return (
    <div style={{
      position: "relative", overflow: "hidden",
      borderRadius: 14,
      padding: "18px 16px 16px",
      background: `linear-gradient(160deg, rgba(168,85,247,0.14), rgba(59,130,246,0.10) 50%, transparent)`,
      border: `1px solid ${t.border}`,
      textAlign: "center",
    }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: t.white, marginBottom: 4 }}>
        Earn with your skills
      </div>
      <div style={{ fontSize: 11.5, color: t.textMuted, marginBottom: 12, lineHeight: 1.5 }}>
        Create once, earn forever.
      </div>
      <div aria-hidden style={{
        width: 84, height: 84, margin: "0 auto 12px",
        borderRadius: "50%",
        background: `radial-gradient(circle at center, rgba(168,85,247,0.35), transparent 65%)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 38,
      }}>
        💰
      </div>
      <Link href="/skills/create" style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
        width: "100%", padding: "9px 14px",
        background: `linear-gradient(135deg, #a855f7, ${t.accent})`,
        border: "none", borderRadius: 10,
        fontSize: 12.5, fontWeight: 700, color: "#fff",
        textDecoration: "none",
        boxShadow: `0 8px 22px rgba(168,85,247,0.35)`,
      }}>
        Create a skill
      </Link>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
   Shell
   ────────────────────────────────────────────────────────────── */

export default function SkillsShell({ children }) {
  const t = useTheme();
  // `showModal` from the wallet context now opens the unified Connect
  // Account dialog (NEAR / Google / EVM / Solana) directly — no more
  // nested ConnectAccountModal layer. Each pick triggers its connect
  // function on the first click, no double-tap bounce.
  const { showModal: openConnect } = useWallet?.() || {};
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close drawer on route change or resize-up past mobile.
  const pathname = usePathname();
  useEffect(() => { setDrawerOpen(false); }, [pathname]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => { if (window.innerWidth >= 768) setDrawerOpen(false); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div
      data-app-shell="ready"
      style={{ background: t.bg, color: t.text, minHeight: "100vh" }}
    >
      <TopNav
        t={t}
        onToggleDrawer={() => setDrawerOpen(v => !v)}
        onOpenConnect={() => openConnect?.()}
      />

      <div style={{ display: "flex", alignItems: "flex-start" }}>
        {/* Desktop sidebar */}
        <div className="sk-sidebar-wrap">
          <LeftSidebar t={t} />
        </div>

        {/* Mobile drawer */}
        {drawerOpen && (
          <>
            <div
              onClick={() => setDrawerOpen(false)}
              style={{
                position: "fixed", inset: 0, top: 56, zIndex: 40,
                background: "rgba(0,0,0,0.6)",
              }}
            />
            <div className="sk-sidebar-drawer" style={{
              position: "fixed", top: 56, bottom: 0, left: 0, zIndex: 41,
              width: 280, maxWidth: "82vw",
              background: t.bg, borderRight: `1px solid ${t.border}`,
              overflowY: "auto",
            }}>
              <LeftSidebar t={t} onClose={() => setDrawerOpen(false)} />
            </div>
          </>
        )}

        <main className="sk-main" style={{
          flex: 1, minWidth: 0,
          padding: "28px 36px 80px",
          maxWidth: "100%",
        }}>
          {children}
        </main>
      </div>

      <style jsx global>{`
        /* Desktop default already rendered above; these are overrides. */

        /* Tablet: tighten sidebar + main padding */
        @media (max-width: 1100px) {
          .sk-main { padding: 24px 22px 80px !important; }
          .sk-sidebar { width: 220px !important; }
        }

        /* Mobile: hide sidebar inline, show hamburger, compress nav */
        @media (max-width: 768px) {
          .sk-hamburger { display: inline-flex !important; }
          .sk-sidebar-wrap { display: none !important; }
          .sk-sidebar-close { display: inline-flex !important; }
          .sk-toptabs { display: none !important; }
          .sk-search { display: none !important; }
          .sk-notif { display: none !important; }
          .sk-main { padding: 20px 16px 100px !important; }
          .sk-profile > span:nth-of-type(2) { display: none !important; }
        }

        /* Very narrow: keep profile chip minimal */
        @media (max-width: 420px) {
          .sk-profile { padding: 4px !important; }
        }

        /* Body scroll-lock while drawer is open */
        html:has(.sk-sidebar-drawer) { overflow: hidden; }
      `}</style>
    </div>
  );
}
