"use client";
// /skills/[id]/versions — version history + diff (Tier 5 slice 5).

import { useParams } from "next/navigation";
import SkillsShell from "@/components/skills/SkillsShell";
import SkillVersionsPage from "@/components/skills/SkillVersionsPage";

export default function Page() {
  const params = useParams();
  const id = params?.id;
  return (
    <SkillsShell>
      <SkillVersionsPage skillId={id} />
    </SkillsShell>
  );
}
