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

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Search, Zap, Plus, ArrowLeftRight, Bell, Bookmark,
  Eye, Trophy, Briefcase, Bot, Settings, DollarSign, BarChart2,
  Shield, Rss, Activity,
} from "lucide-react";
import { useTheme } from "@/lib/contexts";
import { useSettings } from "@/lib/stores/settingsStore";
import { useFeed } from "@/lib/stores/feedStore";
import { usePrices } from "@/lib/hooks/usePrices";
import AmbientBackground from "./AmbientBackground";
import UserMenu from "@/components/auth/UserMenu";
import LaunchpadSelector from "@/components/create/LaunchpadSelector";
import BridgeModal from "@/components/bridge/BridgeModal";

// lucide-react has no Bridge glyph; ArrowLeftRight is the closest
// semantic fit for a cross-chain swap action.
const BridgeSafe = ArrowLeftRight;

/* ─── Sidebar ─────────────────────────────────────────────────────── */

const SIDEBAR_GROUPS = [
  {
    label: "Commands",
    items: [
      { key: "search",     label: "Search",     Icon: Search,       action: "search" },
      { key: "quick-scan", label: "Quick Scan", Icon: Zap,          action: "scan"   },
      { key: "create",     label: "Create",     Icon: Plus,         action: "create" },
      { key: "bridge",     label: "Bridge",     Icon: BridgeSafe,   action: "bridge" },
    ],
  },
  {
    label: "Platform",
    items: [
      { key: "aio",         label: "AIO Feed",         Icon: Rss,        href: "/aio"         },
      { key: "vision",      label: "Vision",           Icon: Eye,        href: "/vision"      },
      { key: "trading",     label: "Trading Terminal", Icon: Activity,   href: "/trading"     },
      { key: "portfolio",   label: "Portfolio",        Icon: Briefcase,  href: "/portfolio"   },
      { key: "rewards",     label: "Rewards",          Icon: Trophy,     href: "/rewards"     },
      { key: "automations", label: "Automations",      Icon: Bot,        href: "/automations" },
    ],
  },
  {
    label: "Tools",
    items: [
      { key: "settings",  label: "Settings",  Icon: Settings,    href: "/settings"  },
      { key: "earnings",  label: "Earnings",  Icon: DollarSign,  href: "/settings/earnings" },
      { key: "analytics", label: "Analytics", Icon: BarChart2,   href: "/analytics", soon: true },
    ],
  },
];

function SidebarItem({ item, active, onAction, t }) {
  const { Icon, label, soon } = item;
  const content = (
    <>
      <Icon size={16} style={{ flexShrink: 0 }} />
      <span>{label}</span>
      {soon && (
        <span style={{
          marginLeft: "auto",
          fontSize: 9,
          padding: "1px 6px",
          borderRadius: 4,
          background: t.bgSurface,
          color: t.textDim,
          letterSpacing: 0.5,
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
    padding: "8px 12px",
    borderRadius: 8,
    color: active ? t.accent : t.textMuted,
    background: active ? "var(--accent-dim)" : "transparent",
    fontSize: 13,
    fontWeight: 500,
    textDecoration: "none",
    cursor: "pointer",
    border: "none",
    width: "100%",
    textAlign: "left",
    position: "relative",
  };
  if (item.href) {
    return (
      <a href={item.href} className={active ? "sidebar-item active" : "sidebar-item"} style={base}>
        {content}
      </a>
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

function Sidebar({ pathname, onAction }) {
  const t = useTheme();
  return (
    <aside style={{
      width: 220,
      flexShrink: 0,
      borderRight: `1px solid ${t.border}`,
      padding: "16px 10px",
      display: "flex",
      flexDirection: "column",
      gap: 20,
      overflowY: "auto",
    }}>
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
            {group.items.map((item) => (
              <SidebarItem
                key={item.key}
                item={item}
                active={item.href && pathname?.startsWith(item.href)}
                onAction={onAction}
                t={t}
              />
            ))}
          </div>
        </div>
      ))}
    </aside>
  );
}

/* ─── TopNav ──────────────────────────────────────────────────────── */

const TOP_PILLS = [
  { label: "AIO",         href: "/aio" },
  { label: "Vision",      href: "/vision" },
  { label: "Automations", href: "/automations" },
  { label: "Rewards",     href: "/rewards" },
  { label: "Portfolio",   href: "/portfolio" },
  { label: "Settings",    href: "/settings" },
];

function TopNav({ pathname, onAction }) {
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
      <a href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
        <Shield size={18} style={{ color: t.accent }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: t.text }}>IronShield</span>
      </a>
      <nav style={{ display: "flex", gap: 4, marginLeft: 20 }}>
        {TOP_PILLS.map((p) => {
          const active = pathname?.startsWith(p.href);
          return (
            <a
              key={p.href}
              href={p.href}
              style={{
                ...pillBase,
                color: active ? t.white : t.textMuted,
                background: active ? "var(--accent-dim)" : "transparent",
              }}
            >
              {p.label}
            </a>
          );
        })}
      </nav>
      <div style={{ flex: 1 }} />
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
      <button type="button" onClick={() => onAction("tweet")} style={iconBtn} title="Post">
        <span style={{ fontWeight: 700 }}>𝕏</span>
      </button>
      <button
        type="button"
        onClick={() => onAction("create")}
        style={{
          padding: "6px 14px",
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
        CREATE
      </button>
      <button type="button" onClick={() => onAction("scan")} style={{ ...iconBtn, fontSize: 11, width: "auto", padding: "0 10px" }} title="Scan">
        <Zap size={14} />
        <span style={{ marginLeft: 4, fontWeight: 700, letterSpacing: 0.6 }}>SCAN</span>
      </button>
      <button type="button" style={iconBtn} title="Bookmarks"><Bookmark size={14} /></button>
      <button type="button" style={iconBtn} title="Notifications"><Bell size={14} /></button>
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
      <span style={chip}>Deploys</span>
      <span style={chip}>+ Creation Panel</span>
      <span style={{ ...chip, opacity: 0.6 }}>?</span>
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
  const [note, setNote] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createPrefill, setCreatePrefill] = useState(null);
  const [bridgeOpen, setBridgeOpen] = useState(false);

  // AppShell routes CREATE / bridge / scan / search centrally so every
  // route gets these modals without plumbing props. Callers can still
  // pass onAction for route-specific overrides (e.g. /trading's "open
  // the order book" later).
  const handleAction = onAction || ((kind) => {
    if (kind === "create") { setCreateOpen(true); setCreatePrefill(null); return; }
    if (kind === "bridge") { setBridgeOpen(true); return; }
    setNote(`${kind} (wires up in a later phase)`);
  });

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      background: "var(--bg-app)",
      color: t.text,
    }}>
      <AmbientBackground />
      <TopNav pathname={pathname} onAction={handleAction} />
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <Sidebar pathname={pathname} onAction={handleAction} />
        <main className="page-enter" style={{
          flex: 1,
          minWidth: 0,
          overflowY: "auto",
          padding: "0",
        }}>
          {children}
        </main>
        {rightPanel && (
          <aside style={{
            width: 280,
            flexShrink: 0,
            borderLeft: `1px solid ${t.border}`,
            overflowY: "auto",
          }}>
            {rightPanel}
          </aside>
        )}
      </div>
      <BottomBar />
      {createOpen && (
        <LaunchpadSelector
          prefill={createPrefill}
          onClose={() => { setCreateOpen(false); setCreatePrefill(null); }}
        />
      )}
      {bridgeOpen && (
        <BridgeModal onClose={() => setBridgeOpen(false)} />
      )}
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
  );
}
