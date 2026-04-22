"use client";
// useKeyboardShortcuts — one keydown listener for the whole app.
//
// Keybinds:
//   /        → open search overlay
//   p        → toggle feed pause
//   Escape   → close any open overlay (handled per-overlay; we still
//              fire the action so feed pause can flip back)
//
// Press-targets: ignored when focus is inside an input, textarea,
// contenteditable, or select — typing "/" in the Bridge amount field
// shouldn't open search. Modifier combos also skip (Cmd+/, Ctrl+/)
// because browsers and IDEs bind those for their own things.

import { useEffect } from "react";

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isTypingTarget(target) {
  if (!target || !target.tagName) return false;
  if (EDITABLE_TAGS.has(target.tagName)) return true;
  if (target.isContentEditable) return true;
  return false;
}

/**
 * @param {object} handlers  { onSearch?, onPauseToggle?, onEscape? }
 * @param {boolean} enabled  disable the hook (e.g. while a modal
 *   already owns focus and has its own keybinds).
 */
export default function useKeyboardShortcuts({ onSearch, onPauseToggle, onEscape } = {}, enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const handler = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;          // leave chords alone
      if (isTypingTarget(e.target)) return;                    // typing in a field
      if (e.key === "/") {
        if (!onSearch) return;
        e.preventDefault();
        onSearch();
      } else if (e.key === "p" || e.key === "P") {
        if (!onPauseToggle) return;
        e.preventDefault();
        onPauseToggle();
      } else if (e.key === "Escape") {
        onEscape?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, onSearch, onPauseToggle, onEscape]);
}
