"use client";
// Client wrapper for the dynamic /skills/[id]/versions route. Pulls
// the id from useParams (route-segment param) and hands it to the
// reusable component. Lives next to page.js so the dynamicParams +
// generateStaticParams contract on page.js stays clean (server file,
// no "use client").

import { useParams } from "next/navigation";
import SkillsShell from "@/components/skills/SkillsShell";
import SkillVersionsPage from "@/components/skills/SkillVersionsPage";

export default function SkillVersionsClient() {
  const params = useParams();
  const id = params?.id;
  return (
    <SkillsShell>
      <SkillVersionsPage skillId={id} />
    </SkillsShell>
  );
}
