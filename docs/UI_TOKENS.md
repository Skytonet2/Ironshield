# AZUKA UI Tokens — single source of truth for colors

Status: Phase E.1 (additive). The new white + sky-blue palette and the legacy dark-theme palette coexist in this PR. Subsequent phases (E.2-E.7) consume the new tokens screen by screen until the whole app is migrated; the legacy tokens are removed last.

## The two files

| File | Used by | When to edit |
|---|---|---|
| `src/app/globals.css` | CSS rules, `<style jsx>`, anything that lives in a stylesheet | When adding a new colour or renaming an existing one |
| `src/lib/theme.js` | Inline `style={{}}` props (the dominant pattern in this codebase) | Mirror every change you make in globals.css |

The two files MUST stay in sync. There's a node:test guard (`backend/__tests__/theme.tokens.test.js`) that fails if any token's hex value diverges between them.

## The "no colour conflicts" rule

In any new or refactored component:

- Don't paste raw hex (`#3B82F6`) into a JSX style or stylesheet.
- Don't reach for Tailwind-style names (`blue-600`, `slate-100`) — there is no Tailwind config.
- Pick from the token set below. If the colour you need isn't there, **add it to both files in this PR**, don't fork.

```jsx
// ✗ Wrong
<button style={{ background: "#3B82F6", color: "white" }}>Connect wallet</button>

// ✓ Right
import { THEME } from "@/lib/theme";
<button style={{ background: THEME.blue[500], color: THEME.text.inverse }}>
  Connect wallet
</button>
```

## Token reference

### Brand — sky blue

Anchored on `#3B82F6` (Tailwind blue-500 for muscle memory). Use for primary actions, links, focus rings, brand accents. Never for body text below `400`.

| Token | Hex | Use |
|---|---|---|
| `THEME.blue[50]` / `--azuka-blue-50` | `#EFF6FF` | hero washes, callout backgrounds |
| `THEME.blue[100]` / `--azuka-blue-100` | `#DBEAFE` | hover bg on blue surfaces |
| `THEME.blue[200]` / `--azuka-blue-200` | `#BFDBFE` | text selection |
| `THEME.blue[300]` / `--azuka-blue-300` | `#93C5FD` | disabled primary |
| `THEME.blue[400]` / `--azuka-blue-400` | `#60A5FA` | secondary accent |
| `THEME.blue[500]` / `--azuka-blue-500` | `#3B82F6` | **primary action** |
| `THEME.blue[600]` / `--azuka-blue-600` | `#2563EB` | primary hover, links |
| `THEME.blue[700]` / `--azuka-blue-700` | `#1D4ED8` | primary pressed |

### Surfaces — white-first with subtle blue-tinted neutrals

| Token | Hex | Use |
|---|---|---|
| `THEME.surface.canvas` / `--surface-canvas` | `#FFFFFF` | page background |
| `THEME.surface.card` / `--surface-card` | `#FFFFFF` | card background |
| `THEME.surface.subtle` / `--surface-subtle` | `#F8FAFC` | hover row, table stripe |
| `THEME.surface.muted` / `--surface-muted` | `#F1F5F9` | sidebar, code blocks |
| `THEME.surface.tinted` / `--surface-tinted` | `#EFF6FF` | hero washes, callouts |

### Text — graphite on white, never pure black

| Token | Hex | Use |
|---|---|---|
| `THEME.text.primary` / `--text-primary` | `#0F172A` | headings, body |
| `THEME.text.secondary` / `--text-secondary` | `#475569` | labels, captions |
| `THEME.text.muted` / `--text-muted` | `#94A3B8` | placeholder, disabled |
| `THEME.text.inverse` / `--text-inverse` | `#FFFFFF` | on coloured surfaces |
| `THEME.text.accent` / `--text-accent` | `#2563EB` | links |

### Borders / dividers

| Token | Hex | Use |
|---|---|---|
| `THEME.border.subtle` / `--border-subtle` | `#E2E8F0` | card outlines |
| `THEME.border.default` / `--border-default` | `#CBD5E1` | inputs |
| `THEME.border.strong` / `--border-strong` | `#94A3B8` | active inputs |

### Status

Distinct from `azuka-blue` so a "completed" pill never reads as a primary button.

| Token | Hex | Use |
|---|---|---|
| `THEME.status.success` / `--status-success` | `#10B981` | completed, healthy |
| `THEME.status.warning` / `--status-warning` | `#F59E0B` | pending, in-review |
| `THEME.status.danger` / `--status-danger` | `#EF4444` | failed, expired |
| `THEME.status.info` / `--status-info` | `#3B82F6` | informational badges |

### Shadows

Short and soft — not the pillow-y dark-theme shadows.

| Token | Use |
|---|---|
| `THEME.shadow.sm` / `--shadow-sm` | borders for raised inputs |
| `THEME.shadow.md` / `--shadow-md` | cards |
| `THEME.shadow.lg` / `--shadow-lg` | modals, popovers |

## Opting into the new chrome

The site body still serves the legacy dark theme (`background: #080b12`) until E.2 flips the landing page. To preview a redesigned screen against a white background without breaking the rest of the app, mark its outer element with `data-azuka-v2`:

```jsx
import { AZUKA_V2 } from "@/lib/theme";

export default function NewLanding() {
  return (
    <div {...AZUKA_V2}>
      {/* white background + blue selection style scoped to this subtree */}
    </div>
  );
}
```

`globals.css` scopes a `[data-azuka-v2]` rule that paints the canvas white and sets the selection colour. Add more scoped resets there as the redesign matures.

## Migration plan

| Phase | Scope | Owns the new chrome |
|---|---|---|
| **E.1 (this PR)** | Tokens + docs + test guard. No visible changes. | — |
| E.2 | Landing / hero | Yes — first `data-azuka-v2` site |
| E.3 | App shell (left rail + top nav) | Yes |
| E.4 | Social feed | Inherits E.3 shell |
| E.5 | Skills marketplace cards | Inherits E.3 shell |
| E.6 | Agent dashboard (charts + tables) | Inherits E.3 shell |
| E.7 | Wallet connect modal | Last screen |
| E.8 | Delete legacy tokens, drop `data-azuka-v2` scoping, flip body background | Cleanup |

After E.8 the `legacy.*` block in `theme.js` and the `--legacy-*` vars in `globals.css` go away. The grep query `legacy` in either file should return zero hits at that point.
