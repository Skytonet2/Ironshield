"use client";
// LegacyRoute — wraps a legacy page component in the new AppShell so
// every existing product page lives under one consistent chrome.
//
// The legacy components (StakingPage, GovernancePage, LaunchPage…)
// accept an `openWallet` prop for the NEAR wallet-selector modal.
// We pull it from the existing WalletProvider context so each new
// route stays a one-liner.
//
// This wrapper also adds a "premium frame" around each legacy page:
//   - Max-width container so the content doesn't stretch edge to
//     edge on wide monitors.
//   - A soft radial glow at the top (same electric-blue → purple
//     gradient as the rest of the shell) so the page feels part of
//     the design system even while its inner markup is still the
//     legacy inline-style layout.
//   - Reset top padding so legacy pages with their own headers
//     don't double-pad against the AppShell TopNav.
//
// If a legacy page wants its own right rail, pass it through
// `rightPanel`; otherwise we omit the rail entirely (we don't want
// every legacy page to show the feed's Your-Account widget).

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
  const t = useTheme();
  const openWallet = wallet?.showModal || (() => {});
  return (
    <AppShell rightPanel={rightPanel}>
      <div style={{
        position: "relative",
        padding: "8px 0 48px",
        minHeight: "100%",
      }}>
        {/* Subtle top glow — mirrors the accent gradient so every
            legacy page inherits a hint of the shell's visual language
            without us editing their internal markup. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: -60, left: "50%",
            transform: "translateX(-50%)",
            width: "min(900px, 80%)",
            height: 160,
            background: `radial-gradient(ellipse at center top, ${t.accent}22, transparent 70%)`,
            filter: "blur(40px)",
            pointerEvents: "none",
            zIndex: 0,
          }}
        />
        <div style={{ position: "relative", zIndex: 1 }}>
          <Suspense fallback={<Fallback />}>
            <Component openWallet={openWallet} />
          </Suspense>
        </div>
      </div>
    </AppShell>
  );
}
