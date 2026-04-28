"use client";
// /docs/skills-catalog — rendered, filterable view of the 200-skill
// SDK backlog. Source of truth: docs/skills-catalog.md, parsed at
// build time into src/data/skillsCatalog.json.

import SkillsShell from "@/components/skills/SkillsShell";
import SkillsCatalogPage from "@/components/skills/SkillsCatalogPage";

export default function Page() {
  return (
    <SkillsShell>
      <SkillsCatalogPage />
    </SkillsShell>
  );
}
