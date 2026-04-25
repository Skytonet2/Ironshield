"use client";
// AgentAvatar — single renderer for every avatar in the app. Takes a
// raw stored value (e.g. "preset:robot-purple", a data URI, or a
// remote URL) and resolves it to either an inline SVG (for presets)
// or an <img> tag with the right fit + radius. Keeps the "what does
// my agent look like?" answer consistent across the wizard preview,
// dashboard header, ManageAgents row, and any future share card.

import { parseAvatar } from "./avatarPresets";

export default function AgentAvatar({ value, size = 48, alt = "Agent avatar", className, style }) {
  const parsed = parseAvatar(value);
  const dim = typeof size === "number" ? `${size}px` : size;

  if (parsed.kind === "preset") {
    const { preset } = parsed;
    const idSafe = preset.id.replace(/[^a-z0-9]/gi, "");
    const gradId = `aa-${idSafe}`;
    return (
      <span
        className={className}
        aria-label={alt}
        style={{
          width: dim, height: dim, flexShrink: 0,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          ...style,
        }}
      >
        <svg
          viewBox="0 0 64 64" width="100%" height="100%"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          style={{ display: "block" }}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%"  stopColor={preset.from} />
              <stop offset="100%" stopColor={preset.to} />
            </linearGradient>
          </defs>
          <circle cx="32" cy="32" r="32" fill={`url(#${gradId})`} />
          <text
            x="32" y="34"
            fontSize="32"
            textAnchor="middle"
            dominantBaseline="middle"
            style={{ pointerEvents: "none" }}
          >
            {preset.emoji}
          </text>
        </svg>
      </span>
    );
  }

  if (parsed.kind === "data" || parsed.kind === "url") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={parsed.src}
        alt={alt}
        className={className}
        width={typeof size === "number" ? size : undefined}
        height={typeof size === "number" ? size : undefined}
        style={{
          width: dim, height: dim, flexShrink: 0,
          objectFit: "cover", borderRadius: "50%",
          ...style,
        }}
        // Bad URL → fall through to a neutral grey circle.
        onError={(e) => {
          if (typeof window === "undefined") return;
          e.currentTarget.style.display = "none";
        }}
      />
    );
  }

  // No value or unknown shape: render a soft placeholder ring.
  return (
    <span
      className={className}
      aria-label={alt}
      style={{
        width: dim, height: dim, flexShrink: 0, borderRadius: "50%",
        background: "rgba(168,85,247,0.18)",
        border: "1px solid rgba(168,85,247,0.35)",
        ...style,
      }}
    />
  );
}
