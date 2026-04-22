"use client";
// walletStore — the runtime wallet-state cache.
//
// Connection state itself comes from two providers: the existing NEAR
// wallet-selector (in src/lib/contexts.js) for NEAR, and Privy (Phase 2)
// for SOL + EVM embedded wallets. This store is just a read-friendly
// mirror so components can grab `wallet.sol.address` without plumbing
// the provider tree.
//
// Only `activeChain` is persisted (via settingsStore); everything here
// is rehydrated by the providers on mount.

import { create } from "zustand";

const emptyChain = () => ({
  address: null,
  balance: null,        // string, base units (lossless) — format at render
  connected: false,
});

export const useWallet = create((set, get) => ({
  near: emptyChain(),
  sol:  emptyChain(),
  bnb:  emptyChain(),

  // True when the active chain's wallet is Privy-embedded (custodial)
  // rather than a user-owned external wallet. Drives the seed-phrase
  // reveal affordance in /settings/security.
  isCustodial: false,

  setChain: (chain, patch) => {
    if (!["near", "sol", "bnb"].includes(chain)) return;
    set({ [chain]: { ...get()[chain], ...patch } });
  },

  setBalance: (chain, balance) => {
    if (!["near", "sol", "bnb"].includes(chain)) return;
    set({ [chain]: { ...get()[chain], balance } });
  },

  setCustodial: (v) => set({ isCustodial: !!v }),

  disconnect: (chain) => {
    if (chain) {
      set({ [chain]: emptyChain() });
    } else {
      set({ near: emptyChain(), sol: emptyChain(), bnb: emptyChain(), isCustodial: false });
    }
  },
}));
