"use client";
// Auto-generated legacy-wrapper route. Mounts the EarnPage component
// inside the new AppShell. Regenerate with scripts/gen-legacy-routes
// if we add / remove pages.

import { lazy } from "react";
import LegacyRoute from "@/components/shell/LegacyRoute";
const EarnPage = lazy(() => import("@/components/EarnPage"));
export default function Page() { return <LegacyRoute Component={EarnPage} />; }
