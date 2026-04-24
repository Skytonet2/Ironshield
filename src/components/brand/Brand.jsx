"use client";
// IronShield brand system — one source, five smart implementations.
//
//   BrandPrimary   → landing hero / marketing. Premium gradient shield
//                    framing the 3D mascot raster, with a purple halo.
//                    Scales up to hundreds of pixels cleanly.
//   BrandMark      → sidebar / nav / tight chrome. Minimal shield with
//                    a simplified mascot face. Stays readable 16–40px.
//   BrandAppIcon   → PWA launcher / browser favicon bitmap previews.
//                    Rounded-square container + shield. Solid bg so
//                    the crest stands on any OS wallpaper.
//   BrandLoading   → splash / in-flight states. Monochrome (drives off
//                    currentColor) with a pulsing animation.
//   BrandAvatar    → social avatars + OG fallback. 1:1 halo-on-dark
//                    composition that crops well to a circle.
//
// Every variant takes an optional `size` (number or CSS string) and
// inherits color via currentColor where applicable, so hosts can
// style without touching the file itself.
//
// The four SVG assets live in /public/brand/. For large raster
// contexts (landing hero) BrandPrimary additionally composites
// /mascot.png on top of the SVG shield for photographic depth.

import Link from "next/link";

const asSize = (s) => (typeof s === "number" ? `${s}px` : s);

/* ─────────── 1. Primary (hero + marketing) ─────────── */

export function BrandPrimary({
  size = 160,
  withWordmark = true,
  tagline = null,
  className,
  style,
  asLink = false,
  href = "/",
}) {
  const inner = (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: withWordmark ? Math.max(10, Math.round(Number(size) * 0.1)) : 0,
        textDecoration: "none",
        color: "inherit",
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          position: "relative",
          width: asSize(size), height: asSize(size),
          flexShrink: 0,
          // Purple halo behind the crest — scales with the shield size.
          filter: "drop-shadow(0 16px 42px rgba(168,85,247,0.35))",
        }}
      >
        <img
          src="/brand/shield-primary.svg"
          alt=""
          width="100%"
          height="100%"
          style={{ width: "100%", height: "100%", display: "block" }}
        />
      </span>
      {withWordmark && (
        <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1 }}>
          <span style={{
            fontSize: Math.round(Number(size) * 0.28),
            fontWeight: 800,
            letterSpacing: -0.4,
            color: "#fff",
          }}>
            Iron<span style={{
              background: "linear-gradient(90deg, #60a5fa, #a855f7)",
              WebkitBackgroundClip: "text", backgroundClip: "text",
              WebkitTextFillColor: "transparent", color: "transparent",
            }}>Shield</span>
          </span>
          {tagline && (
            <span style={{
              marginTop: 6,
              fontSize: Math.max(11, Math.round(Number(size) * 0.09)),
              letterSpacing: 1.8,
              textTransform: "uppercase",
              color: "rgba(230,236,247,0.55)",
            }}>
              {tagline}
            </span>
          )}
        </span>
      )}
    </span>
  );
  if (asLink) {
    return <Link href={href} aria-label="IronShield — home" style={{ textDecoration: "none", color: "inherit" }}>{inner}</Link>;
  }
  return inner;
}

/* ─────────── 2. Mark (nav / sidebar / tight chrome) ─────────── */

export function BrandMark({ size = 28, withWordmark = false, href, asLink = false, className, style }) {
  // Mascot raster instead of the old SVG shield glyph, per the updated
  // brand direction. object-fit=contain keeps the full-body mascot
  // readable at tight chrome sizes (16–40px) since the source file is
  // a 2:3 portrait.
  const glyph = (
    <img
      src="/mascot.webp"
      alt=""
      width={size}
      height={size}
      style={{
        display:   "block",
        flexShrink: 0,
        objectFit: "contain",
      }}
    />
  );
  const content = withWordmark ? (
    <span
      className={className}
      style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        color: "inherit", textDecoration: "none",
        ...style,
      }}
    >
      {glyph}
      <span style={{ fontSize: Math.max(13, Math.round(size * 0.55)), fontWeight: 700, letterSpacing: -0.2, color: "inherit" }}>
        IronShield
      </span>
    </span>
  ) : glyph;
  if (asLink && href) {
    return <Link href={href} aria-label="IronShield" style={{ textDecoration: "none", color: "inherit" }}>{content}</Link>;
  }
  return content;
}

/* ─────────── 3. App Icon (favicon / PWA / launcher) ─────────── */

export function BrandAppIcon({ size = 64, className, style }) {
  return (
    <img
      src="/brand/app-icon.svg"
      alt="IronShield"
      className={className}
      width={size}
      height={size}
      style={{ display: "block", borderRadius: Math.round(size * 0.22), ...style }}
    />
  );
}

/* ─────────── 4. Loading (splash / in-flight) ─────────── */

export function BrandLoading({ size = 96, label = "Loading IronShield…", pulse = true, className, style }) {
  // Monochrome-ish crest that drives off `color` on the wrapper. Pulses
  // a purple glow by default; set pulse={false} for static contexts
  // (e.g. a small inline spinner where subtle is better).
  return (
    <span
      className={className}
      role="status"
      aria-live="polite"
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
        color: "#c4b8ff",
        ...style,
      }}
    >
      <span
        aria-hidden
        style={{
          width: asSize(size), height: asSize(size),
          display: "inline-flex",
          filter: "drop-shadow(0 0 24px rgba(168,85,247,0.5))",
          animation: pulse ? "ix-brand-pulse 2.4s ease-in-out infinite" : "none",
        }}
      >
        <img
          src="/mascot.webp"
          alt=""
          width="100%" height="100%"
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      </span>
      {label && (
        <span style={{
          fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase",
          color: "rgba(230,236,247,0.55)", fontWeight: 600,
        }}>
          {label}
        </span>
      )}
      <style jsx global>{`
        @keyframes ix-brand-pulse {
          0%, 100% {
            filter: drop-shadow(0 0 18px rgba(168,85,247,0.45));
            transform: scale(1);
          }
          50% {
            filter: drop-shadow(0 0 32px rgba(168,85,247,0.75))
                    drop-shadow(0 0 16px rgba(96,165,250,0.35));
            transform: scale(1.04);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          [role="status"] > span[aria-hidden] { animation: none !important; }
        }
      `}</style>
    </span>
  );
}

/* ─────────── 5. Social Avatar ─────────── */

// Renders the crest + halo as a self-contained 1:1 tile — used anywhere
// the app needs a default brand avatar (OG fallback, sidebar "IronShield
// Official" account, Telegram bot card, etc.). Shape-agnostic: if the
// host applies border-radius to the wrapper, the underlying SVG crops
// cleanly since the halo is centered.
export function BrandAvatar({ size = 80, rounded = true, className, style }) {
  return (
    <img
      src="/brand/social-avatar.svg"
      alt="IronShield"
      className={className}
      width={size}
      height={size}
      style={{
        display: "block",
        borderRadius: rounded ? "50%" : 12,
        ...style,
      }}
    />
  );
}

/* Named default export — makes `import Brand from …` pick up the full
   surface area for barrel-style imports, while individual destructured
   imports (`{ BrandMark }`) stay tree-shakeable. */
const Brand = { Primary: BrandPrimary, Mark: BrandMark, AppIcon: BrandAppIcon, Loading: BrandLoading, Avatar: BrandAvatar };
export default Brand;
