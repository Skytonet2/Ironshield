"use client";
// settingsStore — the persisted user-preference store.
//
// Everything in here is safe to restore after a hard refresh: theme,
// sidebar grouping, feed-behavior toggles, keyword rules, active chain,
// per-user muted account IDs. Transient state (connected wallet,
// incoming feed events) lives in its own store.
//
// Theme preset lives here even though ThemeProvider reads it — keeping
// it in one place means the Appearance settings page and the provider
// can't drift. The provider subscribes via useSettings and stamps
// dataset.theme on <html> when the selection changes.

import { create } from "zustand";
import { persist } from "zustand/middleware";

// Canonical preset names, duplicated (not imported from contexts.js) to
// avoid a settingsStore ↔ contexts.js import cycle once ThemeProvider
// starts subscribing to this store. Keep in sync with PRESET_ACCENTS
// in contexts.js and the [data-theme] selectors in tokens.css.
const THEME_PRESETS = ["default", "midnight", "steel", "carbon", "ember", "ironclaw"];

// Default toggles — stable so a fresh user lands in a sane state.
const DEFAULT_AIO_TRACKERS = {
  ca: true, x: true, dex: true, near: true, telegram: true,
  news: true, ironclaw: true, newpair: true, wallet: false,
};
const DEFAULT_VISION_TRACKERS = { ...DEFAULT_AIO_TRACKERS, wallet: true };

export const useSettings = create(
  persist(
    (set, get) => ({
      // ── Appearance ─────────────────────────────────────────────
      theme: "default",                  // one of THEME_PRESETS
      accentOverride: null,              // custom hex, null = use preset
      fontSize: 13,                      // 11..15
      density: "normal",                 // compact | normal | spacious
      reduceMotion: false,

      // ── Feed behavior ──────────────────────────────────────────
      pauseOnHover: true,
      chatStyleFeed: false,
      showIronPoints: true,
      timestampInline: true,
      autoExpandScans: false,

      // ── Tracker toggles (split AIO vs. Vision per spec) ────────
      aioTrackers:    { ...DEFAULT_AIO_TRACKERS },
      visionTrackers: { ...DEFAULT_VISION_TRACKERS },

      // ── Notifications ──────────────────────────────────────────
      soundEnabled: true,
      soundVolume: 0.35,
      perTrackerSound: {},               // trackerType -> preset name

      // ── Keyword rules ──────────────────────────────────────────
      tickerDetection: true,
      caDetection: true,
      keywords: [],                      // [{ id, term, highlight, notify }]

      // ── Chain ──────────────────────────────────────────────────
      // BNB is structurally supported by walletStore + setter below,
      // but opted out of the UI until the fee wallet is funded.
      activeChain: "near",               // near | sol (bnb hidden)

      // ── Per-user mute list. IDs so we don't store stale handles ─
      mutedAccounts: [],

      // ── Setters (lean — components should prefer these over
      //    inline set() calls so we have a grep'able audit trail) ──
      setTheme: (theme) => {
        if (!THEME_PRESETS.includes(theme)) return;
        set({ theme });
      },
      setAccentOverride: (hex) => set({ accentOverride: hex }),
      setFontSize: (px) => set({ fontSize: Math.min(15, Math.max(11, Math.round(px))) }),
      setDensity: (d) => set({ density: d }),
      setReduceMotion: (v) => set({ reduceMotion: !!v }),

      setPauseOnHover: (v) => set({ pauseOnHover: !!v }),
      setChatStyleFeed: (v) => set({ chatStyleFeed: !!v }),
      setShowIronPoints: (v) => set({ showIronPoints: !!v }),
      setTimestampInline: (v) => set({ timestampInline: !!v }),
      setAutoExpandScans: (v) => set({ autoExpandScans: !!v }),

      setTracker: (mode, tracker, val) => {
        const key = mode === "vision" ? "visionTrackers" : "aioTrackers";
        set({ [key]: { ...get()[key], [tracker]: !!val } });
      },

      setSoundEnabled: (v) => set({ soundEnabled: !!v }),
      setSoundVolume:  (v) => set({ soundVolume: Math.min(1, Math.max(0, v)) }),
      setTrackerSound: (tracker, preset) => set({
        perTrackerSound: { ...get().perTrackerSound, [tracker]: preset },
      }),

      setTickerDetection: (v) => set({ tickerDetection: !!v }),
      setCaDetection: (v) => set({ caDetection: !!v }),
      addKeyword: (rule) => set({ keywords: [...get().keywords, rule] }),
      removeKeyword: (id) => set({ keywords: get().keywords.filter((k) => k.id !== id) }),

      setActiveChain: (chain) => {
        if (!["near", "sol", "bnb"].includes(chain)) return;
        set({ activeChain: chain });
      },

      muteAccount:   (id) => {
        const set_ = get().mutedAccounts;
        if (set_.includes(id)) return;
        set({ mutedAccounts: [...set_, id] });
      },
      unmuteAccount: (id) => set({ mutedAccounts: get().mutedAccounts.filter((x) => x !== id) }),
    }),
    {
      name: "ironshield-settings",
      version: 1,
      // Only persist the data fields; setters are recreated on hydrate.
      partialize: (state) => {
        const { setTheme, setAccentOverride, setFontSize, setDensity,
                setReduceMotion, setPauseOnHover, setChatStyleFeed,
                setShowIronPoints, setTimestampInline, setAutoExpandScans,
                setTracker, setSoundEnabled, setSoundVolume, setTrackerSound,
                setTickerDetection, setCaDetection, addKeyword, removeKeyword,
                setActiveChain, muteAccount, unmuteAccount, ...rest } = state;
        return rest;
      },
    }
  )
);
