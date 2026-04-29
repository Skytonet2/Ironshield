"use client";
// /agents/configure?handle=<handle> — per-agent configuration. The
// handle lives in the query string (not a path segment) because
// AZUKA ships as a static export (output: "export") which won't
// build dynamic [handle] segments without a pre-declared params list.
// A query param keeps clean navigation while letting any handle resolve
// at runtime.

import { Suspense } from "react";
import SkillsShell from "@/components/skills/SkillsShell";
import ConfigureAgentPage from "@/components/skills/ConfigureAgentPage";

// ConfigureAgentPage calls useSearchParams() — Next.js 16 static export
// requires that to live under a Suspense boundary so prerender can bail
// out cleanly on the query-string-dependent branch.
export default function Page() {
  return (
    <SkillsShell>
      <Suspense fallback={null}>
        <ConfigureAgentPage />
      </Suspense>
    </SkillsShell>
  );
}
