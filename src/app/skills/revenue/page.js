"use client";
// /skills/revenue — per-creator revenue dashboard. Wraps the panel in
// SkillsShell so the sidebar + header stay consistent with the rest
// of the skills section.

import SkillsShell from "@/components/skills/SkillsShell";
import SkillsRevenuePage from "@/components/skills/SkillsRevenuePage";

export default function Page() {
  return (
    <SkillsShell>
      <SkillsRevenuePage />
    </SkillsShell>
  );
}
