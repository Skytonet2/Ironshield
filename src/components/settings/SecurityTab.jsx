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
import { Shield, Copy, Check, LogOut, RotateCcw, Key, AlertTriangle, Loader2 } from "lucide-react";
import { useExportWallet, useLogout, useWallets } from "@privy-io/react-auth";
import { useTheme, useWallet as useNearWalletCtx } from "@/lib/contexts";
import { useWallet as useWalletStore } from "@/lib/stores/walletStore";
import { isPrivyConfigured } from "@/components/auth/PrivyWrapper";
import {
  getOrCreateKeypair, exportPublicKey, rotateKeypair, getKeyHistory,
  walletDeriveChallenge, adoptWalletDerivedKeypair,
} from "@/lib/dmCrypto";
import { API_BASE as API } from "@/lib/apiBase";

// v1.1.3 — DM key management. Lists the wallet's current encryption
// key + rotation history (kept locally so old messages still decrypt
// after rotation), and exposes a Rotate button that mints a fresh key
// and publishes it to feed_users.dm_pubkey for peers to pick up.
//
// Rotation does NOT destroy old keys — they stay in localStorage so
// historical inbound messages still decrypt. Future messages from
// peers go to the new key. Old outbound bubbles stay readable too as
// long as the peer hasn't also rotated their published key.
function DMKeysSection({ nearAddr, t }) {
  const nearCtx = useNearWalletCtx();
  const [hist, setHist] = useState([]);
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [derivePending, setDerivePending] = useState(false);

  const refresh = () => setHist(getKeyHistory(nearAddr));
  useEffect(() => { refresh(); }, [nearAddr]);

  const onDeriveFromWallet = async () => {
    if (!nearAddr || derivePending) return;
    if (!nearCtx?.selector) {
      setErr("Wallet selector not available — connect your NEAR wallet first.");
      return;
    }
    setDerivePending(true); setErr("");
    try {
      const wallet = await nearCtx.selector.wallet();
      if (!wallet?.signMessage) throw new Error("Connected wallet doesn't support signMessage.");
      const challenge = walletDeriveChallenge(nearAddr);
      const signed = await wallet.signMessage(challenge);
      const kp = adoptWalletDerivedKeypair(nearAddr, signed);
      if (!kp) throw new Error("Couldn't derive a keypair from the signature.");
      const pub = exportPublicKey(kp);
      const r = await fetch(`${API}/api/profile/dm-pubkey`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": nearAddr },
        body: JSON.stringify({ pubkey: pub }),
      });
      if (!r.ok) throw new Error(`publish failed (${r.status})`);
      refresh();
    } catch (e) {
      setErr(e.message || "derivation failed");
    } finally {
      setDerivePending(false);
    }
  };

  const onRotate = async () => {
    if (!nearAddr || pending) return;
    setPending(true); setErr("");
    try {
      const kp = rotateKeypair(nearAddr);
      const pub = exportPublicKey(kp);
      // Publish to backend so peers fetching conversations see the
      // new pubkey. Failure here means rotation happened locally but
      // peers won't know — we surface the error so the user can retry.
      const r = await fetch(`${API}/api/profile/dm-pubkey`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": nearAddr },
        body: JSON.stringify({ pubkey: pub }),
      });
      if (!r.ok) throw new Error(`publish failed (${r.status})`);
      refresh();
      setConfirming(false);
    } catch (e) {
      setErr(e.message || "rotate failed");
    } finally {
      setPending(false);
    }
  };

  const current = hist[hist.length - 1];

  if (!nearAddr) return null;

  return (
    <div style={{
      marginTop: 18, padding: 14,
      borderRadius: 12,
      border: `1px solid ${t.border}`,
      background: "var(--bg-card)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Key size={14} style={{ color: t.accent }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>DM encryption keys</span>
      </div>
      <div style={{ fontSize: 11, color: t.textDim, lineHeight: 1.5, marginBottom: 12 }}>
        Used to end-to-end encrypt 1:1 messages. Rotating mints a fresh key and tells peers about it; old messages stay readable on this device because past keys are kept in browser storage.
      </div>

      {current ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{
            fontSize: 10, color: t.textDim, letterSpacing: 0.6,
            textTransform: "uppercase", marginBottom: 4,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <span>Current key fingerprint</span>
            {current.derived && (
              <span style={{
                padding: "1px 6px", borderRadius: 999,
                background: "rgba(168,85,247,0.15)",
                color: "#a855f7",
                fontSize: 9, fontWeight: 700, letterSpacing: 0.4,
                textTransform: "uppercase",
              }}>derived</span>
            )}
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 10px",
            borderRadius: 8,
            background: "var(--bg-input)",
            fontFamily: "var(--font-jetbrains-mono), monospace",
            fontSize: 12, color: t.text,
            wordBreak: "break-all",
          }}>
            <span style={{ flex: 1 }}>{current.fp}</span>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(current.fp);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1400);
                } catch {}
              }}
              title={copied ? "Copied" : "Copy fingerprint"}
              style={{
                padding: 4, borderRadius: 6, border: "none",
                background: "transparent",
                color: copied ? "var(--green)" : t.textMuted,
                cursor: "pointer",
              }}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: t.textDim, marginBottom: 12 }}>
          No key yet — open Messages once and your key will be generated.
        </div>
      )}

      {hist.length > 1 && (
        <div style={{ fontSize: 11, color: t.textDim, marginBottom: 10 }}>
          {hist.length - 1} past {hist.length === 2 ? "key" : "keys"} kept for decrypting older messages.
        </div>
      )}

      {!confirming ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={pending || derivePending}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "7px 12px",
              borderRadius: 8,
              border: `1px solid ${t.border}`,
              background: "var(--bg-input)",
              color: t.text,
              fontSize: 12, fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <RotateCcw size={12} /> Rotate DM key
          </button>
          {/* v1.1.9 — derive from wallet. Single signMessage popup
              gives the user a deterministic key that re-derives on any
              device with the same wallet. Hidden when the current key
              is already a derived one (no need to re-derive). */}
          {!hist.find((h) => h.derived) && (
            <button
              type="button"
              onClick={onDeriveFromWallet}
              disabled={pending || derivePending}
              title="Derive a new key from your wallet signature. Multi-device — same wallet on any device re-derives the same key."
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "7px 12px",
                borderRadius: 8,
                border: "1px solid rgba(168,85,247,0.4)",
                background: "rgba(168,85,247,0.08)",
                color: t.text,
                fontSize: 12, fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {derivePending ? <><Loader2 size={12} className="animate-spin" /> Signing…</> : <><Key size={12} /> Derive from wallet</>}
            </button>
          )}
        </div>
      ) : (
        <div style={{
          padding: 10,
          borderRadius: 8,
          background: "rgba(245,158,11,0.08)",
          border: "1px solid rgba(245,158,11,0.3)",
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <AlertTriangle size={14} style={{ color: "#f59e0b", flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 12, color: t.text, lineHeight: 1.5 }}>
              Rotating affects future messages only. Old conversations stay readable because the previous key is kept locally; clearing site data after a rotation erases everything for good.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={onRotate}
              disabled={pending}
              style={{
                padding: "6px 12px", borderRadius: 6, border: "none",
                background: t.accent, color: "#fff",
                fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}
            >
              {pending ? "Rotating…" : "Confirm rotate"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              style={{
                padding: "6px 12px", borderRadius: 6,
                border: `1px solid ${t.border}`,
                background: "transparent", color: t.text,
                fontSize: 12, cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {err && <div style={{ marginTop: 8, fontSize: 11, color: "#ef4444" }}>{err}</div>}
    </div>
  );
}

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
      <DMKeysSection nearAddr={nearCtx?.address} t={t} />
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
      <DMKeysSection nearAddr={nearCtx?.address} t={t} />
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
