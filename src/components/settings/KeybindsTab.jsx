"use client";
// Keybinds — reference card for every keyboard shortcut wired into the
// app, plus a way to surface the chord that opens this tab so users can
// bookmark it. Full remapping is a roadmap item; today's pass is the
// reference + a reset-to-defaults stub that clears any local overrides.

import { useTheme } from "@/lib/contexts";
import { tabCard, tabTitle, btn } from "./_shared";

const SHORTCUTS = [
  {
    group: "Navigation",
    items: [
      { keys: ["g", "h"],  label: "Go to Home" },
      { keys: ["g", "f"],  label: "Go to Feed" },
      { keys: ["g", "p"],  label: "Go to Portfolio" },
      { keys: ["g", "g"],  label: "Go to Governance" },
      { keys: ["g", "r"],  label: "Go to Rewards" },
      { keys: ["g", "m"],  label: "Go to Messages" },
    ],
  },
  {
    group: "Composition",
    items: [
      { keys: ["n"],       label: "New post" },
      { keys: ["/"],       label: "Focus search" },
      { keys: ["Esc"],     label: "Close modal / drawer" },
      { keys: ["Enter"],   label: "Send message / submit" },
      { keys: ["Shift", "Enter"], label: "Newline in composer" },
    ],
  },
  {
    group: "Feed",
    items: [
      { keys: ["j"],       label: "Next post" },
      { keys: ["k"],       label: "Previous post" },
      { keys: ["l"],       label: "Like focused post" },
      { keys: ["r"],       label: "Reply to focused post" },
      { keys: ["p"],       label: "Pause / resume feed" },
      { keys: ["."],       label: "Refresh top of feed" },
    ],
  },
];

export default function KeybindsTab() {
  const t = useTheme();
  const onReset = () => {
    try { localStorage.removeItem("ironshield:keybinds"); } catch {}
    // Best-effort: dispatch an event so any listener can pick up the
    // change without a page reload. Currently no remapping store yet,
    // so this just confirms the reset.
    try { window.dispatchEvent(new CustomEvent("ironshield:keybinds-reset")); } catch {}
    alert("Shortcuts are already at their defaults — remapping lands in a future release.");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={tabTitle(t)}>Keybinds</h2>
        <p style={{ color: t.textDim, fontSize: 13, margin: "4px 0 0", lineHeight: 1.55 }}>
          Keyboard shortcuts wired into the app. Remapping is planned — for
          now, these are the defaults. Use <Kbd t={t}>g</Kbd> <Kbd t={t}>h</Kbd> to
          jump between sections without the mouse.
        </p>
      </div>

      {SHORTCUTS.map((group) => (
        <section key={group.group} style={tabCard(t)}>
          <div style={{ fontSize: 11, letterSpacing: 0.8, color: t.textDim, fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>
            {group.group}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {group.items.map((item, idx) => (
              <div key={idx} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "6px 0", borderBottom: idx < group.items.length - 1 ? `1px solid ${t.border}` : "none",
              }}>
                <div style={{ fontSize: 13, color: t.text, flex: 1 }}>{item.label}</div>
                <div style={{ display: "flex", gap: 4 }}>
                  {item.keys.map((k, i) => (
                    <Kbd key={i} t={t}>{k}</Kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <div>
        <button type="button" onClick={onReset} style={btn(t)}>
          Reset to defaults
        </button>
      </div>
    </div>
  );
}

function Kbd({ t, children }) {
  return (
    <kbd style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      minWidth: 22, height: 22, padding: "0 6px",
      borderRadius: 4, border: `1px solid ${t.border}`,
      background: "var(--bg-input)", color: t.text,
      fontSize: 11, fontWeight: 700, fontFamily: "var(--font-jetbrains-mono), monospace",
      letterSpacing: 0.2,
    }}>
      {children}
    </kbd>
  );
}
