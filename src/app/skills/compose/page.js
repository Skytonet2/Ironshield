// /skills/compose — DIY agent composer (Phase 5 in the roadmap).
//
// Today operators can only deploy pre-curated Kits. /skills/compose is
// the path to building a custom agent from individual skills the
// operator picks à la carte. It's gated to Phase 5 of the agent-economy
// roadmap because the skill catalog needs to be richer + the sandbox
// eval harness needs to ship before unconstrained composition is safe.

import ComingSoonPanel from "@/components/common/ComingSoonPanel";

export default function Page() {
  return (
    <ComingSoonPanel
      title="DIY agent composer"
      description="Pick-and-mix individual skills to build a custom agent that fits a workflow no live Kit covers. Today every agent is a deployment of a curated Kit. The composer flips that — you start blank, install whichever skills you want, tune their prompts, set authorization rules, ship."
      bullets={[
        "Browse the full skill catalog by role: scout, outreach, negotiator, verifier, executor, reporter.",
        "Drag skills into your agent's slot grid. Each skill's preset config opens in a side panel.",
        "Sandbox eval before deploy: run the composed agent against fixture inputs, see what it would output, fix the misses.",
        "Authorization tier dial per skill — auto vs notify vs require_approval, same engine the Kit-deployed agents use.",
        "Submit composed agents to the marketplace. Pass governance review → your agent is hireable like any Kit-deployed one.",
      ]}
      back={{ label: "Back to skills marketplace", href: "/skills" }}
    />
  );
}
