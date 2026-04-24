"use client";
// /skills/mine — installed skills for the connected wallet. Wraps
// MySkillsPage in SkillsShell so the sidebar + header stay consistent
// with the rest of the skills section.

import SkillsShell from "@/components/skills/SkillsShell";
import MySkillsPage from "@/components/skills/MySkillsPage";

export default function Page() {
  return (
    <SkillsShell>
      <MySkillsPage />
    </SkillsShell>
  );
}
