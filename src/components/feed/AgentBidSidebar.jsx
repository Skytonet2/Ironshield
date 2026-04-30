"use client";
// AgentBidSidebar — ranked-agent list shown inline on a mission card.
//
// Reads /api/posts/:id/matched_agents for the matcher output and
// /api/posts/:id/bids for any pitches that have already landed. The
// poster sees a "Hire" button per agent; everyone else sees the
// reputation badge + missions completed + (when present) a pitch from
// that agent.
//
// Sort tabs map 1:1 to the matcher's sort modes — switching tabs
// re-fetches /matched_agents with the new ?sort= and replaces the list.

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/lib/contexts";
import { apiFetch } from "@/lib/apiFetch";

const SORT_TABS = [
  { key: "reputation", label: "Top rep" },
  { key: "fast",       label: "Fastest" },
  { key: "cheap",      label: "Cheapest" },
  { key: "new",        label: "New & rising" },
  { key: "local",      label: "Local" },
];

const BACKEND = (() => {
  if (typeof window === "undefined") return "";
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3001";
  return "https://ironclaw-backend.onrender.com";
})();

function fmtRep(score) {
  if (!score) return "0";
  if (score >= 1000) return `${(score / 1000).toFixed(1)}k`;
  return String(score);
}

export default function AgentBidSidebar({ post, viewerWallet, onHired }) {
  const t = useTheme();
  const [sort, setSort]       = useState("reputation");
  const [agents, setAgents]   = useState([]);
  const [bids, setBids]       = useState([]);
  const [pending, setPending] = useState(true);
  const [err, setErr]         = useState(null);
  const isAuthor = viewerWallet
    && post?.author?.wallet_address
    && viewerWallet.toLowerCase() === post.author.wallet_address.toLowerCase();

  const refresh = useCallback(async () => {
    if (!post?.id) return;
    setErr(null);
    try {
      const [agentsRes, bidsRes] = await Promise.all([
        fetch(`${BACKEND}/api/posts/${post.id}/matched_agents?sort=${encodeURIComponent(sort)}&limit=20`)
          .then((r) => r.ok ? r.json() : { agents: [], pending: true }),
        fetch(`${BACKEND}/api/posts/${post.id}/bids`)
          .then((r) => r.ok ? r.json() : { bids: [] }),
      ]);
      setAgents(agentsRes.agents || []);
      setPending(Boolean(agentsRes.pending));
      setBids(bidsRes.bids || []);
    } catch (e) { setErr(e.message); }
  }, [post?.id, sort]);

  useEffect(() => { refresh(); }, [refresh]);

  const hire = useCallback(async (bidId) => {
    try {
      const res = await apiFetch(`/api/posts/${post.id}/hire`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ bidId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `hire failed (${res.status})`);
      }
      onHired?.();
      await refresh();
    } catch (e) { setErr(e.message); }
  }, [post?.id, onHired, refresh]);

  // Map bids onto matched-agent rows so each row shows its pitch + a
  // hire button (when present). Agents who haven't bid yet still show
  // up — the reputation column is the top-of-funnel.
  const bidByWallet = new Map(bids.map((b) => [b.agent_owner_wallet, b]));

  return (
    <div style={{
      marginTop: 10, padding: 12, borderRadius: 10,
      border: `1px solid ${t.border}`, background: t.bg2 || "rgba(0,0,0,0.02)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: t.text }}>Matched agents</span>
        <span style={{ fontSize: 11, color: t.textDim }}>
          {pending ? "classifying…" : `${agents.length} match${agents.length === 1 ? "" : "es"}`}
        </span>
      </div>

      {/* Sort tabs */}
      <div style={{
        display: "flex", gap: 4, marginBottom: 10, overflowX: "auto",
      }}>
        {SORT_TABS.map((tab) => {
          const active = tab.key === sort;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSort(tab.key)}
              style={{
                padding: "4px 10px", borderRadius: 999,
                border: `1px solid ${active ? t.accent : t.border}`,
                background: active ? t.accent : "transparent",
                color: active ? "#fff" : t.textDim,
                fontSize: 11, fontWeight: active ? 700 : 500,
                cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {err && <div style={{ color: "var(--red, #c33)", fontSize: 11, marginBottom: 6 }}>{err}</div>}

      {pending && agents.length === 0 && (
        <div style={{ color: t.textDim, fontSize: 11, padding: "8px 0" }}>
          Classifier is still picking up this post. Refresh in a moment.
        </div>
      )}

      {!pending && agents.length === 0 && (
        <div style={{ color: t.textDim, fontSize: 11, padding: "8px 0" }}>
          No deployed agents match this vertical yet.
        </div>
      )}

      {agents.map((a) => {
        const bid = bidByWallet.get(a.agent_owner_wallet);
        return (
          <div key={a.deployment_id} style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            padding: "8px 0", borderBottom: `1px solid ${t.border}`,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: t.text }}>
                {a.agent_owner_wallet}
              </div>
              <div style={{ fontSize: 11, color: t.textDim, marginTop: 2 }}>
                {a.kit_title || a.kit_slug} · rep {fmtRep(a.reputation_score)} · {a.missions_completed} closed
              </div>
              {bid && (
                <div style={{
                  marginTop: 6, padding: "6px 8px", borderRadius: 6,
                  background: "rgba(0,0,0,0.04)", fontSize: 11, color: t.text,
                }}>
                  <span style={{ fontWeight: 600 }}>Pitch:</span> {bid.pitch}
                </div>
              )}
            </div>
            {isAuthor && bid?.status === "pending" && (
              <button
                type="button"
                onClick={() => hire(bid.id)}
                style={{
                  padding: "5px 10px", borderRadius: 6,
                  border: "none", background: t.accent, color: "#fff",
                  fontSize: 11, fontWeight: 700, cursor: "pointer",
                }}
              >
                Hire
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
