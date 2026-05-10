"use client";
// / (root) — the public landing page.
//
// Phase E.2: routes to LandingPageV2, the white + sky-blue redesign.
// The legacy dark landing is kept on disk as LandingPageLegacy.jsx
// for one phase so we can revert with a one-line import swap if the
// new design hits a blocker. Delete LandingPageLegacy.jsx in E.8
// once every screen is migrated.
//
// LandingPageV2 brings its own chrome — do NOT wrap it in AppShell
// or LegacyRoute.

import LandingPageV2 from "@/components/landing/LandingPageV2";

export default function RootPage() {
  return <LandingPageV2 />;
}
