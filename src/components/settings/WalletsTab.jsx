"use client";
// Wallets — lists every wallet connected to the current session across
// both providers (NEAR wallet-selector + Privy embedded/external).
// Lets the user see chains at a glance, copy addresses, and disconnect
// individual wallets. Full multi-account / switch-default support is a
// roadmap item — this pass surfaces what's there.

import { useState } from "react";
import { Copy, Check, Link2, ExternalLink, LogOut, Wallet } from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import { useWallet as useWalletStore } from "@/lib/stores/walletStore";
import { isPrivyConfigured } from "@/components/auth/PrivyWrapper";
import { tabCard, tabTitle, btn } from "./_shared";

function truncate(a, l = 6, r = 4) {
  if (!a) return "";
  return a.length <= l + r ? a : `${a.slice(0, l)}…${a.slice(-r)}`;
}

export default function WalletsTab() {
  const t = useTheme();
  const nearCtx = useWallet();
  const solStore = useWalletStore((s) => s.sol);
  const bnbStore = useWalletStore((s) => s.bnb);

  const connected = [
    nearCtx?.address && {
      chain: "NEAR",
      address: nearCtx.address,
      explorer: `https://nearblocks.io/address/${encodeURIComponent(nearCtx.address)}`,
      provider: "NEAR Wallet Selector",
      onDisconnect: () => nearCtx.signOut?.(),
    },
    solStore?.address && {
      chain: "Solana",
      address: solStore.address,
      explorer: `https://solscan.io/account/${solStore.address}`,
      provider: isPrivyConfigured ? "Privy" : "External",
      onDisconnect: null,
    },
    bnbStore?.address && {
      chain: "EVM",
      address: bnbStore.address,
      explorer: `https://etherscan.io/address/${bnbStore.address}`,
      provider: isPrivyConfigured ? "Privy" : "External",
      onDisconnect: null,
    },
  ].filter(Boolean);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={tabTitle(t)}>Wallets</h2>
        <p style={{ color: t.textDim, fontSize: 13, margin: "4px 0 0", lineHeight: 1.55 }}>
          Every wallet connected to this session. IronShield never sees your
          private keys — addresses live on the chain you connected with.
        </p>
      </div>

      {connected.length === 0 ? (
        <section style={{ ...tabCard(t), textAlign: "center", padding: 32 }}>
          <Wallet size={28} color={t.textDim} style={{ marginBottom: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: t.text, marginBottom: 6 }}>
            No wallets connected
          </div>
          <div style={{ fontSize: 12, color: t.textDim, marginBottom: 14 }}>
            Connect a wallet to see it listed here.
          </div>
          <button type="button" onClick={() => nearCtx?.showModal?.()} style={btn(t, true)}>
            Connect wallet
          </button>
        </section>
      ) : (
        <section style={tabCard(t)}>
          <div style={{ fontSize: 11, letterSpacing: 0.8, color: t.textDim, fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>
            Connected · {connected.length}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {connected.map((w) => (
              <WalletRow key={w.chain} wallet={w} t={t} />
            ))}
          </div>
        </section>
      )}

      <section style={tabCard(t)}>
        <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 6 }}>Add a wallet</div>
        <div style={{ fontSize: 12, color: t.textDim, lineHeight: 1.55, marginBottom: 12 }}>
          Use the top-right account menu to add another wallet. NEAR, Solana, and EVM chains are supported.
        </div>
        <button type="button" onClick={() => nearCtx?.showModal?.()} style={btn(t)}>
          <Link2 size={13} /> Open connect modal
        </button>
      </section>
    </div>
  );
}

function WalletRow({ wallet, t }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — silently ignore */ }
  };
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: 12, borderRadius: 10,
      border: `1px solid ${t.border}`,
      background: "var(--bg-input)",
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
        color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: 13, fontWeight: 800, flexShrink: 0,
      }}>
        {wallet.chain.slice(0, 2)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: t.textDim, fontWeight: 600 }}>
          {wallet.chain} · {wallet.provider}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.text, fontFamily: "var(--font-jetbrains-mono), monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {truncate(wallet.address)}
        </div>
      </div>
      <button type="button" onClick={onCopy} style={btn(t)} aria-label="Copy address">
        {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
      </button>
      <a
        href={wallet.explorer}
        target="_blank"
        rel="noreferrer"
        style={{ ...btn(t), textDecoration: "none" }}
        aria-label="Open in explorer"
      >
        <ExternalLink size={13} />
      </a>
      {wallet.onDisconnect && (
        <button type="button" onClick={wallet.onDisconnect} style={{ ...btn(t), color: "var(--red)" }}>
          <LogOut size={13} />
        </button>
      )}
    </div>
  );
}
