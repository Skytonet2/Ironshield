// backend/__tests__/theme.tokens.test.js
// Phase E.1: enforces that the AZUKA design tokens stay in sync between
// src/lib/theme.js (consumed by inline style props) and
// src/app/globals.css (consumed by stylesheets and <style jsx>).
//
// If you add a new token to one file you MUST add it to the other.
// This test will fail loudly if a hex value diverges.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const themeJsPath = path.join(repoRoot, "src", "lib", "theme.js");
const globalsCssPath = path.join(repoRoot, "src", "app", "globals.css");

const themeJsSrc = fs.readFileSync(themeJsPath, "utf8");
const globalsCssSrc = fs.readFileSync(globalsCssPath, "utf8");

// Pull `--name: #HEX;` pairs out of globals.css. Tolerates rgba()
// values for the shadow tokens (we don't cross-check those — they're
// expressions, not flat colours).
function cssVarHexMap(src) {
  const out = new Map();
  const re = /--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{3,8})\s*;/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    out.set(m[1], m[2].toUpperCase());
  }
  return out;
}

// Pull a `key: "#HEX",` pair out of theme.js — value side is normalised
// uppercase so case differences don't trip the equality check.
function jsHex(src, key) {
  const re = new RegExp(`${key}:\\s*"(#[0-9A-Fa-f]{3,8})"`);
  const m = re.exec(src);
  return m ? m[1].toUpperCase() : null;
}

const css = cssVarHexMap(globalsCssSrc);

const pairs = [
  // ── Brand blue ──
  { js: "50",  css: "azuka-blue-50" },
  { js: "100", css: "azuka-blue-100" },
  { js: "200", css: "azuka-blue-200" },
  { js: "300", css: "azuka-blue-300" },
  { js: "400", css: "azuka-blue-400" },
  { js: "500", css: "azuka-blue-500" },
  { js: "600", css: "azuka-blue-600" },
  { js: "700", css: "azuka-blue-700" },
  // ── Surfaces ──
  { js: "canvas",  css: "surface-canvas" },
  { js: "card",    css: "surface-card" },
  { js: "subtle",  css: "surface-subtle" },
  { js: "muted",   css: "surface-muted" },
  { js: "tinted",  css: "surface-tinted" },
  // ── Text ──
  { js: "primary",   css: "text-primary" },
  { js: "secondary", css: "text-secondary" },
  { js: "muted",     css: "text-muted" },   // duplicate js key intentional, scoped per group
  { js: "inverse",   css: "text-inverse" },
  { js: "accent",    css: "text-accent" },
  // ── Borders ──
  { js: "subtle",  css: "border-subtle" },  // dup js key per group
  { js: "default", css: "border-default" },
  { js: "strong",  css: "border-strong" },
  // ── Status ──
  { js: "success", css: "status-success" },
  { js: "warning", css: "status-warning" },
  { js: "danger",  css: "status-danger" },
];

test("every CSS color token is present in globals.css", () => {
  for (const { css: cssName } of pairs) {
    assert.ok(
      css.has(cssName),
      `globals.css is missing --${cssName} — add it alongside any new theme.js token`,
    );
  }
});

test("brand blue scale matches between theme.js and globals.css", () => {
  for (const k of ["50", "100", "200", "300", "400", "500", "600", "700"]) {
    const cssHex = css.get(`azuka-blue-${k}`);
    const re = new RegExp(`${k}:\\s*"(#[0-9A-Fa-f]{3,8})"`);
    const m = re.exec(themeJsSrc);
    assert.ok(m, `theme.js is missing blue.${k}`);
    const jsHexVal = m[1].toUpperCase();
    assert.equal(
      jsHexVal, cssHex,
      `blue.${k} mismatch — theme.js=${jsHexVal} vs globals.css=${cssHex}`,
    );
  }
});

// Per-group equality: scope to the JS object key so we don't false-match
// e.g. text.muted vs surface.muted.
function scopedJsHex(src, group, key) {
  // Match the named group object (`group: Object.freeze({ ... key: "#hex" ... })`)
  const groupRe = new RegExp(`${group}:\\s*Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\)`);
  const groupMatch = groupRe.exec(src);
  if (!groupMatch) return null;
  return jsHex(groupMatch[1], key);
}

test("surface tokens match", () => {
  for (const k of ["canvas", "card", "subtle", "muted", "tinted"]) {
    const cssHex = css.get(`surface-${k}`);
    const jsHexVal = scopedJsHex(themeJsSrc, "surface", k);
    assert.ok(jsHexVal, `theme.js surface.${k} missing`);
    assert.equal(jsHexVal, cssHex, `surface.${k} mismatch — theme.js=${jsHexVal} vs globals.css=${cssHex}`);
  }
});

test("text tokens match", () => {
  for (const k of ["primary", "secondary", "muted", "inverse", "accent"]) {
    const cssHex = css.get(`text-${k}`);
    const jsHexVal = scopedJsHex(themeJsSrc, "text", k);
    assert.ok(jsHexVal, `theme.js text.${k} missing`);
    assert.equal(jsHexVal, cssHex, `text.${k} mismatch — theme.js=${jsHexVal} vs globals.css=${cssHex}`);
  }
});

test("border tokens match", () => {
  for (const k of ["subtle", "default", "strong"]) {
    const cssHex = css.get(`border-${k}`);
    const jsHexVal = scopedJsHex(themeJsSrc, "border", k);
    assert.ok(jsHexVal, `theme.js border.${k} missing`);
    assert.equal(jsHexVal, cssHex, `border.${k} mismatch — theme.js=${jsHexVal} vs globals.css=${cssHex}`);
  }
});

test("status tokens match", () => {
  for (const k of ["success", "warning", "danger"]) {
    const cssHex = css.get(`status-${k}`);
    const jsHexVal = scopedJsHex(themeJsSrc, "status", k);
    assert.ok(jsHexVal, `theme.js status.${k} missing`);
    assert.equal(jsHexVal, cssHex, `status.${k} mismatch — theme.js=${jsHexVal} vs globals.css=${cssHex}`);
  }
});

test("status.info points at the same hex as blue.500", () => {
  // info is a re-export so it always matches the brand primary.
  const blue500 = scopedJsHex(themeJsSrc, "blue", "500");
  const statusInfo = scopedJsHex(themeJsSrc, "status", "info");
  assert.equal(statusInfo, blue500, "status.info must equal blue.500");
});

test("data-azuka-v2 scoping rule exists in globals.css", () => {
  assert.match(
    globalsCssSrc,
    /\[data-azuka-v2\]\s*\{[^}]*background:\s*var\(--surface-canvas\)/,
    "globals.css must scope white background to [data-azuka-v2] until full migration",
  );
});

test("AZUKA_V2 export wires the right data attribute", () => {
  assert.match(themeJsSrc, /AZUKA_V2\s*=\s*\{\s*"data-azuka-v2":\s*true\s*\}/);
});
