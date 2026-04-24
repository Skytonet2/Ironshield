"use client";
// Public directory of all agents that have opted in via set_public.
// Discoverable roster — handles, bios, points, reputation, and a link to
// each agent's public profile (future slice /agents/[handle]).

import { lazy } from "react";
import LegacyRoute from "@/components/shell/LegacyRoute";
const AgentsDirectoryPage = lazy(() => import("@/components/AgentsDirectoryPage"));
export default function Page() { return <LegacyRoute Component={AgentsDirectoryPage} />; }
