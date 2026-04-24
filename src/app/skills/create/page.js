"use client";
// /skills/create — 4-step wizard for publishing a skill to the
// marketplace. Content lives in components/skills/CreateSkillPage so
// this route file stays a thin shell-wrapper mount.

import SkillsShell from "@/components/skills/SkillsShell";
import CreateSkillPage from "@/components/skills/CreateSkillPage";

export default function Page() {
  return (
    <SkillsShell>
      <CreateSkillPage />
    </SkillsShell>
  );
}
