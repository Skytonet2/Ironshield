"use client";
// /skills/view?id=<n> — full detail page for one skill listing.
// Suspense wrapper covers SkillDetailPage's window.location read at
// prerender time (Next.js 16 static-export requirement).

import { Suspense } from "react";
import SkillsShell from "@/components/skills/SkillsShell";
import SkillDetailPage from "@/components/skills/SkillDetailPage";

export default function Page() {
  return (
    <SkillsShell>
      <Suspense fallback={null}>
        <SkillDetailPage />
      </Suspense>
    </SkillsShell>
  );
}
