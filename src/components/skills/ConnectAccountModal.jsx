"use client";
// ConnectAccountModal — dialog shown when an unauthenticated user clicks
// the "Sign in" chip in SkillsShell's top nav. Offers four sign-in
// paths matching the approved mock.
//
// Connect behaviour (implemented here vs. left for the functionality PR):
//   • NEAR Wallet → delegates to useWallet().showModal() right now, so
//     the existing wallet-selector modal opens (Meteor / HERE / HOT /
//     Intear are the selector's built-in options).
//   • Google Sign-In, EVM Wallet, Solana Wallet → no-op that marks the
//     row as "Coming soon" in a subtle aside. Real adapters land in the
//     functionality PR (Privy for Google, wagmi for EVM, @solana/wallet-
//     adapter for Solana).
//
// Keyboard: Escape closes. Focus is NOT managed yet — a follow-up can
// add focus-trap once the real auth flows ship.

import { useCallback, useEffect } from "react";
import {
  X as XIcon, ChevronRight, Lock, Shield, Globe,
} from "lucide-react";
import { useTheme } from "@/lib/contexts";

const OPTIONS = [
  {
    key: "near",
    label: "NEAR Wallet",
    subtitle: "Meteor • HERE • HOT • Intear",
    recommended: true,
    // NEAR glyph — white "N" on a black tile; stays on-brand without
    // pulling in a heavy logo file.
    renderIcon: () => (
      <span aria-hidden style={{
        width: 42, height: 42, borderRadius: 10,
        background: "#0f0f17",
        border: "1px solid rgba(255,255,255,0.12)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontWeight: 800, fontSize: 20, color: "#fff",
        letterSpacing: -1,
      }}>
        N
      </span>
    ),
  },
  {
    key: "google",
    label: "Google Sign-In",
    subtitle: "Use your Google account",
    renderIcon: () => (
      <span aria-hidden style={{
        width: 42, height: 42, borderRadius: 10,
        background: "#fff",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontWeight: 800, fontSize: 22,
        fontFamily: "'Product Sans', 'Google Sans', sans-serif",
        color: "#4285F4",
      }}>
        G
      </span>
    ),
  },
  {
    key: "evm",
    label: "EVM Wallet",
    subtitle: "MetaMask • Injected wallet",
    renderIcon: () => (
      <span aria-hidden style={{
        width: 42, height: 42, borderRadius: 10,
        background: "#ffe7c6",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 22,
      }}>
        🦊
      </span>
    ),
  },
  {
    key: "solana",
    label: "Solana Wallet",
    subtitle: "Phantom • Injected wallet",
    renderIcon: () => (
      <span aria-hidden style={{
        width: 42, height: 42, borderRadius: 10,
        background: "linear-gradient(135deg, #9945FF 0%, #14F195 100%)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 20, fontWeight: 800,
        color: "#fff", letterSpacing: -1,
      }}>
        S
      </span>
    ),
  },
];

export default function ConnectAccountModal({ open, onClose, onPickNear }) {
  const t = useTheme();

  // Escape-to-close. Registered lazily so the listener only exists while
  // the modal is open — avoids a permanent window-level handler.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const onPick = useCallback((key) => {
    if (key === "near") {
      onPickNear?.();
      onClose?.();
      return;
    }
    // Soft-disabled until the functionality PR wires the adapter. A
    // stub alert keeps the UI honest rather than faking success.
    alert(`${key.toUpperCase()} sign-in is coming soon.`);
  }, [onPickNear, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ca-title"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 80,
        background: "rgba(4, 6, 14, 0.72)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px 16px",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        animation: "ca-fade 140ms ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="ca-card"
        style={{
          position: "relative",
          width: "100%", maxWidth: 520,
          background: "linear-gradient(180deg, #0f1424 0%, #0b1020 100%)",
          border: `1px solid ${t.border}`,
          borderRadius: 20,
          padding: "28px 28px 24px",
          boxShadow: "0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(168,85,247,0.12)",
          animation: "ca-pop 160ms cubic-bezier(0.34, 1.56, 0.64, 1)",
          maxHeight: "calc(100vh - 48px)",
          overflowY: "auto",
        }}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          style={{
            position: "absolute", top: 16, right: 16,
            width: 34, height: 34, borderRadius: "50%",
            background: "rgba(255,255,255,0.05)",
            border: `1px solid ${t.border}`,
            color: t.textMuted,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <XIcon size={15} />
        </button>

        <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 22 }}>
          <span aria-hidden style={{
            width: 52, height: 52, flexShrink: 0, borderRadius: 14,
            background: `linear-gradient(135deg, rgba(168,85,247,0.4), rgba(59,130,246,0.25))`,
            border: `1px solid rgba(168,85,247,0.35)`,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            color: "#c4b8ff",
            boxShadow: "0 6px 24px rgba(168,85,247,0.35)",
          }}>
            <Lock size={20} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h2 id="ca-title" style={{
              fontSize: 22, fontWeight: 800, color: t.white, margin: 0,
              letterSpacing: -0.4,
            }}>
              Connect account
            </h2>
            <p style={{ fontSize: 13, color: t.textMuted, margin: "4px 0 0" }}>
              Choose how you want to sign in to{" "}
              <span style={{
                background: "linear-gradient(90deg, #60a5fa, #a855f7)",
                WebkitBackgroundClip: "text", backgroundClip: "text",
                WebkitTextFillColor: "transparent", color: "transparent",
                fontWeight: 700,
              }}>
                IronShield Skills
              </span>.
            </p>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {OPTIONS.map(opt => (
            <OptionRow key={opt.key} opt={opt} onPick={onPick} t={t} />
          ))}
        </div>

        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          margin: "18px 0 16px",
        }}>
          <span style={{ flex: 1, height: 1, background: t.border }} />
          <span style={{ fontSize: 11.5, color: t.textDim, fontStyle: "italic" }}>
            More options coming soon
          </span>
          <span style={{ flex: 1, height: 1, background: t.border }} />
        </div>

        <div className="ca-footer" style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "14px 14px",
          background: "rgba(255,255,255,0.03)",
          border: `1px solid ${t.border}`,
          borderRadius: 12,
        }}>
          <span aria-hidden style={{
            width: 32, height: 32, flexShrink: 0, borderRadius: 10,
            background: "rgba(168,85,247,0.18)",
            color: "#c4b8ff",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
          }}>
            <Shield size={14} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: t.white }}>
              Your privacy matters
            </div>
            <div style={{ fontSize: 11.5, color: t.textMuted, marginTop: 2 }}>
              We never store your private keys or access your funds.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "9px 18px",
              background: "transparent",
              border: `1px solid ${t.border}`,
              borderRadius: 10,
              fontSize: 12.5, fontWeight: 700, color: t.text,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      </div>

      <style jsx global>{`
        @keyframes ca-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes ca-pop {
          from { opacity: 0; transform: translateY(10px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)    scale(1);    }
        }
        @media (max-width: 520px) {
          .ca-card { padding: 22px 18px 18px !important; }
          .ca-footer { flex-wrap: wrap; }
          .ca-footer > button { margin-left: auto; }
        }
      `}</style>
    </div>
  );
}

function OptionRow({ opt, onPick, t }) {
  return (
    <button
      type="button"
      onClick={() => onPick(opt.key)}
      style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "14px 16px",
        width: "100%",
        background: "rgba(255,255,255,0.025)",
        border: `1px solid ${opt.recommended ? "rgba(168,85,247,0.5)" : t.border}`,
        borderRadius: 14,
        cursor: "pointer", textAlign: "left",
        transition: "background 120ms ease, border-color 120ms ease, transform 120ms ease",
        boxShadow: opt.recommended ? "0 0 0 1px rgba(168,85,247,0.22) inset" : "none",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.06)";
        e.currentTarget.style.borderColor = "rgba(168,85,247,0.55)";
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.025)";
        e.currentTarget.style.borderColor = opt.recommended ? "rgba(168,85,247,0.5)" : t.border;
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {opt.renderIcon()}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          fontSize: 15, fontWeight: 800, color: t.white,
        }}>
          {opt.label}
          {opt.recommended && (
            <span style={{
              fontSize: 10.5, fontWeight: 700, padding: "2px 10px", borderRadius: 999,
              background: "rgba(168,85,247,0.22)", color: "#c4b8ff",
            }}>
              Recommended
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>
          {opt.subtitle}
        </div>
      </div>
      <ChevronRight size={15} color={t.textDim} style={{ flexShrink: 0 }} />
    </button>
  );
}
