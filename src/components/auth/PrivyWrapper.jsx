"use client";
// PrivyWrapper — gates the Privy provider behind an env check so the
// app still boots without credentials (useful when a new contributor
// clones the repo, or during static-export builds that don't need the
// SDK's JS bundle on pages that don't use auth).
//
// When NEXT_PUBLIC_PRIVY_APP_ID is set:
//   - PrivyProvider wraps children
//   - PrivySync mounts a listener that mirrors Privy's embedded-wallet
//     state into useWallet so AppShell/BottomBar/etc. can read wallet
//     info from one place.
// When unset:
//   - children render directly; `usePrivy()` calls from downstream
//     components should guard with the `isPrivyConfigured` export.

import { useEffect, useRef } from "react";
import {
  PrivyProvider, usePrivy, useWallets, useCreateWallet,
} from "@privy-io/react-auth";
import { useWallet } from "@/lib/stores/walletStore";

const APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || "";

// Privy's App IDs are cuid-style: 24–25 lowercase alphanumerics starting
// with a letter (e.g. "clh1234567890123456789012"). A hex string or other
// shape is almost certainly not an App ID — Privy's SDK throws a hard
// render-time error when it sees one, which takes the whole tree down.
// Shape-check here so a malformed ID degrades to the "unconfigured"
// state instead of the app crashing.
const PRIVY_APP_ID_RE = /^[a-z][a-z0-9]{19,28}$/;
const APP_ID_VALID = PRIVY_APP_ID_RE.test(APP_ID);

if (APP_ID && !APP_ID_VALID && typeof window !== "undefined") {
  // One-time console warning so the misconfiguration is visible without
  // burying it in the dev overlay.
  // eslint-disable-next-line no-console
  console.warn(
    `[privy] NEXT_PUBLIC_PRIVY_APP_ID doesn't look like a Privy App ID ` +
    `(expected cuid-style, got ${APP_ID.length} chars). ` +
    `Check dashboard.privy.io → App Settings → Basics. Sign-in is disabled.`
  );
}

export const isPrivyConfigured = APP_ID_VALID;

/**
 * Mirrors Privy's connected/embedded wallets into the zustand walletStore.
 * Runs inside the provider so it can use Privy's hooks. The first EVM
 * wallet (usually the Privy embedded one) drives our `bnb` slot since
 * BNB Chain is just an EVM chain — switching into BSC is a wagmi/viem
 * concern that lands in Phase 3.
 */
function PrivySync() {
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  // useCreateWallet is the explicit escape hatch for when the
  // createOnLogin auto-provisioner didn't fire — which we've seen on
  // email / Google sign-ins where Privy considers the user "not
  // without a wallet" because the browser has an injected EVM
  // provider. We call it ourselves if no embedded wallet shows up.
  const { createWallet: createEmbedded } = (useCreateWallet?.() || {});
  const setChain     = useWallet((s) => s.setChain);
  const setCustodial = useWallet((s) => s.setCustodial);
  const disconnect   = useWallet((s) => s.disconnect);
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      // Clear everything Privy owned. NEAR is managed by the existing
      // wallet selector, so we only wipe sol/bnb here.
      disconnect("sol");
      disconnect("bnb");
      setCustodial(false);
      attemptedRef.current = false;
      return;
    }
    // Find the EVM and Solana wallets Privy reports for this user.
    // `wallet.walletClientType === 'privy'` identifies an embedded
    // (custodial) wallet; anything else is an external wallet the user
    // brought in themselves (MetaMask, Phantom, etc.).
    const evm = wallets.find((w) => w.chainType === "ethereum");
    const sol = wallets.find((w) => w.chainType === "solana");
    const hasEmbedded = wallets.some((w) => w.walletClientType === "privy");

    // Belt-and-suspenders: if we're authenticated but no embedded
    // wallet appeared, create one explicitly. Only attempted once per
    // session to avoid loops on SDK errors.
    if (!hasEmbedded && createEmbedded && !attemptedRef.current) {
      attemptedRef.current = true;
      Promise.resolve(createEmbedded()).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[privy] explicit wallet create failed:", err?.message || err);
      });
    }

    if (evm) {
      setChain("bnb", { address: evm.address, connected: true });
    } else {
      disconnect("bnb");
    }
    if (sol) {
      setChain("sol", { address: sol.address, connected: true });
    } else {
      disconnect("sol");
    }

    // Custodial = any Privy-embedded wallet is active. Drives the
    // seed-reveal affordance in /settings/security (Phase 6).
    setCustodial(hasEmbedded);

    // Intentionally unused, but kept for when we want a user-id mirror:
    void user;
  }, [ready, authenticated, user, wallets, setChain, setCustodial, disconnect, createEmbedded]);

  return null;
}

export default function PrivyWrapper({ children }) {
  if (!isPrivyConfigured) {
    return children;
  }
  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        // Login methods per spec (email OTP + Google OAuth). Leaving
        // 'wallet' out — users bring in external wallets through our
        // existing NEAR selector or Privy's auto-detect in the modal.
        loginMethods: ["email", "google"],
        // Auto-create embedded wallets on every login. "all-users"
        // (vs "users-without-wallets") guarantees an embedded wallet
        // even when the user has a browser extension like MetaMask —
        // that extension is surfaced separately; the embedded wallet
        // is what makes custodial features like the agent action layer
        // and one-click tips work without popups. PrivySync adds an
        // explicit createWallet() fallback in case the auto-provision
        // misses for any reason.
        embeddedWallets: {
          ethereum: { createOnLogin: "all-users" },
          solana:   { createOnLogin: "all-users" },
        },
        appearance: {
          theme: "dark",
          accentColor: "#3b82f6",
          logo: "/mascot.png",
          showWalletLoginFirst: false,
        },
      }}
    >
      <PrivySync />
      {children}
    </PrivyProvider>
  );
}
