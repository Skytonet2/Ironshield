"use client";
// Disconnect Wallets — signs out of every wallet provider the user is
// connected to. Uses the same signOut path as the top-nav dropdown
// but surfaces a dedicated page with a clear consequence message.

import { useState } from "react";
import { LogOut, CheckCircle2, AlertTriangle } from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import { useWallet as useWalletStore } from "@/lib/stores/walletStore";
import { tabCard, tabTitle, btn } from "./_shared";

export default function DisconnectTab() {
  const t = useTheme();
  const nearCtx = useWallet();
  const disconnect = useWalletStore((s) => s.disconnect);
  const setCustodial = useWalletStore((s) => s.setCustodial);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const anyConnected = Boolean(
    nearCtx?.address
    || useWalletStore.getState().sol.address
    || useWalletStore.getState().bnb.address
  );

  const onDisconnect = async () => {
    if (!anyConnected) return;
    if (!window.confirm("Disconnect every connected wallet? You'll need to sign back in to post, tip, or vote.")) return;
    setBusy(true);
    try {
      if (nearCtx?.signOut) {
        try { await nearCtx.signOut(); } catch {}
      }
      try { disconnect(); setCustodial(false); } catch {}
      // Clear Privy's own token if present — their SDK usually does this
      // but belt-and-suspenders for shared devices.
      try {
        for (const k of Object.keys(localStorage)) {
          if (/^privy(-|:)/i.test(k)) localStorage.removeItem(k);
        }
      } catch {}
      setDone(true);
      setTimeout(() => setDone(false), 2200);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={tabTitle(t)}>Disconnect Wallets</h2>
        <p style={{ color: t.textDim, fontSize: 13, margin: "4px 0 0", lineHeight: 1.55 }}>
          Signs out of NEAR, Privy (EVM + Solana), and clears any cached session
          tokens from this device. Your on-chain assets aren't touched.
        </p>
      </div>

      <section style={{
        ...tabCard(t),
        borderColor: anyConnected ? "rgba(239,68,68,0.35)" : t.border,
        background: anyConnected
          ? "linear-gradient(180deg, rgba(239,68,68,0.05), transparent 60%), var(--bg-card)"
          : "var(--bg-card)",
      }}>
        {anyConnected ? (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <AlertTriangle size={16} color="var(--red)" style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontSize: 13, color: t.text, lineHeight: 1.55 }}>
                Disconnecting will end your session on this device across all chains. You'll need to sign in again to use posting, tipping, or governance voting.
              </div>
              <div style={{ marginTop: 14 }}>
                <button type="button" onClick={onDisconnect} disabled={busy} style={{ ...btn(t, true), background: "var(--red)", color: "#fff" }}>
                  {done ? <><CheckCircle2 size={13} /> Disconnected</> : busy ? "Disconnecting…" : <><LogOut size={13} /> Disconnect all wallets</>}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: t.textDim, textAlign: "center", padding: 14 }}>
            No wallets currently connected.
          </div>
        )}
      </section>
    </div>
  );
}
