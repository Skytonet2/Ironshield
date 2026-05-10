// src/lib/theme.js
// AZUKA design tokens — JS mirror of the CSS custom properties defined
// in src/app/globals.css. Read here from any inline style={{}} so the
// codebase has a single source of truth for colors, spacing, and
// shadows. See docs/UI_TOKENS.md for the migration plan.
//
// "No colour conflicts" rule: never paste a raw hex into a component.
// Either use a CSS var (`color: 'var(--azuka-blue-500)'`) or import
// the matching JS constant from this file:
//
//   import { THEME } from "@/lib/theme";
//   <button style={{ background: THEME.blue[500], color: THEME.text.inverse }}>
//
// The JS values must match the CSS values in globals.css exactly. If
// you change a hex here you MUST mirror it there (and vice-versa).
// We don't read CSS vars from JS at runtime because most callers run
// during SSR where window/getComputedStyle aren't available.

export const THEME = Object.freeze({
  blue: Object.freeze({
    50:  "#EFF6FF",
    100: "#DBEAFE",
    200: "#BFDBFE",
    300: "#93C5FD",
    400: "#60A5FA",
    500: "#3B82F6", // primary
    600: "#2563EB", // primary hover
    700: "#1D4ED8", // primary pressed
  }),

  surface: Object.freeze({
    canvas: "#FFFFFF",
    card:   "#FFFFFF",
    subtle: "#F8FAFC",
    muted:  "#F1F5F9",
    tinted: "#EFF6FF",
  }),

  text: Object.freeze({
    primary:   "#0F172A",
    secondary: "#475569",
    muted:     "#94A3B8",
    inverse:   "#FFFFFF",
    accent:    "#2563EB",
  }),

  border: Object.freeze({
    subtle:  "#E2E8F0",
    default: "#CBD5E1",
    strong:  "#94A3B8",
  }),

  status: Object.freeze({
    success: "#10B981",
    warning: "#F59E0B",
    danger:  "#EF4444",
    info:    "#3B82F6",
  }),

  shadow: Object.freeze({
    sm: "0 1px 2px rgba(15, 23, 42, 0.04)",
    md: "0 4px 12px rgba(15, 23, 42, 0.06)",
    lg: "0 12px 32px rgba(15, 23, 42, 0.08)",
  }),

  /// Deprecated dark-theme tokens. Kept here only so a search for
  /// "#080b12" returns this constant instead of inviting a copy-paste
  /// of the raw hex into a fresh component. New code SHOULD NOT read
  /// from `legacy.*` — use `surface.*` and `text.*` above instead.
  legacy: Object.freeze({
    bgPage:    "#080b12",
    bgCard:    "#0d1117",
    textBody:  "#e2e8f0",
    textMute:  "#64748b",
    border:    "#334155",
    linkHover: "#ffffff",
  }),
});

/// Convenience: opt a subtree into the new v2 chrome. Drop on the
/// outermost element of a redesigned screen so globals.css can scope
/// the white background + selection style to it. Until the whole
/// app is migrated, the legacy dark theme still serves anything
/// that doesn't carry this attribute.
export const AZUKA_V2 = { "data-azuka-v2": true };
