"use client";
// Transactions — recent on-chain activity for the connected NEAR account.
// Backed by NEARBlocks' public indexer so we don't spin up our own
// indexer for a settings-tab surface. If the account hasn't been
// connected, the tab shows a connect CTA; if it has no activity,
// the tab shows the empty-state with a link to the explorer.

import { useEffect, useState } from "react";
import { ArrowUpRight, ArrowDownLeft, Clock, ExternalLink } from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import { tabCard, tabTitle, btn } from "./_shared";

function timeAgo(iso) {
  if (!iso) return "";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function TransactionsTab() {
  const t = useTheme();
  const { address, showModal } = useWallet();
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!address) return;
    const ctl = new AbortController();
    setLoading(true);
    setErr(null);
    // NEARBlocks free tier: 10 calls/min, no key needed. Keep the
    // window small and cap results so we don't hit that.
    fetch(`https://api.nearblocks.io/v1/account/${encodeURIComponent(address)}/txns?per_page=15`, {
      signal: ctl.signal,
    })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
      .then((j) => setTxs(Array.isArray(j?.txns) ? j.txns : []))
      .catch((e) => {
        if (e.name !== "AbortError") setErr("Couldn't reach NEARBlocks — try again in a moment.");
      })
      .finally(() => setLoading(false));
    return () => ctl.abort();
  }, [address]);

  if (!address) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 style={tabTitle(t)}>Transactions</h2>
        <section style={{ ...tabCard(t), textAlign: "center", padding: 28 }}>
          <Clock size={24} color={t.textDim} style={{ marginBottom: 10 }} />
          <div style={{ fontSize: 13, color: t.text, fontWeight: 600, marginBottom: 6 }}>
            Connect a wallet to see your recent transactions.
          </div>
          <button type="button" onClick={() => showModal?.()} style={btn(t, true)}>Connect wallet</button>
        </section>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={tabTitle(t)}>Transactions</h2>
        <p style={{ color: t.textDim, fontSize: 13, margin: "4px 0 0", lineHeight: 1.55 }}>
          Your 15 most recent on-chain transactions on NEAR, pulled from NEARBlocks.
        </p>
      </div>

      <section style={tabCard(t)}>
        {loading && <div style={{ fontSize: 13, color: t.textDim }}>Loading…</div>}
        {err && (
          <div style={{ fontSize: 13, color: "var(--red)" }}>{err}</div>
        )}
        {!loading && !err && txs.length === 0 && (
          <div style={{ fontSize: 13, color: t.textDim, textAlign: "center", padding: 20 }}>
            No recent transactions. Once you stake, tip, or bridge, they'll appear here.
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {txs.map((tx) => {
            const isOut = tx.signer_account_id === address;
            return (
              <a
                key={tx.transaction_hash}
                href={`https://nearblocks.io/txns/${tx.transaction_hash}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: 8,
                  border: `1px solid ${t.border}`, background: "var(--bg-input)",
                  textDecoration: "none", color: "inherit",
                }}
              >
                <div style={{
                  width: 30, height: 30, borderRadius: "50%",
                  background: isOut ? "rgba(239,68,68,0.15)" : "rgba(16,185,129,0.15)",
                  color: isOut ? "#ef4444" : "#10b981",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                }}>
                  {isOut ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 12, color: t.text, fontWeight: 600,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {isOut ? "To " : "From "}
                    <span style={{ fontFamily: "var(--font-jetbrains-mono), monospace" }}>
                      {isOut ? (tx.receiver_account_id || "—") : (tx.signer_account_id || "—")}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: t.textDim }}>
                    {tx.actions?.[0]?.action || "TX"} · {timeAgo(tx.block_timestamp_nanos ? new Date(tx.block_timestamp_nanos / 1e6).toISOString() : tx.block_timestamp)}
                  </div>
                </div>
                <ExternalLink size={12} color={t.textDim} />
              </a>
            );
          })}
        </div>
      </section>
    </div>
  );
}
