"use client";
// LaunchpadSelector — the Phase 5 CREATE modal (spec §6).
//
// Step 1: chain tabs (NEAR / Solana — BNB opted out per earlier call)
// + platform cards. IronShield Pad is our own; everything else is an
// external redirect with ?ref=ironshield UTM so we can measure referral
// funnel downstream.
//
// Why no step 2+3 in here today: the existing NewsCoinPage already
// implements the full token-details → review → factory-call flow for
// NEAR. Rebuilding it inline would duplicate ~700 lines of wallet +
// NEP-141 wiring for zero product gain. Instead IronShield Pad (NEAR)
// deep-links into /?page=NewsCoin with pre-fill query params that
// NewsCoinPage picks up. Future phase can lift the form into this
// modal once the legacy router retires.
//
// Pre-fill via Coin It: the modal accepts a `prefill` prop so the
// Coin It funnel can hand over its suggested name/ticker/source.
//
// Opened by AppShell's onAction("create"). Close via backdrop click,
// Escape, the X, or a successful redirect.

import { useEffect, useState } from "react";
import { Zap, ArrowRight, ExternalLink, X as XIcon } from "lucide-react";
import { useTheme } from "@/lib/contexts";

const PLATFORMS = {
  near: [
    {
      id: "ironshield",
      name: "IronShield Pad",
      tag: "native",
      desc: "Our custom bonding curve on NEAR. 0% platform fee for $IRONCLAW holders. Full on-site launch + trading.",
      internal: "/?page=NewsCoin",
    },
    {
      id: "intear",
      name: "Intear",
      tag: "external",
      desc: "NEAR-native launchpad with community features. You'll be redirected to Intear to complete launch.",
      url: "https://intear.tech/launch",
    },
    {
      id: "meme.cooking",
      name: "meme.cooking",
      tag: "external",
      desc: "Fair-launch mechanics on NEAR. Redirects to meme.cooking.",
      url: "https://meme.cooking/",
    },
  ],
  sol: [
    {
      id: "ironshield",
      name: "IronShield Pad",
      tag: "soon",
      desc: "Our bonding curve on Solana — 0% fee for $IRONCLAW holders. Launch coming Q2.",
      disabled: true,
    },
    {
      id: "pump.fun",
      name: "Pump.fun",
      tag: "external",
      desc: "The most popular Solana meme launcher. Redirects with pre-filled data.",
      url: "https://pump.fun/create",
    },
    {
      id: "bags.fun",
      name: "Bags.fun",
      tag: "external",
      desc: "Solana launch with bag mechanics. External redirect.",
      url: "https://bags.fm/new",
    },
    {
      id: "bonk.fun",
      name: "Bonk.fun",
      tag: "external",
      desc: "Community-driven Solana launcher.",
      url: "https://bonk.fun/",
    },
  ],
};

function withParams(base, prefill) {
  if (!base) return base;
  const url = new URL(base, typeof window !== "undefined" ? window.location.origin : "https://ironshield.pages.dev");
  url.searchParams.set("ref", "ironshield");
  if (prefill?.name)    url.searchParams.set("name",    prefill.name);
  if (prefill?.ticker)  url.searchParams.set("ticker",  prefill.ticker);
  if (prefill?.sourceUrl) url.searchParams.set("source", prefill.sourceUrl);
  return url.toString();
}

export default function LaunchpadSelector({ onClose, prefill = null, initialChain = "near" }) {
  const t = useTheme();

  // Escape to close. Keep outside Card component so it's still active
  // even when a dropdown or tooltip has stolen focus.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const [chain, setChain] = useState(initialChain);

  async function pick(platform) {
    if (platform.disabled) return;
    if (platform.internal) {
      // Ironshield Pad (NEAR) — deep-link to legacy NewsCoin page.
      // Preserves existing wallet-connected session; no modal detour.
      window.location.assign(withParams(platform.internal, prefill));
      onClose?.();
      return;
    }
    if (platform.url) {
      // External: open in a new tab so we don't blow away the user's
      // current IronShield session.
      window.open(withParams(platform.url, prefill), "_blank", "noopener,noreferrer");
      onClose?.();
    }
  }

  const list = PLATFORMS[chain] || [];

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      className="ix-launchpad-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(8px)",
        zIndex: 220,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <style jsx global>{`
        @media (max-width: 640px) {
          .ix-launchpad-backdrop {
            background: var(--bg-app, #050816) !important;
            backdrop-filter: none !important;
            padding: 0 !important;
            align-items: stretch !important;
          }
          .ix-launchpad-modal {
            width: 100% !important;
            max-width: 100% !important;
            height: 100dvh !important;
            border-radius: 0 !important;
            border: none !important;
            box-shadow: none !important;
            padding: 18px !important;
            overflow-y: auto !important;
          }
        }
      `}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        className="ix-launchpad-modal"
        style={{
          width: "100%",
          maxWidth: 620,
          background: "var(--bg-surface)",
          border: `1px solid ${t.border}`,
          borderRadius: 14,
          boxShadow: "0 20px 80px rgba(0,0,0,0.5), var(--accent-glow)",
          padding: 22,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <Zap size={18} style={{ color: t.accent }} />
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: t.white }}>
            Launch a token
          </h2>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              color: t.textDim,
              cursor: "pointer",
              padding: 4,
              display: "inline-flex",
            }}
          >
            <XIcon size={16} />
          </button>
        </div>

        <p style={{ margin: "0 0 14px", fontSize: 12, color: t.textMuted, lineHeight: 1.5 }}>
          Pick a chain, then a launchpad. IronShield Pad keeps the launch native to our product;
          external launchers open in a new tab with your {prefill ? "pre-fill" : "defaults"}.
        </p>

        {/* Chain tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
          {[["near", "NEAR"], ["sol", "Solana"]].map(([v, label]) => {
            const active = chain === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setChain(v)}
                style={{
                  padding: "7px 16px",
                  borderRadius: 999,
                  border: `1px solid ${active ? t.accent : t.border}`,
                  background: active ? "var(--accent-dim)" : "transparent",
                  color: active ? t.accent : t.textMuted,
                  fontSize: 12,
                  fontWeight: 600,
                  letterSpacing: 0.6,
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Platform cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {list.map((p) => <PlatformCard key={p.id} platform={p} onPick={pick} t={t} />)}
        </div>

        {prefill && (prefill.name || prefill.ticker) && (
          <div style={{
            marginTop: 14,
            padding: "8px 10px",
            borderRadius: 8,
            background: "var(--bg-input)",
            fontSize: 11,
            color: t.textMuted,
            lineHeight: 1.5,
          }}>
            Pre-filling with{" "}
            {prefill.name   && <strong style={{ color: t.text }}>{prefill.name}</strong>}
            {prefill.name && prefill.ticker && " · "}
            {prefill.ticker && <code style={{ color: t.accent }}>${prefill.ticker}</code>}
            {prefill.sourceUrl ? " from the source you picked." : "."}
          </div>
        )}
      </div>
    </div>
  );
}

function PlatformCard({ platform, onPick, t }) {
  const disabled = !!platform.disabled;
  const tagStyles = {
    native:   { bg: "var(--accent-dim)", fg: t.accent,     label: "Native" },
    external: { bg: "var(--bg-input)",   fg: t.textMuted,  label: "External" },
    soon:     { bg: "var(--bg-input)",   fg: t.textDim,    label: "Soon" },
  }[platform.tag] || { bg: "var(--bg-input)", fg: t.textDim, label: platform.tag };

  return (
    <button
      type="button"
      onClick={() => onPick(platform)}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 12,
        border: `1px solid ${disabled ? t.border : t.border}`,
        background: disabled ? "var(--bg-input)" : "var(--bg-card)",
        textAlign: "left",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        transition: "background 150ms var(--ease-out), border-color 150ms var(--ease-out), transform 150ms var(--ease-out)",
      }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.borderColor = t.accent; e.currentTarget.style.transform = "translateY(-1px)"; } }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.transform = "translateY(0)"; }}
    >
      <div style={{
        width: 36, height: 36, flexShrink: 0,
        borderRadius: 10,
        background: "var(--accent-dim)",
        color: t.accent,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: 14,
      }}>
        {platform.name.charAt(0)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: t.white, fontWeight: 700, fontSize: 13 }}>{platform.name}</span>
          <span style={{
            fontSize: 9,
            padding: "1px 6px",
            borderRadius: 4,
            background: tagStyles.bg,
            color: tagStyles.fg,
            letterSpacing: 0.6,
            textTransform: "uppercase",
          }}>
            {tagStyles.label}
          </span>
        </div>
        <div style={{
          color: t.textMuted, fontSize: 11,
          marginTop: 3, lineHeight: 1.45,
          overflow: "hidden", textOverflow: "ellipsis",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
        }}>
          {platform.desc}
        </div>
      </div>
      {!disabled && (
        platform.url
          ? <ExternalLink size={14} style={{ color: t.textDim, flexShrink: 0 }} />
          : <ArrowRight   size={14} style={{ color: t.accent,  flexShrink: 0 }} />
      )}
    </button>
  );
}

