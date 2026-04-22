"use client";
// Auto-generated legacy-wrapper route. Mounts the NewsCoinPage component
// inside the new AppShell. Regenerate with scripts/gen-legacy-routes
// if we add / remove pages.

import { lazy } from "react";
import LegacyRoute from "@/components/shell/LegacyRoute";
const NewsCoinPage = lazy(() => import("@/components/NewsCoinPage"));
export default function Page() { return <LegacyRoute Component={NewsCoinPage} />; }
