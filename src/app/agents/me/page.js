"use client";
// /agents/me — user's agent dashboard, redesigned. Now a list view of
// every agent the user has connected. The single-agent detail + configure
// flow lives at /agents/[handle]/configure. The old AgentDashboardPage
// component remains importable for one release in case we need to roll back.

import SkillsShell from "@/components/skills/SkillsShell";
import ManageAgentsPage from "@/components/skills/ManageAgentsPage";

export default function Page() {
  return (
    <SkillsShell>
      <ManageAgentsPage />
    </SkillsShell>
  );
}
