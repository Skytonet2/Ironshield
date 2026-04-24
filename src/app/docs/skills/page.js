"use client";
// /docs/skills — authoring + installing reference for the skills
// marketplace. Uses SkillsShell so the sidebar "Documentation" link
// stays selected when the page is open.

import SkillsShell from "@/components/skills/SkillsShell";
import SkillsDocsPage from "@/components/skills/SkillsDocsPage";

export default function Page() {
  return (
    <SkillsShell>
      <SkillsDocsPage />
    </SkillsShell>
  );
}
