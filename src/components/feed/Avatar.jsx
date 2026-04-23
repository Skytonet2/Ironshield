"use client";
// Avatar — renders a user's profile picture with a letter-fallback when
// the img fails to load. Previously FeedCard's `onError` just set
// `visibility: hidden`, so a broken pfp_url turned into an invisible gap;
// the post detail page had no error handler at all. Centralising the
// fallback here fixes both sites.

import { useState } from "react";

export default function Avatar({
  src,
  alt = "",
  size = 40,
  fallbackText = "?",
  fallbackBg = "var(--bg-input)",
  fallbackColor = "var(--text-dim)",
  style,
  className,
}) {
  const [failed, setFailed] = useState(false);
  const useImg = src && !failed;
  const letter = (fallbackText || "?").toString()[0]?.toUpperCase() || "?";

  if (useImg) {
    return (
      <img
        src={src}
        alt={alt}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={className}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          background: fallbackBg,
          flexShrink: 0,
          ...style,
        }}
      />
    );
  }

  return (
    <div
      className={className}
      aria-label={alt || fallbackText}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: fallbackBg,
        color: fallbackColor,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: Math.max(10, Math.round(size * 0.4)),
        flexShrink: 0,
        ...style,
      }}
    >
      {letter}
    </div>
  );
}
