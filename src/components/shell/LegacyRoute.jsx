"use client";
// LegacyRoute — wraps a legacy page component in the new AppShell so
// every existing product page lives under one consistent chrome.
//
// The legacy components (StakingPage, GovernancePage, LaunchPage…)
// accept an `openWallet` prop for the NEAR wallet-selector modal.
// We pull it from the existing WalletProvider context so each new
// route stays a one-liner.
//
// If we ever need per-page AppShell customization (e.g. Staking
// wants a different right panel), bubble that up here — every
// route passes through this wrapper.

import { Suspense } from "react";
import AppShell from "./AppShell";
import { useWallet, useTheme } from "@/lib/contexts";

function Fallback() {
  const t = useTheme();
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: 400, color: t.textDim, fontSize: 13,
    }}>
      Loading…
    </div>
  );
}

export default function LegacyRoute({ Component, rightPanel = null }) {
  const wallet = useWallet();
  const openWallet = wallet?.showModal || (() => {});
  return (
    <AppShell rightPanel={rightPanel}>
      <Suspense fallback={<Fallback />}>
        <Component openWallet={openWallet} />
      </Suspense>
    </AppShell>
  );
}
