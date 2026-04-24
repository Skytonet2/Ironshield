"use client";
// /skills/analytics — ecosystem-wide rollup of the skills catalogue.

import SkillsShell from "@/components/skills/SkillsShell";
import SkillsAnalyticsPage from "@/components/skills/SkillsAnalyticsPage";

export default function Page() {
  return (
    <SkillsShell>
      <SkillsAnalyticsPage />
    </SkillsShell>
  );
}
