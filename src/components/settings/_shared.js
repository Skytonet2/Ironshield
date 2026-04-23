// Shared style helpers for the settings tabs. Factoring these out keeps
// each tab file small and the visual language consistent across them.

export const tabCard = (t) => ({
  padding: 16,
  borderRadius: 12,
  border: `1px solid ${t.border}`,
  background: "var(--bg-card)",
});

export const tabTitle = (t) => ({
  margin: 0,
  color: t.white,
  fontSize: 18,
  fontWeight: 700,
  letterSpacing: -0.2,
});

export const row = (t) => ({
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 0",
  borderBottom: `1px solid ${t.border}`,
});

export const rowSub = (t) => ({
  fontSize: 11,
  color: t.textDim,
  marginTop: 2,
  lineHeight: 1.45,
});

export const toggle = (t, on) => ({
  position: "relative",
  width: 42,
  height: 22,
  borderRadius: 999,
  border: `1px solid ${on ? t.accent : t.border}`,
  background: on ? t.accent : "var(--bg-input)",
  cursor: "pointer",
  transition: "background 160ms ease, border-color 160ms ease",
  flexShrink: 0,
});

export const btn = (t, primary = false) => ({
  padding: "8px 14px",
  borderRadius: 8,
  border: primary ? "none" : `1px solid ${t.border}`,
  background: primary ? t.accent : "var(--bg-surface)",
  color: primary ? "#fff" : t.text,
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
});

export const input = (t) => ({
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: `1px solid ${t.border}`,
  background: "var(--bg-input)",
  color: t.text,
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
});
