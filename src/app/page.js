"use client";
// / (root) — Home. Serves the existing HomePage component inside
// the new AppShell chrome. Legacy pages that used to mount via an
// in-page switch (Staking, Governance, Launch, NewsCoin, Earn,
// Treasury, Docs, Agent, Ecosystem) each have their own route now
// under /staking, /governance, etc. — see src/app/*/page.js.
//
// Pre-migration legacy cross-cutting bits (CallProvider, MascotSystem,
// DMToast, DMCallPanel, TelegramOnboardingModal, AdminPanel) are
// temporarily not wired on the new routes. They'll move into
// app/layout.js in a follow-up so they work everywhere.

import { lazy } from "react";
import LegacyRoute from "@/components/shell/LegacyRoute";

const HomePage = lazy(() => import("@/components/HomePage"));

export default function RootPage() {
  return <LegacyRoute Component={HomePage} />;
}
