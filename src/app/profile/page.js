"use client";
// /profile — the current user's profile. Four tabs:
//   Posts · Reposts · Likes · Deployed
//
// Accepts ?address=<wallet> to view a different user's profile. When
// empty, shows the connected wallet. When no wallet is connected at
// all, prompts for connect.

import { useEffect, useState, useCallback, useMemo } from "react";
import { useTheme, useWallet } from "@/lib/contexts";
import AppShell from "@/components/shell/AppShell";
import FeedCard from "@/components/feed/FeedCard";
import YourDeploysPanel from "@/components/feed/YourDeploysPanel";
import { Coins } from "lucide-react";

const BACKEND_BASE = (() => {
  if (typeof window === "undefined") return "";
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3001";
  return "https://ironclaw-backend.onrender.com";
})();

const TABS = [
  { key: "posts",    label: "Posts",    endpoint: (a) => `/api/users/${encodeURIComponent(a)}/posts` },
  { key: "reposts",  label: "Reposts",  endpoint: (a) => `/api/users/${encodeURIComponent(a)}/reposts` },
  { key: "likes",    label: "Likes",    endpoint: (a) => `/api/users/${encodeURIComponent(a)}/likes` },
  { key: "deployed", label: "Deployed", endpoint: null },
];

export default function ProfilePage() {
  const t = useTheme();
  const { address: viewerAddress, showModal } = useWallet();

  const [targetAddress, setTargetAddress] = useState(viewerAddress || null);
  useEffect(() => {
    try {
      const q = new URLSearchParams(location.search).get("address");
      if (q) setTargetAddress(q);
      else if (viewerAddress) setTargetAddress(viewerAddress);
    } catch {}
  }, [viewerAddress]);

  const [tab, setTab] = useState("posts");
  const [posts, setPosts] = useState([]);
  const [profile, setProfile] = useState(null);
  const [deploys, setDeploys] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!targetAddress) return;
    const ctl = new AbortController();
    fetch(`${BACKEND_BASE}/api/users/${encodeURIComponent(targetAddress)}`, { signal: ctl.signal })
      .then(r => r.ok ? r.json() : null)
      .then(j => setProfile(j?.user || null))
      .catch(() => {});
    return () => ctl.abort();
  }, [targetAddress]);

  useEffect(() => {
    if (!targetAddress) return;
    const target = TABS.find((x) => x.key === tab);
    if (tab === "deployed") {
      const ctl = new AbortController();
      setLoading(true);
      fetch(`${BACKEND_BASE}/api/newscoin/by-creator?creator=${encodeURIComponent(targetAddress)}`, { signal: ctl.signal })
        .then(r => r.ok ? r.json() : { coins: [] })
        .then(j => setDeploys(j.coins || []))
        .catch(() => {})
        .finally(() => setLoading(false));
      return () => ctl.abort();
    }
    if (!target?.endpoint) return;
    const ctl = new AbortController();
    setLoading(true);
    fetch(`${BACKEND_BASE}${target.endpoint(targetAddress)}?limit=30`, {
      headers: viewerAddress ? { "x-wallet": viewerAddress } : {},
      signal: ctl.signal,
    })
      .then(r => r.ok ? r.json() : { posts: [] })
      .then(j => setPosts(j.posts || []))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctl.abort();
  }, [targetAddress, tab, viewerAddress]);

  const short = useMemo(() => {
    if (!targetAddress) return null;
    return targetAddress.length > 14
      ? `${targetAddress.slice(0, 6)}…${targetAddress.slice(-4)}`
      : targetAddress;
  }, [targetAddress]);

  if (!targetAddress) {
    return (
      <AppShell>
        <div style={{
          maxWidth: 520, margin: "80px auto", padding: 24,
          border: `1px dashed ${t.border}`, borderRadius: 12,
          textAlign: "center", color: t.textMuted,
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: t.text, marginBottom: 6 }}>
            No wallet connected
          </div>
          <div style={{ fontSize: 13, marginBottom: 14 }}>
            Connect to see your profile — posts, reposts, likes, and tokens you've deployed.
          </div>
          <button
            type="button"
            onClick={() => showModal?.()}
            style={{
              padding: "8px 16px", borderRadius: 8, border: "none",
              background: t.accent, color: "#fff", fontWeight: 700, cursor: "pointer",
            }}
          >
            Connect wallet
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell rightPanel={<YourDeploysPanel />}>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "12px 16px" }}>
        {/* Header */}
        <div style={{
          padding: "14px 0", borderBottom: `1px solid ${t.border}`, marginBottom: 12,
          display: "flex", alignItems: "center", gap: 14,
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: "50%",
            background: `linear-gradient(135deg, ${t.accent}, #0ea5e9)`,
            color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22, fontWeight: 800,
          }}>
            {profile?.pfp_url ? (
              <img src={profile.pfp_url} alt="" width={56} height={56} style={{ borderRadius: "50%", objectFit: "cover" }} />
            ) : (
              (profile?.display_name || targetAddress || "?")[0]?.toUpperCase()
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: t.white }}>
              {profile?.display_name || short}
            </div>
            <div style={{ fontSize: 12, color: t.textDim }}>
              @{profile?.username || short} · {profile?.followers || 0} followers
            </div>
            {profile?.bio && (
              <div style={{ fontSize: 13, color: t.textMuted, marginTop: 6 }}>
                {profile.bio}
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex", gap: 2, borderBottom: `1px solid ${t.border}`, marginBottom: 12,
          overflowX: "auto",
        }}>
          {TABS.map((x) => {
            const active = x.key === tab;
            return (
              <button
                key={x.key}
                type="button"
                onClick={() => setTab(x.key)}
                style={{
                  padding: "10px 14px", background: "transparent", border: "none",
                  fontSize: 13, fontWeight: active ? 700 : 500,
                  color: active ? t.text : t.textDim,
                  borderBottom: `2px solid ${active ? t.accent : "transparent"}`,
                  cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                {x.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        {loading && (
          <div style={{ padding: 24, color: t.textDim, fontSize: 12, textAlign: "center" }}>Loading…</div>
        )}

        {!loading && tab !== "deployed" && posts.length === 0 && (
          <div style={{
            padding: 40, color: t.textDim, fontSize: 13, textAlign: "center",
            border: `1px dashed ${t.border}`, borderRadius: 10,
          }}>
            Nothing here yet.
          </div>
        )}

        {!loading && tab !== "deployed" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {posts.map((p) => (
              <FeedCard key={p.id} post={p} viewer={{ wallet_address: viewerAddress }} />
            ))}
          </div>
        )}

        {!loading && tab === "deployed" && (
          deploys.length === 0 ? (
            <div style={{
              padding: 40, color: t.textDim, fontSize: 13, textAlign: "center",
              border: `1px dashed ${t.border}`, borderRadius: 10,
            }}>
              No coins deployed yet.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
              {deploys.map((c) => (
                <a
                  key={c.id || c.ticker}
                  href={`/newscoin?token=${encodeURIComponent(c.ticker || c.id)}`}
                  style={{
                    display: "block", padding: 12, borderRadius: 10,
                    border: `1px solid ${t.border}`, background: "var(--bg-card)",
                    textDecoration: "none", color: "inherit",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <Coins size={14} color={t.accent} />
                    <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>
                      {c.name || c.ticker}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: t.textDim }}>
                    ${c.ticker || "?"} · {c.chain || "near"}
                  </div>
                </a>
              ))}
            </div>
          )
        )}
      </div>
    </AppShell>
  );
}
