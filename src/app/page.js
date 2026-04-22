"use client";
// / (root) — the public landing page.
//
// Previously this rendered HomePage inside AppShell, which made the
// root URL feel like the authenticated product. Now /  serves a
// dedicated marketing surface (navbar + hero + product showcase +
// stats + subscribe + footer). Visitors click "Launch App" to drop
// into the AppShell-wrapped /feed.
//
// LandingPage brings its own chrome — do NOT wrap it in AppShell
// or LegacyRoute.

import LandingPage from "@/components/landing/LandingPage";

export default function RootPage() {
  return <LandingPage />;
}
