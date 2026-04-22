"use client";
// UserMenu — the top-nav avatar slot. Three display states:
//
//   1. Privy not configured     → disabled "Sign In" with a hint
//   2. Privy configured, logged out → "Sign In" button → opens Privy modal
//   3. Logged in                → avatar + dropdown (email, wallets, sign out)
//
// Kept deliberately small. Settings-page deep links and the seed-phrase
// reveal affordance land in Phase 6.

import { useState, useRef, useEffect } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { LogOut, Copy, Check } from "lucide-react";
import { useTheme } from "@/lib/contexts";
import { isPrivyConfigured } from "./PrivyWrapper";

function truncate(addr, left = 6, right = 4) {
  if (!addr) return "";
  return addr.length <= left + right ? addr : `${addr.slice(0, left)}…${addr.slice(-right)}`;
}

function CopyableAddress({ label, address, t }) {
  const [copied, setCopied] = useState(false);
  if (!address) return null;
  const onCopy = async (e) => {
    e.stopPropagation();
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

export default function UserMenu() {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on click-outside. Focus-based close would be nicer but
  // 12 lines of JS beats pulling in a Popover primitive.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Disabled-placeholder state when Privy isn't wired up yet.
  if (!isPrivyConfigured) {
    return (
      <button
        type="button"
        title="Set NEXT_PUBLIC_PRIVY_APP_ID to enable sign-in"
        disabled
        style={{
          height: 30,
          padding: "0 12px",
          borderRadius: 8,
          border: `1px solid ${t.border}`,
          background: "var(--bg-input)",
          color: t.textDim,
          fontSize: 12,
          cursor: "not-allowed",
        }}
      >
        Sign In
      </button>
    );
  }

  return <UserMenuInner t={t} open={open} setOpen={setOpen} refEl={ref} />;
}

// Split so the Privy hooks only instantiate when the provider is mounted.
// Calling usePrivy() without PrivyProvider throws at render time.
function UserMenuInner({ t, open, setOpen, refEl }) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();

  if (!ready) {
    return (
      <div style={{
        width: 30, height: 30, borderRadius: "50%",
        border: `1px solid ${t.border}`, background: "var(--bg-input)",
      }} aria-label="Loading auth" />
    );
  }

  if (!authenticated) {
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

  const evm = wallets.find((w) => w.chainType === "ethereum");
  const sol = wallets.find((w) => w.chainType === "solana");
  const email = user?.email?.address;
  const isCustodial = wallets.some((w) => w.walletClientType === "privy");

  return (
    <div ref={refEl} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 30,
          height: 30,
          borderRadius: "50%",
          border: `1px solid ${open ? t.accent : t.border}`,
          background: "var(--accent-dim)",
          color: t.accent,
          fontWeight: 700,
          fontSize: 12,
          cursor: "pointer",
        }}
        title={email || "Account"}
      >
        {(email || "?")[0].toUpperCase()}
      </button>
      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          right: 0,
          width: 260,
          background: "var(--bg-surface)",
          border: `1px solid ${t.border}`,
          borderRadius: 10,
          boxShadow: "0 10px 40px rgba(0,0,0,0.4), var(--accent-glow)",
          zIndex: 50,
          overflow: "hidden",
        }}>
          <div style={{
            padding: "10px 12px",
            borderBottom: `1px solid ${t.border}`,
          }}>
            <div style={{ fontSize: 12, color: t.text, fontWeight: 600 }}>
              {email || "Signed in"}
            </div>
            {isCustodial && (
              <div style={{
                fontSize: 10,
                color: t.accent,
                marginTop: 2,
                letterSpacing: 0.6,
                textTransform: "uppercase",
              }}>
                Embedded wallet · reveal seed in settings
              </div>
            )}
          </div>
          <div style={{ padding: "4px 0" }}>
            <CopyableAddress label="EVM / BNB" address={evm?.address} t={t} />
            <CopyableAddress label="SOL"       address={sol?.address} t={t} />
          </div>
          <div style={{ borderTop: `1px solid ${t.border}`, padding: 4 }}>
            <button
              type="button"
              onClick={() => { setOpen(false); logout(); }}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 6,
                background: "transparent",
                border: "none",
                color: t.textMuted,
                fontSize: 12,
                cursor: "pointer",
                textAlign: "left",
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
