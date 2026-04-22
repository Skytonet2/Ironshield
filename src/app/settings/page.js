"use client";
// /settings — the Phase 6 settings shell. Tabs are hash-state so
// /settings#security deep-links cleanly without needing separate
// subroutes (keeps static export flat).

import SettingsShell from "@/components/settings/SettingsShell";

export default function SettingsPage() {
  return <SettingsShell />;
}
