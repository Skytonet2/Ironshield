"use client";
// ComingSoonPanel — shared stub for surfaces that are scoped + announced
// in the nav but not yet built. Used by the operator-side surfaces
// (/grind, /grind/leaderboard, /agents/[id]/configure, /skills/compose)
// so users who click into them see what the surface WILL do, not a
// 404 or a blank page.
//
// Pass `title`, a one-line `description`, and an optional `bullets`
// array — short "what this surface will do" notes. Optional `back`
// prop is { label, href } for a return link; defaults to /agents/me.
//
// Visual matches the existing custom-CSS-vars dark aesthetic. No
// extra dependencies.

import Link from "next/link";
import { Sparkles, ArrowLeft, Clock } from "lucide-react";

export default function ComingSoonPanel({
  title,
  description,
  bullets = [],
  back = { label: "Back to dashboard", href: "/agents/me" },
}) {
  return (
    // data-app-shell="ready" tells the boot PreLoader to unmount.
    // Standalone pages (no AppShell wrapper) need this marker
    // explicitly or the splash hangs at 65% until its 15s safety
    // timeout fires — looks like an endless loop on mobile.
    <div data-app-shell="ready" style={page}>
      <div style={shell}>
        <div style={badge}>
          <Clock size={12} /> Coming soon
        </div>
        <h1 style={titleStyle}>{title}</h1>
        <p style={descStyle}>{description}</p>

        {bullets.length > 0 && (
          <div style={bulletList}>
            <div style={bulletHeader}>What this surface will do once it ships:</div>
            <ul style={ulStyle}>
              {bullets.map((b, i) => (
                <li key={i} style={liStyle}>
                  <Sparkles size={11} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 4 }} />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={footerStyle}>
          <Link href={back.href} style={backLink}>
            <ArrowLeft size={13} />
            <span>{back.label}</span>
          </Link>
          <span style={hint}>
            Want to be notified? Drop your wallet at <Link href="/agents/me" style={subtleLink}>/agents/me</Link> and you'll see this surface unlock automatically when it ships.
          </span>
        </div>
      </div>
    </div>
  );
}

const page = {
  minHeight: "100vh",
  background: "var(--bg-app)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "32px 16px",
};

const shell = {
  width: "100%",
  maxWidth: 640,
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  borderRadius: 16,
  padding: "32px clamp(20px, 4vw, 36px)",
  boxShadow: "0 10px 40px rgba(0, 0, 0, 0.35)",
};

const badge = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "4px 11px",
  borderRadius: 999,
  background: "linear-gradient(135deg, rgba(168, 85, 247, 0.18), rgba(96, 165, 250, 0.14))",
  border: "1px solid var(--accent-border)",
  color: "var(--accent)",
  fontSize: 10.5,
  fontWeight: 800,
  letterSpacing: 1,
  textTransform: "uppercase",
  marginBottom: 14,
};

const titleStyle = {
  margin: "0 0 8px",
  fontSize: "clamp(22px, 3vw, 28px)",
  fontWeight: 800,
  color: "var(--text-1)",
  letterSpacing: -0.4,
  lineHeight: 1.2,
};

const descStyle = {
  margin: "0 0 22px",
  fontSize: 14,
  color: "var(--text-2)",
  lineHeight: 1.6,
};

const bulletList = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "16px 18px",
  marginBottom: 22,
};

const bulletHeader = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: 1,
  color: "var(--text-2)",
  textTransform: "uppercase",
  marginBottom: 10,
};

const ulStyle = {
  margin: 0,
  padding: 0,
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  gap: 9,
};

const liStyle = {
  display: "flex",
  gap: 8,
  alignItems: "flex-start",
  fontSize: 13,
  color: "var(--text-1)",
  lineHeight: 1.55,
};

const footerStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  fontSize: 12,
  color: "var(--text-2)",
};

const backLink = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 14px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--bg-card)",
  color: "var(--text-1)",
  fontSize: 12.5,
  fontWeight: 600,
  textDecoration: "none",
};

const hint = {
  flex: 1,
  minWidth: 220,
  textAlign: "right",
  lineHeight: 1.55,
};

const subtleLink = {
  color: "var(--accent)",
  textDecoration: "none",
  fontWeight: 600,
};
