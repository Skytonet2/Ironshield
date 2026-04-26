"use client";
// AppShell — the new platform chrome (spec Section 2).
//
// Layout:
//   ┌─ TopNav (44px) ─────────────────────────────────┐
//   ├ Sidebar (220) ┬ Main ┬ Right panel (280) ──────┤
//   └────────── BottomBar (32px) ─────────────────────┘
//
// This shell is opt-in per route. It wraps `/aio` today; later phases
// will migrate Vision/Trading/Portfolio/Settings/etc. behind it. The
// legacy single-page router at src/app/page.js is untouched so the
// live site doesn't regress while we ship this in parallel.
//
// AppShell accepts a `rightPanel` slot because the right column is
// context-sensitive per the spec: AIO → "Your Deploys"; Vision →
// tracker controls; Trading → order book. Children fill the main
// feed column.

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import {
  LazyMotion, domAnimation, m, AnimatePresence, pageVariants,
} from "@/lib/motion";
import { useNotifications, prependNotification } from "@/lib/hooks/useNotifications";
import { usePWA } from "@/lib/usePWA";
import * as wsClient from "@/lib/ws/wsClient";
import { fetchWsTicket } from "@/lib/wsTicket";
import NotificationsDrawer from "@/components/notifications/NotificationsDrawer";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/brand/Brand";
import {
  Search, Zap, Plus, ArrowLeftRight, Bell, Bookmark,
  Eye, Trophy, Briefcase, Bot, Settings, DollarSign,
  Shield, Rss, Activity, Coins, Vote, Rocket, Mic, Network, BookOpen,
  Home, Menu, X as XIcon, User, MessageCircle, Users, Sparkles,
} from "lucide-react";
import { useTheme, useWallet as useCtxWallet } from "@/lib/contexts";
import { useSettings } from "@/lib/stores/settingsStore";
import { useFeed } from "@/lib/stores/feedStore";
import { usePrices } from "@/lib/hooks/usePrices";
import AmbientBackground from "./AmbientBackground";
import UserMenu from "@/components/auth/UserMenu";
import LaunchpadSelector from "@/components/create/LaunchpadSelector";
import BridgeModal from "@/components/bridge/BridgeModal";
import SearchOverlay from "@/components/search/SearchOverlay";
import useKeyboardShortcuts from "@/lib/hooks/useKeyboardShortcuts";
import useMediaQuery from "@/lib/hooks/useMediaQuery";

// lucide-react has no Bridge glyph; ArrowLeftRight is the closest
// semantic fit for a cross-chain swap action.
const BridgeSafe = ArrowLeftRight;

/* ─── Sidebar ─────────────────────────────────────────────────────── */

const SIDEBAR_GROUPS = [
  {
    label: "Feed",
    items: [
      // Each of these cross-links to /feed and also broadcasts an
      // "ironshield:feed-tab" event the feed page listens for, so the
      // active tab follows the sidebar selection immediately — no
      // need to re-navigate when the user's already on /feed.
      { key: "feed/foryou",          label: "For You",          Icon: Home,      href: "/feed?tab=foryou",          feedTab: "foryou" },
      { key: "feed/following",       label: "Following",        Icon: User,      href: "/feed?tab=following",       feedTab: "following" },
      { key: "feed/voices",          label: "Voices",           Icon: Mic,       href: "/feed?tab=voices",          feedTab: "voices" },
      { key: "feed/alpha",           label: "Alpha",            Icon: Activity,  href: "/feed?tab=alpha",           feedTab: "alpha" },
      { key: "feed/news",            label: "News",             Icon: Rss,       href: "/feed?tab=news",            feedTab: "news" },
      { key: "feed/ironclaw-alerts", label: "IronClaw Alerts",  Icon: Bell,      href: "/feed?tab=ironclaw-alerts", feedTab: "ironclaw-alerts" },
    ],
  },
  {
    label: "Create",
    items: [
      { key: "post", label: "Post", Icon: Rocket, action: "post", shortcut: "⌘K" },
    ],
  },
  {
    label: "Platform",
    items: [
      { key: "ironfeed",    label: "IronFeed",         Icon: Rss,            href: "/feed"        },
      { key: "messages",    label: "Messages",         Icon: MessageCircle,  href: "/messages"    },
      { key: "newscoin",    label: "NewsCoin",         Icon: Coins,          href: "/newscoin"    },
      { key: "portfolio",   label: "Portfolio",        Icon: Briefcase,      href: "/portfolio"   },
      { key: "bridge",      label: "Bridge",           Icon: ArrowLeftRight, href: "/bridge"      },
      { key: "automations", label: "Automations",      Icon: Zap,            href: "/automations" },
      { key: "profile",     label: "Profile",          Icon: User,           href: "/profile"     },
      { key: "rewards",     label: "Rewards",          Icon: Trophy,         href: "/rewards"     },
      { key: "rooms",       label: "Rooms",            Icon: Mic,            href: "/rooms"       },
    ],
  },
  {
    label: "IronClaw",
    items: [
      { key: "staking",     label: "Staking",          Icon: Coins,      href: "/staking"     },
      { key: "governance",  label: "Governance",       Icon: Vote,       href: "/governance"  },
      { key: "treasury",    label: "Treasury",         Icon: Briefcase,  href: "/treasury"    },
      { key: "earn",        label: "Earn",             Icon: Trophy,     href: "/earn"        },
      { key: "agent",       label: "Agent",            Icon: Bot,        href: "/agent"       },
      // Phase 5/6 agent platform routes. Kept below the legacy "Agent"
      // link so the IronClaw autonomous agent stays the top-level entry;
      // the user-owned profiles and marketplace sit underneath.
      { key: "my-agent",    label: "My Agent",         Icon: User,       href: "/agents/me"   },
      { key: "agents",      label: "Agents",           Icon: Users,      href: "/agents"      },
      { key: "skills",      label: "Skills",           Icon: Sparkles,   href: "/skills"      },
      { key: "ecosystem",   label: "Ecosystem",        Icon: Network,    href: "/ecosystem"   },
      { key: "docs",        label: "Docs",             Icon: BookOpen,   href: "/docs"        },
    ],
  },
  {
    label: "Tools",
    items: [
      { key: "settings",  label: "Settings",  Icon: Settings,    href: "/settings"  },
    ],
  },
];

function SidebarItem({ item, active, onAction, onClick, t }) {
  const { Icon, label, soon, shortcut, feedTab } = item;
  const content = (
    <>
      {/* Active indicator — left edge accent bar. Glows softly. */}
      {active && (
        <span style={{
          position: "absolute", left: 0, top: 6, bottom: 6,
          width: 3, borderRadius: 2,
          background: `linear-gradient(180deg, ${t.accent}, #0ea5e9)`,
          boxShadow: `0 0 12px ${t.accent}`,
        }} />
      )}
      <Icon size={16} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {shortcut && (
        <span style={{
          fontSize: 10, padding: "1px 6px", borderRadius: 4,
          background: t.bgSurface, color: t.textDim,
          letterSpacing: 0.4, fontFamily: "var(--font-jetbrains-mono), monospace",
        }}>
          {shortcut}
        </span>
      )}
      {soon && (
        <span style={{
          fontSize: 9, padding: "1px 6px", borderRadius: 4,
          background: t.bgSurface, color: t.textDim, letterSpacing: 0.5,
        }}>
          SOON
        </span>
      )}
    </>
  );
  const base = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px 8px 14px",
    borderRadius: 8,
    color: active ? t.white : t.textMuted,
    background: active ? "linear-gradient(90deg, var(--accent-dim), transparent)" : "transparent",
    fontSize: 13,
    fontWeight: active ? 700 : 500,
    textDecoration: "none",
    cursor: "pointer",
    border: "none",
    width: "100%",
    textAlign: "left",
    position: "relative",
    transition: "color 120ms ease, background 120ms ease",
  };
  const handleClick = (e) => {
    // When the item is a feed filter AND we're already on /feed, swap
    // the tab in place instead of reloading.
    if (feedTab && typeof window !== "undefined" && window.location.pathname.startsWith("/feed")) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("ironshield:feed-tab", { detail: feedTab }));
      // Keep the URL in sync so refreshes land on the same tab.
      try { window.history.replaceState(null, "", item.href); } catch {}
    }
    onClick?.(e);
  };
  if (item.href) {
    // Use Next's <Link> for client-side navigation — previously
    // bare <a href> forced a full-page reload on every sidebar click,
    // which re-runs the whole provider tree (Privy, NEAR selector,
    // Proposals) and makes cross-section hops feel sluggish. With
    // <Link> the shell stays mounted and only the route segment
    // swaps; prefetch kicks in on hover so the next page's JS + data
    // start loading before the click completes.
    return (
      <Link
        href={item.href}
        onClick={handleClick}
        prefetch
        className={active ? "sidebar-item active" : "sidebar-item"}
        style={base}
      >
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className="sidebar-item"
      style={base}
      onClick={() => onAction(item.action)}
    >
      {content}
    </button>
  );
}

function SidebarContent({ pathname, onAction, onItemPick }) {
  const t = useTheme();
  // Track the current feed tab so sidebar sub-feed items (For You,
  // Following, Voices, ...) can show the correct active highlight
  // even without a full navigation. Initial value reads ?tab=, then
  // listens for the ironshield:feed-tab event we emit when a nav item
  // is picked or the feed page's tab strip updates.
  const [feedTab, setFeedTab] = useState(() => {
    if (typeof window === "undefined") return "foryou";
    try { return new URLSearchParams(window.location.search).get("tab") || "foryou"; }
    catch { return "foryou"; }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onTab = (e) => { if (e.detail) setFeedTab(e.detail); };
    const onPop = () => {
      try { setFeedTab(new URLSearchParams(window.location.search).get("tab") || "foryou"); }
      catch {}
    };
    window.addEventListener("ironshield:feed-tab", onTab);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("ironshield:feed-tab", onTab);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  return (
    <>
      {SIDEBAR_GROUPS.map((group) => (
        <div key={group.label}>
          <div style={{
            fontSize: 10,
            letterSpacing: 1.2,
            fontWeight: 600,
            color: t.textDim,
            textTransform: "uppercase",
            padding: "0 12px 6px",
          }}>
            {group.label}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {group.items.map((item) => {
              // A Feed-section item is active when we're on /feed AND
              // its feedTab matches the currently-selected tab. A
              // regular href item is active when the pathname matches;
              // we also guard the plain /feed item so it's NOT active
              // when a Feed-section sub-item has the focus.
              let active = false;
              if (item.feedTab) {
                active = pathname?.startsWith("/feed") && feedTab === item.feedTab;
              } else if (item.href === "/") {
                active = pathname === "/";
              } else if (item.href === "/feed") {
                // Suppress the regular "IronFeed" row's highlight
                // when a Feed-section sub-item owns it. Keeps the
                // sidebar from showing two active rows at once.
                active = pathname?.startsWith("/feed") && !SIDEBAR_GROUPS[0].items.some((i) => i.feedTab === feedTab);
              } else if (item.href) {
                active = pathname?.startsWith(item.href);
              }
              return (
                <SidebarItem
                  key={item.key}
                  item={item}
                  active={active}
                  onAction={(a) => { onAction(a); onItemPick?.(); }}
                  onClick={() => { onItemPick?.(); if (item.feedTab) setFeedTab(item.feedTab); }}
                  t={t}
                />
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

/** Desktop: always-visible 220px rail. Mobile: slide-in drawer with
 *  backdrop, opened by the TopNav hamburger. Body scroll is locked
 *  while the drawer is open so long content doesn't bleed through. */
function Sidebar({ pathname, onAction, isMobile, drawerOpen, onClose }) {
  const t = useTheme();
  useEffect(() => {
    if (!isMobile) return;
    document.body.style.overflow = drawerOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isMobile, drawerOpen]);

  const panel = (
    <aside style={{
      width: 260,
      flexShrink: 0,
      borderRight: `1px solid ${t.border}`,
      padding: "16px 10px",
      display: "flex",
      flexDirection: "column",
      gap: 20,
      overflowY: "auto",
      background: "var(--bg-surface)",
      height: "100%",
    }}>
      {/* Brand cluster at the top of the rail — matches the TopNav
          brand so the full-width shell feels unified. On mobile the
          drawer gets the same header so users don't lose orientation. */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "0 10px 14px",
        borderBottom: `1px solid ${t.border}`,
        margin: "0 -4px 4px",
      }}>
        <BrandMark size={22} withWordmark />
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 20 }}>
        <SidebarContent
          pathname={pathname}
          onAction={onAction}
          onItemPick={isMobile ? onClose : undefined}
        />
      </div>

      {/* IronShield Pro upgrade card — sticks to the bottom of the
          rail. Gradient fill, subtle glow, premium call-to-action.
          Pro tier launches with v1.0.0 (Day 21). Until then this links
          to a stub section on /rewards rather than 404'ing. */}
      <a
        href="/rewards#pro"
        style={{
          display: "block", textDecoration: "none",
          padding: 14, borderRadius: 14,
          background: "linear-gradient(135deg, rgba(168,85,247,0.18), rgba(59,130,246,0.14))",
          border: `1px solid rgba(168,85,247,0.35)`,
          boxShadow: "0 0 0 1px rgba(168,85,247,0.08) inset, 0 12px 30px rgba(168,85,247,0.12)",
          color: "inherit",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 800, color: t.white, letterSpacing: -0.2 }}>
          IronShield Pro
        </div>
        <div style={{ fontSize: 11, color: t.textMuted, marginTop: 4, lineHeight: 1.45 }}>
          Unlock advanced analytics and exclusive features.
        </div>
        <div style={{
          marginTop: 10,
          display: "inline-block",
          padding: "6px 12px", borderRadius: 8,
          background: `linear-gradient(135deg, #a855f7, ${t.accent})`,
          color: "#fff", fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
        }}>
          Upgrade
        </div>
      </a>
    </aside>
  );

  if (!isMobile) return panel;

  // Mobile: drawer only mounts when open so it doesn't steal tab-order
  // or fire matchmedia reflows while hidden.
  if (!drawerOpen) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 180,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
        display: "flex",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          height: "100dvh",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5), var(--accent-glow)",
          animation: "drawerIn 200ms var(--ease-out)",
        }}
      >
        {panel}
      </div>
      <style jsx>{`
        @keyframes drawerIn {
          from { transform: translateX(-100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}

/* ─── TopNav ──────────────────────────────────────────────────────── */

const TOP_PILLS = [
  { label: "Feed",        href: "/feed" },
  { label: "NewsCoin",    href: "/newscoin" },
  { label: "Portfolio",   href: "/portfolio" },
  { label: "Automations", href: "/automations" },
  { label: "Rewards",     href: "/rewards" },
  { label: "Profile",     href: "/profile" },
];

function TopNav({ pathname, onAction, isMobile, onDrawer, unreadCount = 0 }) {
  const t = useTheme();
  const pillBase = {
    padding: "6px 14px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 500,
    textDecoration: "none",
    color: t.textMuted,
    transition: "background var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out)",
  };
  const iconBtn = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 34,
    height: 34,
    borderRadius: 8,
    background: "transparent",
    border: `1px solid ${t.border}`,
    color: t.textMuted,
    cursor: "pointer",
  };
  return (
    <header style={{
      height: 44,
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "0 14px",
      borderBottom: `1px solid ${t.border}`,
      background: "var(--bg-surface)",
    }}>
      {isMobile && (
        <button
          type="button"
          onClick={onDrawer}
          aria-label="Open menu"
          style={{
            width: 34, height: 34, borderRadius: 8,
            border: `1px solid ${t.border}`,
            background: "transparent",
            color: t.textMuted,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <Menu size={16} />
        </button>
      )}
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", color: t.text }}>
        <BrandMark size={20} withWordmark />
      </Link>
      {!isMobile && (
      <nav style={{ display: "flex", gap: 4, marginLeft: 20 }}>
        {TOP_PILLS.map((p) => {
          const active = pathname?.startsWith(p.href);
          return (
            <Link
              key={p.href}
              href={p.href}
              prefetch
              style={{
                ...pillBase,
                color: active ? t.white : t.textMuted,
                background: active ? "var(--accent-dim)" : "transparent",
              }}
            >
              {p.label}
            </Link>
          );
        })}
      </nav>
      )}
      <div style={{ flex: 1 }} />
      {!isMobile && (
      <button
        type="button"
        onClick={() => onAction("search")}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          height: 34,
          minWidth: 220,
          borderRadius: 8,
          background: "var(--bg-input)",
          border: `1px solid ${t.border}`,
          color: t.textDim,
          fontSize: 12,
          cursor: "text",
        }}
      >
        <Search size={14} />
        <span>Search anything</span>
        <span style={{
          marginLeft: "auto",
          fontSize: 10,
          padding: "1px 6px",
          borderRadius: 4,
          border: `1px solid ${t.border}`,
          color: t.textDim,
          fontFamily: "var(--font-jetbrains-mono), monospace",
        }}>/</span>
      </button>
      )}
      {/* Mobile: compact search icon only. */}
      {isMobile && (
        <button
          type="button"
          onClick={() => onAction("search")}
          style={iconBtn}
          aria-label="Search"
        >
          <Search size={14} />
        </button>
      )}
      {!isMobile && (
        <button type="button" onClick={() => onAction("tweet")} style={iconBtn} title="Post">
          <span style={{ fontWeight: 700 }}>𝕏</span>
        </button>
      )}
      <button
        type="button"
        onClick={() => onAction("create")}
        style={{
          padding: isMobile ? "6px 10px" : "6px 14px",
          height: 34,
          borderRadius: 8,
          background: t.accent,
          color: "#fff",
          border: "none",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.6,
          cursor: "pointer",
        }}
      >
        {isMobile ? <Plus size={14} /> : "CREATE"}
      </button>
      {!isMobile && (
        <button type="button" onClick={() => onAction("scan")} style={{ ...iconBtn, fontSize: 11, width: "auto", padding: "0 10px" }} title="Scan">
          <Zap size={14} />
          <span style={{ marginLeft: 4, fontWeight: 700, letterSpacing: 0.6 }}>SCAN</span>
        </button>
      )}
      {!isMobile && (
        <button
          type="button"
          style={iconBtn}
          title="Bookmarks"
          onClick={() => onAction("bookmarks")}
        ><Bookmark size={14} /></button>
      )}
      {!isMobile && (
        <button
          type="button"
          style={{ ...iconBtn, position: "relative" }}
          title="Notifications"
          onClick={() => onAction("notifications")}
        >
          <Bell size={14} />
          {unreadCount > 0 && (
            <span style={{
              position: "absolute", top: -4, right: -4,
              minWidth: 16, height: 16, padding: "0 4px",
              borderRadius: 999,
              background: "linear-gradient(135deg, #ef4444, #f97316)",
              color: "#fff", fontSize: 10, fontWeight: 800,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 0 2px var(--bg-surface)",
            }}>
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      )}
      <UserMenu />
    </header>
  );
}

/* ─── BottomBar ───────────────────────────────────────────────────── */

function fmtUsd(n) {
  if (n == null) return "—";
  if (n >= 100) return `$${n.toFixed(2)}`;
  if (n >= 1)   return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}

/* ── Mobile bottom nav — native-feel primary navigation for phones.
 * Five items: Home · Search · + (gradient FAB) · Messages · Profile.
 * The middle +, centered and raised, is the post shortcut — tapping
 * it fires the same "post" action that opens the feed composer.
 * Notifications still live on the top bell; this slot is DMs so the
 * inbox is one tap away on mobile.
 * Active route shows an accent tint + top-edge bar. */
function MobileBottomNav({ pathname, onAction, unreadCount = 0, dmUnread = 0 }) {
  const t = useTheme();
  // Notifications sits in slot 2 (was Search) so users have the same
  // bell affordance mobile as desktop — it's the only way for mobile
  // users to open the NotificationsDrawer. Search stays reachable via
  // the \`/\` hotkey and the hamburger drawer. The badge reads the
  // shared unread count polled by useNotifications in AppShell.
  const items = [
    { key: "home",      label: "Home",   Icon: Home,          kind: "link",   href: "/"        },
    { key: "alerts",    label: "Alerts", Icon: Bell,          kind: "action", action: "notifications", badge: unreadCount },
    { key: "post",      label: "",       Icon: Plus,          kind: "fab",    action: "post"   },
    { key: "messages",  label: "Chat",   Icon: MessageCircle, kind: "link",   href: "/messages", badge: dmUnread },
    { key: "profile",   label: "Profile",Icon: User,          kind: "link",   href: "/profile" },
  ];
  const activeKey = (() => {
    if (pathname?.startsWith("/profile"))  return "profile";
    if (pathname?.startsWith("/messages")) return "messages";
    if (pathname === "/")                  return "home";
    return null;
  })();

  return (
    <nav
      role="navigation"
      aria-label="Primary"
      style={{
        height: 64,
        display: "flex",
        alignItems: "stretch",
        justifyContent: "space-around",
        padding: "0 4px",
        borderTop: `1px solid ${t.border}`,
        background: "linear-gradient(180deg, rgba(11,15,32,0.92), rgba(8,11,22,0.98))",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        flexShrink: 0,
      }}
    >
      {items.map((it) => {
        const active = it.key === activeKey;
        if (it.kind === "fab") {
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => onAction(it.action)}
              aria-label="Post"
              style={{
                alignSelf: "center",
                width: 56, height: 56, borderRadius: "50%",
                border: "none",
                background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
                color: "#fff", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 12px 28px rgba(168,85,247,0.45), inset 0 1px 0 rgba(255,255,255,0.2)",
                transform: "translateY(-14px)",
              }}
            >
              <it.Icon size={22} />
            </button>
          );
        }
        const content = (
          <>
            <div style={{ position: "relative" }}>
              <it.Icon size={22} color={active ? t.accent : t.textMuted} />
              {it.badge > 0 && (
                <span style={{
                  position: "absolute", top: -4, right: -8,
                  minWidth: 16, height: 16, padding: "0 4px",
                  borderRadius: 999,
                  background: "linear-gradient(135deg, #ef4444, #f97316)",
                  color: "#fff", fontSize: 10, fontWeight: 800,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 0 0 2px var(--bg-surface)",
                }}>{it.badge}</span>
              )}
            </div>
            <span style={{
              fontSize: 10, fontWeight: 600, letterSpacing: 0.3,
              color: active ? t.accent : t.textMuted,
            }}>{it.label}</span>
          </>
        );
        const sharedStyle = {
          flex: 1,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          gap: 3,
          background: "transparent", border: "none",
          cursor: "pointer", textDecoration: "none",
          position: "relative",
        };
        if (it.kind === "link") {
          return (
            <Link key={it.key} href={it.href} prefetch style={sharedStyle}>
              {active && (
                <span style={{
                  position: "absolute", top: 0, left: "30%", right: "30%",
                  height: 2, borderRadius: 2,
                  background: `linear-gradient(90deg, ${t.accent}, #a855f7)`,
                }} />
              )}
              {content}
            </Link>
          );
        }
        return (
          <button key={it.key} type="button" onClick={() => onAction(it.action)} style={sharedStyle}>
            {active && (
              <span style={{
                position: "absolute", top: 0, left: "30%", right: "30%",
                height: 2, borderRadius: 2,
                background: `linear-gradient(90deg, ${t.accent}, #a855f7)`,
              }} />
            )}
            {content}
          </button>
        );
      })}
    </nav>
  );
}

function BottomBar() {
  const t = useTheme();
  const prices = usePrices();
  const wsStatus = useFeed((s) => s.wsStatus);
  const activeChain = useSettings((s) => s.activeChain);
  const setActiveChain = useSettings((s) => s.setActiveChain);

  const dotColor = {
    connected:    "var(--green)",
    connecting:   "var(--amber)",
    disconnected: "var(--red)",
  }[wsStatus] || "var(--red)";

  const chip = {
    fontSize: 11,
    padding: "2px 8px",
    borderRadius: 4,
    background: "var(--bg-input)",
    color: t.textMuted,
    fontFamily: "var(--font-jetbrains-mono), monospace",
  };

  return (
    <footer style={{
      height: 32,
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "0 14px",
      borderTop: `1px solid ${t.border}`,
      background: "var(--bg-surface)",
      fontSize: 11,
      color: t.textMuted,
      // On mobile the chip row overflows; scroll horizontally instead
      // of wrapping (keeping a single 32px-tall strip).
      overflowX: "auto",
      overflowY: "hidden",
      whiteSpace: "nowrap",
      flexShrink: 0,
    }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: dotColor,
          boxShadow: `0 0 6px ${dotColor}`,
        }} />
        <span style={{ textTransform: "capitalize" }}>{wsStatus}</span>
      </span>
      <span style={chip}>Feed</span>
      <div style={{ flex: 1 }} />
      <span style={chip}>SOL {fmtUsd(prices.sol)}</span>
      <span style={chip}>NEAR {fmtUsd(prices.near)}</span>
      {/* BNB price hidden — BNB is opted out until the fee wallet is funded. */}
      {/* Cycle NEAR ↔ SOL. BNB is opted out until the fee wallet is
       * funded — the walletStore still has a `bnb` slot so toggling
       * back on later is a one-line change here. */}
      <button
        type="button"
        onClick={() => {
          const order = ["near", "sol"];
          const i = order.indexOf(activeChain);
          setActiveChain(order[(i + 1) % order.length] || order[0]);
        }}
        style={{
          ...chip,
          border: `1px solid ${t.border}`,
          cursor: "pointer",
          textTransform: "uppercase",
          letterSpacing: 0.6,
          background: "var(--accent-dim)",
          color: t.accent,
        }}
        title="Cycle active chain"
      >
        ⚡ {activeChain}
      </button>
      <a href="https://x.com/ironclaw" target="_blank" rel="noreferrer" style={{ color: t.textMuted, textDecoration: "none" }}>𝕏</a>
      <a href="https://t.me/IronClawHQ" target="_blank" rel="noreferrer" style={{ color: t.textMuted, textDecoration: "none" }}>TG</a>
    </footer>
  );
}

/* ─── AppShell (composition) ──────────────────────────────────────── */

export default function AppShell({ children, rightPanel = null, onAction }) {
  const t = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const wallet = useCtxWallet();
  const walletAddress = wallet?.address || null;
  const [note, setNote] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createPrefill, setCreatePrefill] = useState(null);
  const [bridgeOpen, setBridgeOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const setPaused = useFeed((s) => s.setPaused);
  const pausedNow = useFeed((s) => s.paused);
  // Shared notifications cache — populates both the TopNav bell
  // badge and the mobile Alerts tab badge with the viewer's real
  // unread count (polled every 30s while the shell is mounted).
  const { unreadCount } = useNotifications(walletAddress);

  // Register the service worker and re-sync the push subscription with
  // the backend whenever the wallet changes. Without this, no SW exists
  // on the page and web push can't be delivered — OS notifications
  // literally cannot fire without an active worker.
  usePWA(walletAddress);

  // DM unread count for the mobile Messages tab badge. One-shot fetch
  // on wallet connect to seed the counter, then live updates via the
  // WS `dm:new` event (Day 5.5 — replaces the old 30s poll). The poll
  // was burning ~33 req/s of pure idle traffic at 1k connected users;
  // the WS path moves that to 0.
  const [dmUnread, setDmUnread] = useState(0);
  useEffect(() => {
    if (!walletAddress) { setDmUnread(0); return; }
    const API = (() => {
      if (process.env.NEXT_PUBLIC_BACKEND_URL) return process.env.NEXT_PUBLIC_BACKEND_URL.replace(/\/+$/, "");
      if (typeof window !== "undefined") {
        const h = window.location.hostname;
        if (h === "localhost" || h === "127.0.0.1") return "http://localhost:3001";
      }
      return "https://ironclaw-backend.onrender.com";
    })();
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`${API}/api/dm/conversations`, {
          headers: { "x-wallet": walletAddress },
        });
        if (!r.ok) return;
        const j = await r.json();
        if (!alive) return;
        const total = (j.conversations || []).reduce((s, c) => s + (c.unread || 0), 0);
        setDmUnread(total);
      } catch { /* silent */ }
    })();
    // Optimistic +1 on every dm:new pushed for this wallet. The user
    // landing on /messages clears unread on the server, and the next
    // wallet-change re-seed pulls authoritative truth.
    const off = wsClient.addListener("dm:new", () => {
      if (!alive) return;
      setDmUnread((n) => n + 1);
    });
    return () => { alive = false; off(); };
  }, [walletAddress]);

  // Authenticated WS connection for live DM + notification delivery.
  // Ticket is minted via signed REST per /api/auth/ws-ticket and
  // re-fetched on every reconnect; wsClient handles the auth handshake
  // before any subscribe.
  useEffect(() => {
    if (!walletAddress) return;
    wsClient.connect({
      wallet: walletAddress.toLowerCase(),
      ticketProvider: fetchWsTicket,
      trackers: ["dm:new", "notification:new"],
    });
    const off = wsClient.addListener("notification:new", (event) => {
      if (event?.notification) prependNotification(event.notification);
    });
    return () => { off(); };
  }, [walletAddress]);

  // AppShell routes CREATE / bridge / scan / search centrally so every
  // route gets these modals without plumbing props. Callers can still
  // pass onAction for route-specific overrides (e.g. /trading's "open
  // the order book" later).
  const handleAction = onAction || ((kind) => {
    if (kind === "create") { setCreateOpen(true); setCreatePrefill(null); return; }
    if (kind === "bridge") {
      // Bridge used to open as a modal; it's now a dedicated route
      // with chain pickers + amount + review flow. Deep-link over so
      // the modal state doesn't double-mount alongside the page.
      if (typeof window !== "undefined") router.push("/bridge");
      return;
    }
    if (kind === "search") { setSearchOpen(true); return; }
    // Sidebar "Post" and TopNav "tweet" both land on the feed
    // composer. If we're already on the feed, broadcast an event
    // the composer listens for; otherwise deep-link over with
    // ?compose=1 which the ComposeBar reads on mount.
    if (kind === "post" || kind === "tweet") {
      if (typeof window !== "undefined") {
        if (pathname?.startsWith("/feed")) {
          window.dispatchEvent(new CustomEvent("ironshield:open-composer"));
        } else {
          router.push("/feed?compose=1");
        }
      }
      return;
    }
    if (kind === "scan") {
      // Quick Scan: ask for a CA or ticker and route to NewsCoin's
      // detail terminal. The terminal handles "this coin doesn't
      // exist" gracefully.
      if (typeof window !== "undefined") {
        const q = window.prompt("Enter a contract address or ticker to scan:");
        if (q && q.trim()) {
          window.location.href = `/newscoin?token=${encodeURIComponent(q.trim())}`;
        }
      }
      return;
    }
    if (kind === "bookmarks") {
      if (typeof window !== "undefined") router.push("/profile?tab=bookmarks");
      return;
    }
    if (kind === "notifications") {
      setNotificationsOpen(true);
      return;
    }
    setNote(`${kind} (wires up in a later phase)`);
  });

  // Global keybinds: / opens search, p pauses/unpauses feed.
  // Escape close is handled by each modal locally — when multiple are
  // stacked, only the topmost should close. We pass a no-op here.
  useKeyboardShortcuts({
    onSearch:      () => setSearchOpen(true),
    onPauseToggle: () => setPaused(!pausedNow),
  });

  // Responsive: <900px collapses sidebar to drawer, hides center top-
  // nav pills + secondary icon buttons, hides the right panel. Match
  // the query exactly so desktop-at-exactly-900 stays desktop.
  const isMobile = useMediaQuery("(max-width: 899px)");
  const isNarrow = useMediaQuery("(max-width: 1199px)");  // hides right panel
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Close drawer on route change so navigating from inside it feels
  // natural. pathname dependency makes this automatic.
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  // ── Resizable right panel ────────────────────────────────────────
  // Users drag the divider between <main> and the right-rail <aside>.
  // Width is clamped to [220, 520] and persisted in localStorage so
  // the preference sticks across sessions and routes.
  const [rightWidth, setRightWidth] = useState(280);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem("ironshield:rightPanelWidth");
      const n = parseInt(raw || "", 10);
      if (Number.isFinite(n) && n >= 220 && n <= 520) setRightWidth(n);
    } catch {}
  }, []);
  const beginResize = useCallback((ev) => {
    ev.preventDefault();
    const startX = ev.clientX ?? ev.touches?.[0]?.clientX ?? 0;
    const startW = rightWidth;
    const onMove = (e) => {
      const x = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
      const next = Math.max(220, Math.min(520, startW + (startX - x)));
      setRightWidth(next);
    };
    const onEnd = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      try { localStorage.setItem("ironshield:rightPanelWidth", String(rightWidth)); } catch {}
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
  }, [rightWidth]);

  return (
    <LazyMotion features={domAnimation}>
    <div data-app-shell="ready" style={{
      display: "flex",
      flexDirection: "column",
      height: "100dvh",
      background: "var(--bg-app)",
      color: t.text,
    }}>
      <AmbientBackground />
      <TopNav
        pathname={pathname}
        onAction={handleAction}
        isMobile={isMobile}
        onDrawer={() => setDrawerOpen(true)}
        unreadCount={unreadCount}
      />
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <Sidebar
          pathname={pathname}
          onAction={handleAction}
          isMobile={isMobile}
          drawerOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
        />
        <main style={{
          flex: 1,
          minWidth: 0,
          overflowY: "auto",
          overflowX: "hidden",   // avoid horizontal overflow from legacy pages
          padding: "0",
          WebkitOverflowScrolling: "touch",
        }}>
          {/* Framer-driven page transition — fades + nudges the child
              tree on every route change. AnimatePresence with the
              pathname as key re-runs on navigation. The LazyMotion
              provider wraps the whole shell so motion components inside
              nested components (FeedCard stagger, composer expand) can
              reuse the already-loaded animation features. */}
          <AnimatePresence mode="wait">
            <m.div
              key={pathname || "_"}
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              style={{ minHeight: "100%" }}
            >
              {children}
            </m.div>
          </AnimatePresence>
        </main>
        {rightPanel && !isNarrow && (
          <>
            {/* Drag handle — thin invisible bar that lets the user
                resize the right rail. Shows a subtle highlight on
                hover so it's discoverable without being heavy. */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize right panel"
              onMouseDown={beginResize}
              onTouchStart={beginResize}
              style={{
                width: 6,
                flexShrink: 0,
                cursor: "col-resize",
                background: "transparent",
                borderLeft: `1px solid ${t.border}`,
                transition: "background 120ms ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accent-dim)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            />
            <aside style={{
              width: rightWidth,
              flexShrink: 0,
              borderLeft: `1px solid ${t.border}`,
              overflowY: "auto",
            }}>
              {rightPanel}
            </aside>
          </>
        )}
      </div>
      {/* Bottom region splits by viewport: mobile gets the native
          five-tab nav, desktop keeps the status/chip strip. */}
      {isMobile
        ? <MobileBottomNav pathname={pathname} onAction={handleAction} unreadCount={unreadCount} dmUnread={dmUnread} />
        : <BottomBar />}
      {createOpen && (
        <LaunchpadSelector
          prefill={createPrefill}
          onClose={() => { setCreateOpen(false); setCreatePrefill(null); }}
        />
      )}
      {bridgeOpen && (
        <BridgeModal onClose={() => setBridgeOpen(false)} />
      )}
      <SearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onAction={handleAction}
      />
      <NotificationsDrawer
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
      />
      {note && (
        <div
          onClick={() => setNote(null)}
          role="status"
          style={{
            position: "fixed",
            bottom: 48,
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--bg-surface)",
            color: t.text,
            border: `1px solid ${t.border}`,
            borderRadius: 8,
            padding: "8px 14px",
            fontSize: 12,
            zIndex: 100,
            cursor: "pointer",
            boxShadow: "var(--accent-glow)",
          }}
        >
          {note}
        </div>
      )}
    </div>
    </LazyMotion>
  );
}
