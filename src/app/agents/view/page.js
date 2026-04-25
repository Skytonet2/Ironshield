"use client";
// /agents/view?account=<near> — agent control plane.
// Wraps AgentDetailDashboard in SkillsShell. The query param keeps the
// route static-export friendly; reads `account` (preferred) or
// `handle` (legacy) on mount via the dashboard's own resolver.

import { Suspense } from "react";
import SkillsShell from "@/components/skills/SkillsShell";
import AgentDetailDashboard from "@/components/skills/AgentDetailDashboard";

// Suspense wrapper covers the dashboard's internal useSearchParams
// reads at prerender time (Next.js 16 static-export requirement).
export default function Page() {
  return (
    <SkillsShell>
      <Suspense fallback={null}>
        <AgentDetailDashboard />
      </Suspense>
    </SkillsShell>
  );
}
