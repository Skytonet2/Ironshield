"use client";
// /trading — the Phase 3A Trading Terminal route.
//
// Wraps the AppShell chrome around the TradingTerminal composition.
// Right panel is intentionally empty today; Phase 3B adds the order
// book + active-position panel here per the spec's context-sensitive
// right-panel rule.

import { useEffect } from "react";
import AppShell from "@/components/shell/AppShell";
import TradingTerminal from "@/components/trading/TradingTerminal";
import * as wsClient from "@/lib/ws/wsClient";

export default function TradingPage() {
  useEffect(() => {
    // Subscribe to trade + dex events so the terminal reflects the
    // same live stream as /aio. Other pages in the same tab share the
    // socket via the singleton.
    wsClient.connect({
      trackers: ["dex", "newpair", "trade"],
    });
  }, []);

  return (
    <AppShell>
      <TradingTerminal />
    </AppShell>
  );
}
