"use client";
// motion.js — tiny wrapper layer over framer-motion. Exposes the
// handful of variants we actually use across the app so every page
// transition / card enter / hover lift behaves identically.
//
// We use LazyMotion + domAnimation to keep the bundle small — only
// the DOM animation subset (no layout-animations / projections) is
// loaded. That's ~4.5kb gzipped vs ~20kb for the full package.

import { LazyMotion, domAnimation, m, AnimatePresence, useReducedMotion, useInView } from "framer-motion";

// Page-level transitions — children render with a soft fade + 4px
// lift. Kept subtle; on reduced-motion we drop the y translate so
// the page just fades.
export const pageVariants = {
  initial:  { opacity: 0, y: 4 },
  animate:  { opacity: 1, y: 0, transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] } },
  exit:     { opacity: 0, y: -2, transition: { duration: 0.12, ease: [0.4, 0, 0.2, 1] } },
};

// Feed-card stagger — each card pops in with a small delay relative
// to its index so the whole list doesn't flicker all at once. The
// parent container sets staggerChildren; children just specify their
// own in/out variants.
export const feedContainerVariants = {
  initial: { opacity: 1 },
  animate: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.02 },
  },
};
export const feedCardVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.24, ease: [0.16, 1, 0.3, 1] } },
  exit:    { opacity: 0, y: -4, transition: { duration: 0.12 } },
};

// Sidebar item hover — gentle scale + tint. Framer's whileHover keeps
// the animation off the critical render path.
export const hoverLift = { scale: 1.01, transition: { duration: 0.15 } };
export const hoverTap  = { scale: 0.98 };

// Collapsible textarea / panel — height auto is expensive at 60fps,
// so we animate opacity + maxHeight with a large ceiling and rely on
// content to determine actual size. Good enough for a short compose
// box; switch to height: "auto" later if we need pixel-perfect.
export const expandVariants = {
  collapsed: { opacity: 0, maxHeight: 0, overflow: "hidden" },
  open:      {
    opacity: 1,
    maxHeight: 480,
    overflow: "visible",
    transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
  },
};

export { LazyMotion, domAnimation, m, AnimatePresence, useReducedMotion, useInView };
