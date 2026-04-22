"use client";
// SecurityTab — spec §9C. Connected wallet list (NEAR + Privy-embedded
// SOL/EVM) + seed-phrase reveal for custodial wallets.
//
// Privy handles the actual key material — we never see it. useExportWallet()
// opens Privy's own secure modal that shows the seed phrase after a fresh
// authentication challenge. That's safer than rolling our own reveal:
// Privy's modal clears after close, doesn't render into our DOM tree,
// and enforces the re-auth step upstream.

import { useEffect, useState } from "react";
import { Shield, Copy, Check, LogOut } from "lucide-react";
import { useExportWallet, useLogout, useWallets } from "@privy-io/react-auth";
import { useTheme, useWallet as useNearWalletCtx } from "@/lib/contexts";
import { useWallet as useWalletStore } from "@/lib/stores/walletStore";
import { isPrivyConfigured } from "@/components/auth/PrivyWrapper";

function truncate(addr, left = 8, right = 6) {
  if (!addr) return "";
  return addr.length <= left + right ? addr : `${addr.slice(0, left)}…${addr.slice(-right)}`;
}

function CopyBtn({ value, t }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch { /* clipboard blocked */ }
      }}
      title={copied ? "Copied" : "Copy"}
      style={{
        padding: 6, borderRadius: 6, border: "none",
        background: "transparent",
        color: copied ? "var(--green)" : t.textMuted,
        cursor: "pointer",
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

function WalletRow({ chain, label, address, badges = [], onAction, actionLabel, actionIcon: Icon, t }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "12px 14px",
      borderBottom: `1px solid ${t.border}`,
    }}>
      <div style={{
        width: 34, height: 34, flexShrink: 0,
        borderRadius: 8,
        background: "var(--accent-dim)",
        color: t.accent,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 700, fontSize: 13,
        textTransform: "uppercase",
      }}>
        {chain.slice(0, 3)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: t.white, fontWeight: 600, fontSize: 13 }}>{label}</span>
          {badges.map((b) => (
            <span key={b} style={{
              fontSize: 9,
              padding: "1px 6px",
              borderRadius: 4,
              background: "var(--accent-dim)",
              color: t.accent,
              letterSpacing: 0.6,
              textTransform: "uppercase",
            }}>
              {b}
            </span>
          ))}
        </div>
        {address ? (
          <div style={{
            fontSize: 11,
            color: t.textMuted,
            marginTop: 2,
            fontFamily: "var(--font-jetbrains-mono), monospace",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}>
            {truncate(address, 10, 8)}
            <CopyBtn value={address} t={t} />
          </div>
        ) : (
          <div style={{ fontSize: 11, color: t.textDim, marginTop: 2 }}>
            Not connected
          </div>
        )}
      </div>
      {address && onAction && (
        <button
          type="button"
          onClick={onAction}
          style={{
            padding: "6px 12px",
            borderRadius: 8,
            border: `1px solid ${t.border}`,
            background: "var(--bg-input)",
            color: t.textMuted,
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            textTransform: "uppercase",
            letterSpacing: 0.6,
          }}
        >
          {Icon && <Icon size={12} />}
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export default function SecurityTab() {
  const t = useTheme();
  const nearCtx = useNearWalletCtx();
  const sol = useWalletStore((s) => s.sol);
  const bnb = useWalletStore((s) => s.bnb);
  const isCustodial = useWalletStore((s) => s.isCustodial);

  if (!isPrivyConfigured) {
    return <SecurityNoPrivy nearCtx={nearCtx} t={t} />;
  }
  return <SecurityWithPrivy nearCtx={nearCtx} sol={sol} bnb={bnb} isCustodial={isCustodial} t={t} />;
}

// Split mirrors PrivyWrapper's pattern — calls to Privy hooks only
// happen inside the component that renders when Privy is configured,
// so the app still boots without the provider.
function SecurityNoPrivy({ nearCtx, t }) {
  return (
    <ShellHeader t={t}>
      <div style={{
        padding: "14px 16px",
        border: `1px solid ${t.border}`,
        borderRadius: 12,
        background: "var(--bg-card)",
        marginBottom: 10,
      }}>
        <WalletRow
          chain="NEAR"
          label={nearCtx?.address || "NEAR"}
          address={nearCtx?.address}
          badges={nearCtx?.walletType ? [nearCtx.walletType] : []}
          onAction={nearCtx?.signOut}
          actionLabel="Disconnect"
          actionIcon={LogOut}
          t={t}
        />
      </div>
      <div style={{ fontSize: 11, color: t.textDim, padding: "4px 4px" }}>
        Set NEXT_PUBLIC_PRIVY_APP_ID to enable embedded Solana + EVM wallets with seed-phrase reveal.
      </div>
    </ShellHeader>
  );
}

function SecurityWithPrivy({ nearCtx, sol, bnb, isCustodial, t }) {
  const { exportWallet } = useExportWallet();
  const { logout } = useLogout();
  const { wallets: privyWallets } = useWallets();

  const evmWallet = privyWallets.find((w) => w.chainType === "ethereum");
  const solWallet = privyWallets.find((w) => w.chainType === "solana");

  const exportFor = (wallet) => {
    if (!wallet) return () => {};
    return () => exportWallet({ address: wallet.address }).catch(() => {
      // User cancelled — no-op. Privy's modal handles its own errors.
    });
  };

  return (
    <ShellHeader t={t}>
      {isCustodial && (
        <div style={{
          marginBottom: 14,
          padding: "12px 14px",
          borderRadius: 10,
          background: "var(--bg-input)",
          border: `1px solid ${t.border}`,
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
        }}>
          <Shield size={16} style={{ color: t.accent, flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 11, color: t.textMuted, lineHeight: 1.55 }}>
            <strong style={{ color: t.white, display: "block", marginBottom: 2 }}>
              Back up your seed phrase.
            </strong>
            You're signed in with an embedded wallet. Anyone with the seed phrase
            can access your funds. Keep it offline, don't paste it into chat, and
            don't take a screenshot of it. Privy's reveal opens in its own window
            and clears on close — we never see it.
          </div>
        </div>
      )}

      <div style={{
        border: `1px solid ${t.border}`,
        borderRadius: 12,
        background: "var(--bg-card)",
        overflow: "hidden",
        marginBottom: 14,
      }}>
        <div style={{
          padding: "10px 14px",
          fontSize: 11, letterSpacing: 0.8,
          color: t.textDim,
          textTransform: "uppercase",
          borderBottom: `1px solid ${t.border}`,
        }}>
          Connected wallets
        </div>
        <WalletRow
          chain="NEAR"
          label={nearCtx?.address || "NEAR wallet"}
          address={nearCtx?.address}
          badges={nearCtx?.walletType ? [nearCtx.walletType] : []}
          onAction={nearCtx?.address ? nearCtx.signOut : null}
          actionLabel="Disconnect"
          actionIcon={LogOut}
          t={t}
        />
        <WalletRow
          chain="SOL"
          label="Solana"
          address={solWallet?.address}
          badges={solWallet?.walletClientType === "privy" ? ["Embedded"] : solWallet ? ["External"] : []}
          onAction={solWallet?.walletClientType === "privy" ? exportFor(solWallet) : null}
          actionLabel="Reveal Seed"
          actionIcon={Shield}
          t={t}
        />
        <WalletRow
          chain="EVM"
          label="Ethereum / EVM"
          address={evmWallet?.address}
          badges={evmWallet?.walletClientType === "privy" ? ["Embedded"] : evmWallet ? ["External"] : []}
          onAction={evmWallet?.walletClientType === "privy" ? exportFor(evmWallet) : null}
          actionLabel="Reveal Seed"
          actionIcon={Shield}
          t={t}
        />
      </div>

      {isCustodial && (
        <button
          type="button"
          onClick={() => logout()}
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            border: `1px solid ${t.border}`,
            background: "var(--bg-input)",
            color: t.textMuted,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <LogOut size={13} /> Sign out of Privy
        </button>
      )}
    </ShellHeader>
  );
}

function ShellHeader({ children, t }) {
  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: t.white }}>
        Security
      </h1>
      <p style={{ margin: "4px 0 18px", fontSize: 12, color: t.textMuted }}>
        Manage connected wallets and reveal your embedded-wallet seed phrase.
      </p>
      {children}
    </div>
  );
}
