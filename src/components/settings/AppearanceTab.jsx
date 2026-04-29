"use client";
// AppearanceTab — spec §9B. Theme preset picker + custom accent +
// font size + density + reduce motion. All persist via useSettings
// (Phase 0). ThemeProvider subscribes to useSettings.theme so
// clicking a preset retints the whole app instantly.

import { useEffect, useState } from "react";
import { Lock, Crown } from "lucide-react";
import { useTheme, useWallet, PRO_THEME_PRESETS } from "@/lib/contexts";
import { useSettings } from "@/lib/stores/settingsStore";
import { API_BASE as API } from "@/lib/apiBase";

// Same nine presets that tokens.css defines — kept in literals here so
// the mini-preview rectangles show the right bg+accent without reading
// the CSS vars (which would only show the currently applied preset).
// `pro: true` entries are gated by is_pro on selection; CSS itself
// doesn't enforce that, the picker does.
const PRESETS = [
  { key: "default",  label: "Default",  bg: "#080b12", accent: "#3b82f6" },
  { key: "midnight", label: "Midnight", bg: "#05050f", accent: "#6366f1" },
  { key: "steel",    label: "Steel",    bg: "#09090b", accent: "#94a3b8" },
  { key: "carbon",   label: "Carbon",   bg: "#060606", accent: "#a3a3a3" },
  { key: "ember",    label: "Ember",    bg: "#080503", accent: "#f97316" },
  { key: "ironclaw", label: "IronClaw", bg: "#080303", accent: "#ef4444" },
  // v1.1.10 — AZUKA Pro presets. Locked for non-Pro members.
  { key: "emerald",  label: "Emerald",  bg: "#03080a", accent: "#10b981", pro: true },
  { key: "aurora",   label: "Aurora",   bg: "#050310", accent: "#a855f7", pro: true },
  { key: "gold",     label: "Gold",     bg: "#0a0703", accent: "#f59e0b", pro: true },
];

export default function AppearanceTab() {
  const t = useTheme();
  const { address: walletAddress } = useWallet();
  const theme           = useSettings((s) => s.theme);
  const setTheme        = useSettings((s) => s.setTheme);
  const accentOverride  = useSettings((s) => s.accentOverride);
  const setAccentOverride = useSettings((s) => s.setAccentOverride);
  const fontSize        = useSettings((s) => s.fontSize);
  const setFontSize     = useSettings((s) => s.setFontSize);
  const density         = useSettings((s) => s.density);
  const setDensity      = useSettings((s) => s.setDensity);
  const reduceMotion    = useSettings((s) => s.reduceMotion);
  const setReduceMotion = useSettings((s) => s.setReduceMotion);

  // v1.1.10 — Pro state for the theme picker. Cosmetic gate; the
  // serious Pro perks live behind requirePro on real routes. We
  // hit /api/auth/me (unsigned, x-wallet header) which is rate-limited
  // server-side; one fetch per /settings open.
  const [isPro, setIsPro] = useState(false);
  useEffect(() => {
    if (!walletAddress) { setIsPro(false); return; }
    let cancelled = false;
    fetch(`${API}/api/auth/me`, { headers: { "x-wallet": walletAddress } })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (!cancelled) setIsPro(Boolean(j?.isPro)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [walletAddress]);

  // Apply custom accent override by setting the CSS var directly. This
  // sits on top of the [data-theme] preset — clearing the override
  // lets the preset's accent show through again.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (accentOverride) {
      document.documentElement.style.setProperty("--accent", accentOverride);
    } else {
      document.documentElement.style.removeProperty("--accent");
    }
  }, [accentOverride]);

  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: t.white }}>
        Appearance
      </h1>
      <p style={{ margin: "4px 0 20px", fontSize: 12, color: t.textMuted }}>
        Everything persists to this browser. Changes take effect instantly.
      </p>

      {/* Theme presets */}
      <Section title="Theme preset" t={t}>
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 10,
        }}>
          {PRESETS.map((p) => {
            const active = p.key === theme;
            const locked = !!p.pro && !isPro;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  if (locked) {
                    // Route to the upgrade flow rather than letting
                    // the click silently no-op. Same surface as the
                    // AppShell upgrade card / requirePro 402 redirect.
                    if (typeof window !== "undefined") {
                      window.location.assign("/rewards#pro");
                    }
                    return;
                  }
                  setTheme(p.key);
                }}
                title={locked ? "AZUKA Pro theme — click to upgrade" : p.label}
                style={{
                  position: "relative",
                  padding: 10,
                  borderRadius: 10,
                  border: `1px solid ${active ? p.accent : t.border}`,
                  background: active ? "var(--bg-card-hover)" : "var(--bg-card)",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "transform 120ms var(--ease-out)",
                  opacity: locked ? 0.78 : 1,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
              >
                <div style={{
                  position: "relative",
                  height: 54,
                  borderRadius: 6,
                  background: p.bg,
                  border: `1px solid ${t.border}`,
                  overflow: "hidden",
                }}>
                  <div style={{
                    position: "absolute",
                    right: 8, bottom: 8,
                    width: 18, height: 18,
                    borderRadius: "50%",
                    background: p.accent,
                    boxShadow: `0 0 12px ${p.accent}aa`,
                  }} />
                  {locked && (
                    <div style={{
                      position: "absolute", inset: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: "rgba(0,0,0,0.45)",
                      backdropFilter: "blur(2px)",
                    }}>
                      <Lock size={18} style={{ color: "#fff", opacity: 0.85 }} />
                    </div>
                  )}
                </div>
                <div style={{
                  marginTop: 8, fontSize: 12, fontWeight: 600,
                  color: active ? p.accent : t.text,
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  {p.label}
                  {p.pro && (
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 3,
                      padding: "1px 6px", borderRadius: 999,
                      background: "linear-gradient(135deg, #a855f7, #6366f1)",
                      color: "#fff",
                      fontSize: 9, fontWeight: 800, letterSpacing: 0.4,
                    }}>
                      <Crown size={9} />PRO
                    </span>
                  )}
                  {active && <span style={{ fontSize: 10, color: t.textDim }}>· active</span>}
                </div>
              </button>
            );
          })}
        </div>
      </Section>

      {/* Custom accent */}
      <Section title="Custom accent" subtitle="Overrides the preset's accent. Clear to revert." t={t}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input
            type="color"
            value={accentOverride || PRESETS.find((p) => p.key === theme)?.accent || "#3b82f6"}
            onChange={(e) => setAccentOverride(e.target.value)}
            style={{
              width: 48, height: 36, padding: 0,
              border: `1px solid ${t.border}`,
              borderRadius: 8,
              background: "transparent",
              cursor: "pointer",
            }}
          />
          <code style={{
            padding: "6px 10px",
            borderRadius: 6,
            background: "var(--bg-input)",
            color: t.text,
            fontFamily: "var(--font-jetbrains-mono), monospace",
            fontSize: 12,
          }}>
            {accentOverride || "(preset default)"}
          </code>
          {accentOverride && (
            <button
              type="button"
              onClick={() => setAccentOverride(null)}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: `1px solid ${t.border}`,
                background: "var(--bg-input)",
                color: t.textMuted,
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          )}
        </div>
      </Section>

      {/* Font size */}
      <Section title="Font size" subtitle={`${fontSize}px`} t={t}>
        <input
          type="range"
          min="11" max="15" step="1"
          value={fontSize}
          onChange={(e) => setFontSize(Number(e.target.value))}
          style={{ width: "100%", maxWidth: 320 }}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 6, fontSize: 10, color: t.textDim }}>
          <span>11</span><span>·</span><span>13</span><span>·</span><span>15</span>
        </div>
      </Section>

      {/* Density */}
      <Section title="Layout density" t={t}>
        <div style={{ display: "flex", gap: 6 }}>
          {["compact", "normal", "spacious"].map((d) => {
            const active = d === density;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDensity(d)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 8,
                  border: `1px solid ${active ? t.accent : t.border}`,
                  background: active ? "var(--accent-dim)" : "transparent",
                  color: active ? t.accent : t.textMuted,
                  fontSize: 12,
                  textTransform: "capitalize",
                  cursor: "pointer",
                }}
              >
                {d}
              </button>
            );
          })}
        </div>
      </Section>

      {/* Reduce motion */}
      <Section title="Reduce motion" subtitle="Turns off ambient animations + card hovers." t={t}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={!!reduceMotion}
            onChange={(e) => setReduceMotion(e.target.checked)}
            style={{ width: 18, height: 18, accentColor: t.accent }}
          />
          <span style={{ fontSize: 12, color: t.text }}>
            {reduceMotion ? "On" : "Off"}
          </span>
        </label>
      </Section>
    </div>
  );
}

function Section({ title, subtitle, children, t }) {
  return (
    <section style={{
      padding: "14px 16px",
      border: `1px solid ${t.border}`,
      borderRadius: 12,
      background: "var(--bg-card)",
      marginBottom: 10,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: t.white }}>
          {title}
        </h2>
        {subtitle && (
          <span style={{ fontSize: 11, color: t.textDim }}>{subtitle}</span>
        )}
      </div>
      {children}
    </section>
  );
}
