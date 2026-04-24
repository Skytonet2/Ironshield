"use client";
// /agents/configure?handle=<handle> — per-agent configuration. The
// handle lives in the query string (not a path segment) because
// IronShield ships as a static export (output: "export") which won't
// build dynamic [handle] segments without a pre-declared params list.
// A query param keeps clean navigation while letting any handle resolve
// at runtime.

import SkillsShell from "@/components/skills/SkillsShell";
import ConfigureAgentPage from "@/components/skills/ConfigureAgentPage";

export default function Page() {
  return (
    <SkillsShell>
      <ConfigureAgentPage />
    </SkillsShell>
  );
}
