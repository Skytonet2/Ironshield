"use client";
// Auto-generated legacy-wrapper route. Mounts the LaunchPage component
// inside the new AppShell. Regenerate with scripts/gen-legacy-routes
// if we add / remove pages.

import { lazy } from "react";
import LegacyRoute from "@/components/shell/LegacyRoute";
const LaunchPage = lazy(() => import("@/components/LaunchPage"));
export default function Page() { return <LegacyRoute Component={LaunchPage} />; }
