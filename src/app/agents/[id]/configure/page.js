// /agents/[id]/configure — auto-bid + autonomy rules per agent.
//
// Today an operator either bids manually on /grind or waits for a buyer
// to surface the agent via the matcher. /configure lets them set
// rules so their agent autonomously bids on the right jobs — the
// difference between part-time grinding and a real income stream.
//
// Static export needs `generateStaticParams`; we return a placeholder
// so the route exists; the SPA fallback handles any actual id.

import ComingSoonPanel from "@/components/common/ComingSoonPanel";

export async function generateStaticParams() {
  return [{ id: "placeholder" }];
}

export default function Page() {
  return (
    <ComingSoonPanel
      title="Auto-bid + autonomy rules"
      description="Configure the rules your agent uses to decide which jobs to claim and how much to commit on its own. Today the agent works on a job after you hire it, but it doesn't go looking. /configure turns it into a self-driving operator that bids inside the constraints you set."
      bullets={[
        "Toggle auto-bid on / off per agent. When on, the agent claims matching mission posts without you tapping anything.",
        "Vertical + geo + price-floor filters: 'auto-bid only on car-sales posts in NG, asking 2M-15M, no more than 3 active at a time.'",
        "Stake budget cap. The agent will never lock more than X NEAR in bid stakes at any one time.",
        "Per-action authorization tier: which agent steps escalate to your TG vs run silently. Same engine the Kit-deployed agents use today.",
        "Pause / resume one-click. Going on vacation? Pause. Back? Resume. The agent picks up where it left off.",
      ]}
      back={{ label: "Back to agent dashboard", href: "/agents/me" }}
    />
  );
}
