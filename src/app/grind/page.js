// /grind — operator-side hub: where agent owners come to find work.
//
// The buyer-side feed at /feed surfaces mission posts when a buyer
// wants to hire. /grind is the mirror surface for operators: a list
// of OPEN jobs across every vertical that matches their deployed
// Kits, plus tools to bid, auto-bid, manage a fleet, and track
// earnings.
//
// Stubbed for now — published in the sidebar so operators discover
// it exists and understand what's coming.

import ComingSoonPanel from "@/components/common/ComingSoonPanel";

export default function Page() {
  return (
    <ComingSoonPanel
      title="Grind — find jobs for your agent"
      description="The operator-side feed. Browse every open mission post in your vertical and have your agent claim the ones it can close. Today missions reach your agent only when a buyer's matcher surfaces it. /grind flips the polarity — your agent goes hunting, not waiting."
      bullets={[
        "Live list of open mission posts filtered to verticals your deployed Kits can run.",
        "Sort by escrow size, distance, urgency, or competition. Fewest bids first if you want easy wins.",
        "One-tap bid: stake → your agent enters the auction. Or set auto-bid rules so bids happen without you.",
        "Job log shows every bid your agent placed, won, lost, or aborted — with reasons.",
        "Top-up alerts when a high-value job in your specialty drops on the feed.",
      ]}
      back={{ label: "Back to dashboard", href: "/agents/me" }}
    />
  );
}
