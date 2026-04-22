"use client";
// Auto-generated legacy-wrapper route. Mounts the EcosystemPage component
// inside the new AppShell. Regenerate with scripts/gen-legacy-routes
// if we add / remove pages.

import { lazy } from "react";
import LegacyRoute from "@/components/shell/LegacyRoute";
const EcosystemPage = lazy(() => import("@/components/EcosystemPage"));
export default function Page() { return <LegacyRoute Component={EcosystemPage} />; }
