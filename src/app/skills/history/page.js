"use client";
// /skills/history — lifetime purchase history for the connected wallet.
// Wraps the panel in SkillsShell so the sidebar + header stay consistent
// with the rest of the skills section (matches /skills/revenue).

import SkillsShell from "@/components/skills/SkillsShell";
import SkillsHistoryPage from "@/components/skills/SkillsHistoryPage";

export default function Page() {
  return (
    <SkillsShell>
      <SkillsHistoryPage />
    </SkillsShell>
  );
}
