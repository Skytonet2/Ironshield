"use client";
// Right-panel widget listing the coins / tokens the connected wallet
// has launched. Rendered alongside the feed in AppShell's rightPanel
// slot. Falls back to a CTA when the viewer hasn't deployed anything.

import { useEffect, useState } from "react";
import { useTheme, useWallet } from "@/lib/contexts";

const API = (() => {
  if (typeof window === "undefined") return "";
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3001";
  return "https://ironclaw-backend.onrender.com";
})();

export default function YourDeploysPanel() {
  const t = useTheme();
  const { address } = useWallet();
  const [coins, setCoins] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) { setCoins([]); return; }
    const ctl = new AbortController();
    setLoading(true);
    fetch(`${API}/api/newscoin/by-creator?creator=${encodeURIComponent(address)}`, {
      signal: ctl.signal,
    })
      .then(r => r.ok ? r.json() : { coins: [] })
      .then(j => setCoins(j.coins || []))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctl.abort();
  }, [address]);

  return (
    <div style={{ padding: 16 }}>
      <h3 style={{
        fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2,
        color: t.textDim, fontWeight: 600, margin: "0 0 12px",
      }}>
        Your Deploys
      </h3>

      {!address && (
        <EmptyCard t={t}>
          Connect a wallet to see the coins you've launched.
        </EmptyCard>
      )}

      {address && loading && coins.length === 0 && (
        <div style={{ fontSize: 12, color: t.textDim }}>Loading…</div>
      )}

      {address && !loading && coins.length === 0 && (
        <EmptyCard t={t}>
          You haven't launched a token yet. Hit{" "}
          <strong style={{ color: t.accent }}>Create</strong> to pick a
          chain + launchpad.
        </EmptyCard>
      )}

      {coins.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {coins.slice(0, 20).map((c) => (
            <a
              key={c.id || c.ticker}
              href={`/newscoin?token=${encodeURIComponent(c.ticker || c.id)}`}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 10px", borderRadius: 8,
                border: `1px solid ${t.border}`, background: "var(--bg-card)",
                textDecoration: "none", color: "inherit",
              }}
            >
              <div style={{
                width: 28, height: 28, borderRadius: 6,
                background: `linear-gradient(135deg, ${t.accent}, #0ea5e9)`,
                color: "#fff", display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 11, fontWeight: 700,
              }}>
                {(c.ticker || "?").slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 600, color: t.text,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {c.name || c.ticker}
                </div>
                <div style={{ fontSize: 11, color: t.textDim }}>
                  ${c.ticker || "?"} · {c.chain || "near"}
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyCard({ t, children }) {
  return (
    <div style={{
      fontSize: 12, color: t.textDim, lineHeight: 1.5,
      padding: 12, border: `1px dashed ${t.border}`, borderRadius: 8,
    }}>
      {children}
    </div>
  );
}
