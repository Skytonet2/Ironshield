"use client";
// UserMenu — the top-nav account slot.
//
// States:
//   1. No wallet connected → "Sign In" button that opens Privy login
//      (or the NEAR wallet chooser as a fallback when Privy isn't set).
//   2. Logged in → avatar that routes to /profile. A small chevron
//      beside it opens a dropdown with addresses + sign-out.
//
// We treat the avatar as the primary affordance — clicking it jumps
// straight to the user's profile — matching the pattern the rest of
// the app uses for "tap your own face to see your page."
//
// Lookup order for the viewer's identity:
//   · NEAR wallet-selector (@/lib/contexts) — if connected, this
//     address drives the pfp lookup since the backend's author rows
//     key off wallet.
//   · Privy-embedded / external wallets — for users who signed in
//     via email/Google/EVM/Solana.
// The first non-null wins.

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { LogOut, Copy, Check, User, ChevronDown } from "lucide-react";
import { useTheme, useWallet as useNearCtx } from "@/lib/contexts";
import { isPrivyConfigured } from "./PrivyWrapper";

// Resolve the backend base the same way other surfaces do: explicit
// env → localhost in dev → onrender in prod. Duplicated instead of
// imported because this file has no other API dependency.
const API = (() => {
  if (typeof window === "undefined") return "";
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3001";
  return "https://ironclaw-backend.onrender.com";
})();

function truncate(addr, left = 6, right = 4) {
  if (!addr) return "";
  return addr.length <= left + right ? addr : `${addr.slice(0, left)}…${addr.slice(-right)}`;
}

// Day 18.3 — PRO badge. Fetches /api/auth/me when the wallet changes
// and renders a small pill if the user is a Pro member. Shared
// between the Privy and NEAR-only UserMenu variants so both surfaces
// show the same pill consistently. Renders nothing while loading or
// for non-Pro users.
function ProBadge({ nearAddr, t }) {
  const [isPro, setIsPro] = useState(false);
  useEffect(() => {
    if (!nearAddr) { setIsPro(false); return; }
    let cancelled = false;
    fetch(`${API}/api/auth/me`, {
      headers: { "x-wallet": nearAddr },
    }).then((r) => r.ok ? r.json() : null).then((j) => {
      if (cancelled) return;
      setIsPro(Boolean(j?.isPro));
    }).catch(() => { /* leave non-Pro on failure */ });
    return () => { cancelled = true; };
  }, [nearAddr]);
  if (!isPro) return null;
  return (
    <span style={{
      marginLeft: 6,
      padding: "1px 6px",
      borderRadius: 999,
      background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
      color: "#fff",
      fontSize: 9, fontWeight: 800, letterSpacing: 0.6,
      verticalAlign: "middle",
    }}>PRO</span>
  );
}

function CopyableAddress({ label, address, t }) {
  const [copied, setCopied] = useState(false);
  if (!address) return null;
  const onCopy = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard blocked — silently ignore */ }
  };
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      padding: "6px 10px",
      fontSize: 11,
      color: t.textMuted,
      fontFamily: "var(--font-jetbrains-mono), monospace",
    }}>
      <span style={{ color: t.textDim, letterSpacing: 0.6 }}>{label}</span>
      <span style={{ color: t.text }}>{truncate(address)}</span>
      <button
        type="button"
        onClick={onCopy}
        style={{
          padding: 4,
          border: "none",
          background: "transparent",
          color: copied ? "var(--green)" : t.textMuted,
          cursor: "pointer",
          display: "inline-flex",
        }}
        title={copied ? "Copied" : "Copy address"}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );
}

// Tiny cache for the viewer's profile so every page mount doesn't
// re-fetch the same row. Scoped to the module so a sign-out clears it
// when the wallet address changes.
const _pfpCache = new Map();
async function fetchViewerProfile(wallet) {
  if (!wallet) return null;
  if (_pfpCache.has(wallet)) return _pfpCache.get(wallet);
  try {
    const r = await fetch(`${API}/api/profile/${encodeURIComponent(wallet)}`);
    if (!r.ok) return null;
    const j = await r.json();
    _pfpCache.set(wallet, j?.user || null);
    return j?.user || null;
  } catch { return null; }
}

export default function UserMenu() {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const ref = useRef(null);
  const nearCtx = useNearCtx();

  // Close on click-outside. Focus-based close would be nicer but
  // 12 lines of JS beats pulling in a Popover primitive.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Hydrate the viewer's profile so the avatar can show their real
  // pfp. Runs whenever the primary wallet address changes (sign-in /
  // sign-out / chain switch).
  useEffect(() => {
    const w = nearCtx?.address;
    if (!w) { setProfile(null); return; }
    let alive = true;
    fetchViewerProfile(w).then((p) => { if (alive) setProfile(p); });
    return () => { alive = false; };
  }, [nearCtx?.address]);

  const nearAddr = nearCtx?.address || null;

  // If Privy isn't configured AND there's no NEAR wallet connected,
  // render the disabled placeholder. If Privy isn't configured but the
  // user has a NEAR wallet, we can still show the profile-linked
  // avatar — that user's fully signed in from IronShield's POV.
  if (!isPrivyConfigured && !nearAddr) {
    return (
      <button
        type="button"
        title="Connect a wallet to sign in"
        onClick={() => nearCtx?.showModal?.()}
        style={{
          height: 30,
          padding: "0 12px",
          borderRadius: 8,
          border: `1px solid ${t.border}`,
          background: "var(--bg-input)",
          color: t.text,
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        Sign In
      </button>
    );
  }

  // Two Inner variants so React's rules-of-hooks stay happy: the
  // Privy-flavored one calls usePrivy()/useWallets() unconditionally,
  // the NEAR-only one never touches Privy hooks. `isPrivyConfigured`
  // is a module-level constant so the choice is stable per-mount.
  const Inner = isPrivyConfigured ? UserMenuInnerPrivy : UserMenuInnerNearOnly;
  return (
    <Inner
      t={t}
      open={open}
      setOpen={setOpen}
      refEl={ref}
      nearAddr={nearAddr}
      nearProfile={profile}
      nearSignOut={nearCtx?.signOut}
    />
  );
}

function UserMenuInnerPrivy({ t, open, setOpen, refEl, nearAddr, nearProfile, nearSignOut }) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();

  const evm = wallets.find((w) => w.chainType === "ethereum");
  const sol = wallets.find((w) => w.chainType === "solana");
  const email = user?.email?.address;
  const isCustodial = wallets.some((w) => w.walletClientType === "privy");

  const isAuthenticated = Boolean(nearAddr) || authenticated;

  if (!ready && !nearAddr) {
    return (
      <div style={{
        width: 30, height: 30, borderRadius: "50%",
        border: `1px solid ${t.border}`, background: "var(--bg-input)",
      }} aria-label="Loading auth" />
    );
  }

  if (!isAuthenticated) {
    return (
      <button
        type="button"
        onClick={login}
        style={{
          height: 30,
          padding: "0 14px",
          borderRadius: 8,
          border: "none",
          background: t.accent,
          color: "#fff",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Sign In
      </button>
    );
  }

  // When logged in: show an avatar Link that routes to /profile (the
  // primary affordance), plus a tiny chevron button that opens the
  // dropdown for sign-out + copyable addresses.
  const displayName = nearProfile?.displayName || nearProfile?.username || email || truncate(nearAddr);
  const pfpUrl = nearProfile?.pfpUrl;
  const initial = (displayName || "?")[0]?.toUpperCase();

  return (
    <div ref={refEl} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6 }}>
      <Link
        href="/profile"
        title={`View profile — ${displayName}`}
        style={{
          width: 30, height: 30, borderRadius: "50%",
          border: `1px solid ${t.border}`,
          background: pfpUrl
            ? `url("${pfpUrl}") center/cover no-repeat`
            : `linear-gradient(135deg, ${t.accent}, #a855f7)`,
          color: "#fff",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, fontWeight: 800,
          textDecoration: "none",
          transition: "transform 120ms ease, border-color 120ms ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = t.accent; e.currentTarget.style.transform = "scale(1.04)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.transform = "scale(1)"; }}
      >
        {!pfpUrl && initial}
      </Link>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-label="Account menu"
        aria-expanded={open}
        style={{
          width: 20, height: 30,
          padding: 0, borderRadius: 6,
          border: `1px solid ${open ? t.accent : "transparent"}`,
          background: "transparent",
          color: open ? t.accent : t.textMuted,
          cursor: "pointer",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <ChevronDown size={13} />
      </button>
      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          right: 0,
          width: 280,
          background: "var(--bg-surface)",
          border: `1px solid ${t.border}`,
          borderRadius: 10,
          boxShadow: "0 10px 40px rgba(0,0,0,0.4), var(--accent-glow)",
          zIndex: 50,
          overflow: "hidden",
        }}>
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${t.border}` }}>
            <div style={{ fontSize: 13, color: t.text, fontWeight: 700 }}>
              {displayName}
              <ProBadge nearAddr={nearAddr} t={t} />
            </div>
            {email && email !== displayName && (
              <div style={{ fontSize: 11, color: t.textDim, marginTop: 2 }}>{email}</div>
            )}
            {isCustodial && (
              <div style={{
                fontSize: 10, color: t.accent, marginTop: 4,
                letterSpacing: 0.6, textTransform: "uppercase",
              }}>
                Embedded wallet · reveal seed in settings
              </div>
            )}
          </div>
          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 12px", fontSize: 12, color: t.text,
              textDecoration: "none",
              transition: "background 100ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-card-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <User size={12} /> View profile
          </Link>
          <div style={{ padding: "4px 0", borderTop: `1px solid ${t.border}` }}>
            {nearAddr && <CopyableAddress label="NEAR" address={nearAddr} t={t} />}
            <CopyableAddress label="EVM"  address={evm?.address} t={t} />
            <CopyableAddress label="SOL"  address={sol?.address} t={t} />
          </div>
          <div style={{ borderTop: `1px solid ${t.border}`, padding: 4 }}>
            <button
              type="button"
              onClick={async () => {
                setOpen(false);
                try { await nearSignOut?.(); } catch {}
                try { if (authenticated) await logout(); } catch {}
              }}
              style={{
                width: "100%",
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 10px", borderRadius: 6,
                background: "transparent", border: "none",
                color: t.textMuted, fontSize: 12,
                cursor: "pointer", textAlign: "left",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-card-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <LogOut size={12} /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// NEAR-only variant: used when Privy isn't configured. Takes the same
// props as the Privy variant and delegates rendering to a shared helper
// so the avatar/dropdown layout stays identical.
function UserMenuInnerNearOnly({ t, open, setOpen, refEl, nearAddr, nearProfile, nearSignOut }) {
  if (!nearAddr) {
    // This shouldn't happen — the outer gates on either Privy or a
    // NEAR address being present — but keep a safe fallback.
    return null;
  }
  const displayName = nearProfile?.displayName || nearProfile?.username || truncate(nearAddr);
  const pfpUrl = nearProfile?.pfpUrl;
  const initial = (displayName || "?")[0]?.toUpperCase();

  return (
    <div ref={refEl} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6 }}>
      <Link
        href="/profile"
        title={`View profile — ${displayName}`}
        style={{
          width: 30, height: 30, borderRadius: "50%",
          border: `1px solid ${t.border}`,
          background: pfpUrl
            ? `url("${pfpUrl}") center/cover no-repeat`
            : `linear-gradient(135deg, ${t.accent}, #a855f7)`,
          color: "#fff",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, fontWeight: 800,
          textDecoration: "none",
        }}
      >
        {!pfpUrl && initial}
      </Link>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-label="Account menu"
        aria-expanded={open}
        style={{
          width: 20, height: 30, padding: 0, borderRadius: 6,
          border: `1px solid ${open ? t.accent : "transparent"}`,
          background: "transparent",
          color: open ? t.accent : t.textMuted,
          cursor: "pointer",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <ChevronDown size={13} />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0,
          width: 260, background: "var(--bg-surface)",
          border: `1px solid ${t.border}`, borderRadius: 10,
          boxShadow: "0 10px 40px rgba(0,0,0,0.4), var(--accent-glow)",
          zIndex: 50, overflow: "hidden",
        }}>
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${t.border}` }}>
            <div style={{ fontSize: 13, color: t.text, fontWeight: 700 }}>
              {displayName}
              <ProBadge nearAddr={nearAddr} t={t} />
            </div>
          </div>
          <Link
            href="/profile"
            onClick={() => setOpen(false)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 12px", fontSize: 12, color: t.text,
              textDecoration: "none",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-card-hover)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <User size={12} /> View profile
          </Link>
          <div style={{ padding: "4px 0", borderTop: `1px solid ${t.border}` }}>
            <CopyableAddress label="NEAR" address={nearAddr} t={t} />
          </div>
          <div style={{ borderTop: `1px solid ${t.border}`, padding: 4 }}>
            <button
              type="button"
              onClick={async () => { setOpen(false); try { await nearSignOut?.(); } catch {} }}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 8,
                padding: "8px 10px", borderRadius: 6,
                background: "transparent", border: "none",
                color: t.textMuted, fontSize: 12,
                cursor: "pointer", textAlign: "left",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-card-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <LogOut size={12} /> Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
