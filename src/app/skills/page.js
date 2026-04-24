"use client";
// /skills — marketplace. Wraps the new MarketplacePage in SkillsShell.
// The legacy SkillsMarketplacePage lives at src/components/SkillsMarketplacePage.jsx
// and is now orphaned; kept around for one release in case we need to roll back.

import SkillsShell from "@/components/skills/SkillsShell";
import MarketplacePage from "@/components/skills/MarketplacePage";

export default function Page() {
  return (
    <SkillsShell>
      <MarketplacePage />
    </SkillsShell>
  );
}
