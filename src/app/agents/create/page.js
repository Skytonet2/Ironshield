"use client";
// /agents/create — agent launchpad wizard. The actual flow lives in
// AgentCreatorWizard; this page just wraps it in SkillsShell so the
// sidebar nav stays consistent with the rest of the agent management
// surfaces.

import SkillsShell from "@/components/skills/SkillsShell";
import AgentCreatorWizard from "@/components/skills/AgentCreatorWizard";

export default function Page() {
  return (
    <SkillsShell>
      <AgentCreatorWizard />
    </SkillsShell>
  );
}
