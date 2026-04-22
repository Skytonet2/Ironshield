"use client";
// Auto-generated legacy-wrapper route. Mounts the GovernancePage component
// inside the new AppShell. Regenerate with scripts/gen-legacy-routes
// if we add / remove pages.

import { lazy } from "react";
import LegacyRoute from "@/components/shell/LegacyRoute";
const GovernancePage = lazy(() => import("@/components/GovernancePage"));
export default function Page() { return <LegacyRoute Component={GovernancePage} />; }
