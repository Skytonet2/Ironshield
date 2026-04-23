"use client";
// SettingsShell — spec §9A. Three grouped sections in the left rail,
// tab content on the right. Tab is URL-state via hash so deep-linking
// works (/settings#appearance opens Appearance directly) without
// changing the static-export route structure — no /settings/appearance
// subroute means build stays flat.

import { useEffect, useState } from "react";
import { useTheme } from "@/lib/contexts";
import AppShell from "@/components/shell/AppShell";
import AppearanceTab from "./AppearanceTab";
import SecurityTab  from "./SecurityTab";
import TrackersTab  from "./TrackersTab";
import NotificationsTab from "./NotificationsTab";
import VoicesTab from "./VoicesTab";
import KeywordsTab from "./KeywordsTab";
import KeybindsTab from "./KeybindsTab";
import WalletsTab from "./WalletsTab";
import TransactionsTab from "./TransactionsTab";
import ExportDataTab from "./ExportDataTab";
import ResetTab from "./ResetTab";
import DisconnectTab from "./DisconnectTab";

// Most "soon" items are now implemented. The remaining stubs surface
// routes that exist elsewhere in the app (Feed Accounts → /profile edit,
// Earnings → /rewards, Metadata → profile tags) rather than duplicating
// those surfaces here. When any of them graduates into a full settings
// tab, just swap the entry over.
const GROUPS = [
  {
    label: "Commands",
    items: [
      { key: "export",     label: "Export Data" },
      { key: "reset",      label: "Reset to Defaults" },
      { key: "disconnect", label: "Disconnect Wallets" },
    ],
  },
  {
    label: "Platform",
    items: [
      { key: "trackers",      label: "Trackers" },
      { key: "notifications", label: "Notifications" },
      { key: "voices",        label: "Voices" },
      { key: "keywords",      label: "Keywords" },
      { key: "feed",          label: "Feed Accounts", disabled: true },
      { key: "pins",          label: "Pins & Tags",   disabled: true },
      { key: "auto-shield",   label: "Auto Shield",   disabled: true },
    ],
  },
  {
    label: "Tools",
    items: [
      { key: "appearance",   label: "Appearance" },
      { key: "security",     label: "Security" },
      { key: "wallets",      label: "Wallets" },
      { key: "transactions", label: "Transactions" },
      { key: "keybinds",     label: "Keybinds" },
      { key: "earnings",     label: "Earnings",     disabled: true },
      { key: "metadata",     label: "Metadata",     disabled: true },
    ],
  },
];

const DEFAULT_TAB = "appearance";

export default function SettingsShell() {
  const t = useTheme();
  const [tab, setTab] = useState(DEFAULT_TAB);

  // Hash-state so /settings#security opens Security directly.
  useEffect(() => {
    const applyHash = () => {
      const hash = (typeof window !== "undefined" && window.location.hash) || "";
      const k = hash.replace(/^#/, "").trim();
      if (k && GROUPS.some(g => g.items.some(i => i.key === k && !i.disabled))) setTab(k);
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

  function onPick(k, disabled) {
    if (disabled) return;
    setTab(k);
    if (typeof window !== "undefined") {
      history.replaceState(null, "", `#${k}`);
    }
  }

  return (
    <AppShell>
      <div className="ix-settings-grid" style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: "16px 20px",
      }}>
        <SettingsNav groups={GROUPS} activeTab={tab} onPick={onPick} t={t} />
        <div style={{ minWidth: 0 }}>
          <TabContent tab={tab} />
        </div>
      </div>
      <style jsx global>{`
        .ix-settings-grid {
          display: grid;
          gap: 16px;
          grid-template-columns: 220px minmax(0, 1fr);
        }
        /* On tablet + phone, stack nav above content so the right
           column gets the full viewport width. The sticky-nav
           affordance only makes sense when there's room beside it.
           The nav itself collapses into a horizontal scroller so
           every tab stays reachable in one tap. */
        @media (max-width: 899px) {
          .ix-settings-grid { grid-template-columns: 1fr; }
          .ix-settings-nav {
            position: static !important;
            flex-direction: row !important;
            gap: 12px !important;
            overflow-x: auto;
            padding-bottom: 8px;
            margin-bottom: 4px;
            border-bottom: 1px solid var(--border, rgba(255,255,255,0.06));
          }
          .ix-settings-nav > div {
            flex-shrink: 0;
          }
          .ix-settings-nav > div > div:first-child {
            /* group label */
            white-space: nowrap;
          }
          .ix-settings-nav > div > div:last-child {
            flex-direction: row !important;
            gap: 4px !important;
          }
          .ix-settings-nav button { white-space: nowrap; }
        }
      `}</style>
    </AppShell>
  );
}

function SettingsNav({ groups, activeTab, onPick, t }) {
  // Desktop: vertical sticky stack. Mobile: horizontal scroller below
  // the top nav so every tab stays one tap away without eating half
  // the viewport. The ix-settings-nav class toggles that via the
  // global CSS block at the bottom of SettingsShell.
  return (
    <aside className="ix-settings-nav" style={{
      display: "flex",
      flexDirection: "column",
      gap: 20,
      position: "sticky",
      top: 14,
      alignSelf: "flex-start",
    }}>
      {groups.map((g) => (
        <div key={g.label}>
          <div style={{
            fontSize: 10, letterSpacing: 1.2, fontWeight: 600,
            color: t.textDim, textTransform: "uppercase",
            padding: "0 12px 6px",
          }}>
            {g.label}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {g.items.map((i) => {
              const active = i.key === activeTab;
              return (
                <button
                  key={i.key}
                  type="button"
                  disabled={i.disabled}
                  onClick={() => onPick(i.key, i.disabled)}
                  className={active ? "sidebar-item active" : "sidebar-item"}
                  style={{
                    textAlign: "left",
                    padding: "8px 12px",
                    borderRadius: 8,
                    background: active ? "var(--accent-dim)" : "transparent",
                    color: active ? t.accent : i.disabled ? t.textDim : t.textMuted,
                    fontSize: 13,
                    fontWeight: 500,
                    border: "none",
                    cursor: i.disabled ? "not-allowed" : "pointer",
                    position: "relative",
                    opacity: i.disabled ? 0.6 : 1,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {i.label}
                  {i.disabled && (
                    <span style={{
                      marginLeft: "auto",
                      fontSize: 9,
                      padding: "1px 5px",
                      borderRadius: 4,
                      background: "var(--bg-input)",
                      color: t.textDim,
                      letterSpacing: 0.6,
                    }}>
                      SOON
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </aside>
  );
}

function TabContent({ tab }) {
  if (tab === "appearance")    return <AppearanceTab />;
  if (tab === "security")      return <SecurityTab />;
  if (tab === "trackers")      return <TrackersTab />;
  if (tab === "notifications") return <NotificationsTab />;
  if (tab === "voices")        return <VoicesTab />;
  if (tab === "keywords")      return <KeywordsTab />;
  if (tab === "keybinds")      return <KeybindsTab />;
  if (tab === "wallets")       return <WalletsTab />;
  if (tab === "transactions")  return <TransactionsTab />;
  if (tab === "export")        return <ExportDataTab />;
  if (tab === "reset")         return <ResetTab />;
  if (tab === "disconnect")    return <DisconnectTab />;
  // Fallback — shouldn't be reachable since disabled items don't mutate tab.
  return null;
}
