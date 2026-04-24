"use client";
// Skills marketplace — browse, create, and install skills for your agent.

import { lazy } from "react";
import LegacyRoute from "@/components/shell/LegacyRoute";
const SkillsMarketplacePage = lazy(() => import("@/components/SkillsMarketplacePage"));
export default function Page() { return <LegacyRoute Component={SkillsMarketplacePage} />; }
