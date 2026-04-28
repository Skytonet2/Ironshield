"use client";
// /docs/skills-catalog-v2 — Volume 2 of the skills SDK backlog.
// Reuses SkillsCatalogPage with the v2 dataset; v1 stays at
// /docs/skills-catalog. Source markdown: docs/skills-catalog-v2.md,
// parsed at build time into src/data/skillsCatalogV2.json.

import SkillsShell from "@/components/skills/SkillsShell";
import SkillsCatalogPage from "@/components/skills/SkillsCatalogPage";
import catalogV2 from "@/data/skillsCatalogV2.json";

export default function Page() {
  return (
    <SkillsShell>
      <SkillsCatalogPage
        catalog={catalogV2}
        sourceUrl="https://github.com/Skytonet2/Ironshield/blob/main/docs/skills-catalog-v2.md"
        siblingLink={{ href: "/docs/skills-catalog", label: "v1 — first 200 skills" }}
      />
    </SkillsShell>
  );
}
