"use client";
// Owner's private agent dashboard. Mirrors the legacy-route wrapper pattern
// used by /agent and /earn — keeps Next.js app-router happy while the page
// component lives under src/components/.

import { lazy } from "react";
import LegacyRoute from "@/components/shell/LegacyRoute";
const AgentDashboardPage = lazy(() => import("@/components/AgentDashboardPage"));
export default function Page() { return <LegacyRoute Component={AgentDashboardPage} />; }
