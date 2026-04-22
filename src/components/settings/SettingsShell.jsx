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

const GROUPS = [
  {
    label: "Commands",
    items: [
      { key: "export",     label: "Export Data",         disabled: true },
      { key: "reset",      label: "Reset to Defaults",   disabled: true },
      { key: "disconnect", label: "Disconnect Wallets",  disabled: true },
    ],
  },
  {
    label: "Platform",
    items: [
      { key: "trackers",    label: "Trackers" },
      { key: "feed",        label: "Feed Accounts", disabled: true },
      { key: "notifications", label: "Notifications", disabled: true },
      { key: "keywords",    label: "Keywords",     disabled: true },
      { key: "pins",        label: "Pins & Tags",  disabled: true },
      { key: "auto-shield", label: "Auto Shield",  disabled: true },
    ],
  },
  {
    label: "Tools",
    items: [
      { key: "appearance",   label: "Appearance" },
      { key: "security",     label: "Security" },
      { key: "wallets",      label: "Wallets",      disabled: true },
      { key: "transactions", label: "Transactions", disabled: true },
      { key: "keybinds",     label: "Keybinds",     disabled: true },
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
      <div style={{
        display: "grid",
        gridTemplateColumns: "220px 1fr",
        gap: 16,
        maxWidth: 1100,
        margin: "0 auto",
        padding: "16px 20px",
      }}>
        <SettingsNav groups={GROUPS} activeTab={tab} onPick={onPick} t={t} />
        <div style={{ minWidth: 0 }}>
          <TabContent tab={tab} />
        </div>
      </div>
    </AppShell>
  );
}

function SettingsNav({ groups, activeTab, onPick, t }) {
  return (
    <aside style={{
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
  if (tab === "appearance") return <AppearanceTab />;
  if (tab === "security")   return <SecurityTab />;
  if (tab === "trackers")   return <TrackersTab />;
  // Fallback — shouldn't be reachable since disabled items don't mutate tab.
  return null;
}
