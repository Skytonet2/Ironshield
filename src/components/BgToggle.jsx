"use client";
// BgToggle — floating dark/light page-background swap.
//
// Scope: ONLY toggles the outermost page background between the
// existing dark color (--page-bg default = #080b12) and white. Theme
// tokens (accents, cards, text colors) are intentionally untouched
// per the "quick fix, theme reserved" requirement.
//
// State: persists in localStorage (key 'ironshield:bg'). On mount,
// restores the saved choice and applies it via data-bg on <html>.
// Default is dark — no SSR flash on first paint because globals.css
// declares the dark color in :root and the light variant only kicks
// in when html[data-bg="light"] is present.

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

const STORAGE_KEY = "ironshield:bg";

function readSaved() {
  if (typeof window === "undefined") return "dark";
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyBg(mode) {
  if (typeof document === "undefined") return;
  if (mode === "light") {
    document.documentElement.dataset.bg = "light";
  } else {
    delete document.documentElement.dataset.bg;
  }
}

export default function BgToggle() {
  // Initial state false to match SSR (dark default). useEffect below
  // hydrates from localStorage; applyBg in the same effect prevents a
  // flicker on the first commit.
  const [mode, setMode] = useState("dark");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = readSaved();
    setMode(saved);
    applyBg(saved);
    setHydrated(true);
  }, []);

  const toggle = () => {
    const next = mode === "light" ? "dark" : "light";
    setMode(next);
    applyBg(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* private mode etc. */ }
  };

  // Don't render until hydrated to avoid an SSR/CSR mismatch flicker.
  if (!hydrated) return null;

  const isLight = mode === "light";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isLight ? "Switch to dark background" : "Switch to light background"}
      title={isLight ? "Dark background" : "Light background"}
      style={{
        position: "fixed",
        right: 14,
        bottom: 14,
        zIndex: 9999,
        width: 36,
        height: 36,
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.18)",
        background: isLight
          ? "rgba(255,255,255,0.92)"
          : "rgba(15,18,28,0.85)",
        color: isLight ? "#0f1219" : "#e2e8f0",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        transition: "background 0.15s ease, color 0.15s ease",
      }}
    >
      {isLight ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}
