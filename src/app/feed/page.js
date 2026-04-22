"use client";
// /feed — IronFeed, the social surface for IronShield.
//
// Tabs: For You | Following | Alpha | News | IronClaw Alerts | Voices
// — plus a composer at the top and a Your Deploys panel in the right
// rail. Engagement (like / repost / tip / reply) posts back to the
// social endpoints and updates the local post in place so counters
// react without a refetch.

import { useEffect, useState, useCallback, useMemo } from "react";
import { useTheme, useWallet } from "@/lib/contexts";
import AppShell from "@/components/shell/AppShell";
import FeedCard from "@/components/feed/FeedCard";
import ComposeBar from "@/components/feed/ComposeBar";
import YourDeploysPanel from "@/components/feed/YourDeploysPanel";

const BACKEND_BASE = (() => {
  if (typeof window === "undefined") return "";
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3001";
  return "https://ironclaw-backend.onrender.com";
})();

const TABS = [
  { key: "foryou",          label: "For You",         endpoint: "/api/feed/foryou"          },
  { key: "following",       label: "Following",       endpoint: "/api/feed/following"       },
  { key: "voices",          label: "Voices",          endpoint: "/api/feed/voices"          },
  { key: "alpha",           label: "Alpha",           endpoint: "/api/feed/alpha"           },
  { key: "news",            label: "News",            endpoint: "/api/feed/news"            },
  { key: "ironclaw-alerts", label: "IronClaw Alerts", endpoint: "/api/feed/ironclaw-alerts" },
];

function useMutedSet(wallet) {
  const [muted, setMuted] = useState(new Set());
  const refresh = useCallback(async () => {
    if (!wallet) { setMuted(new Set()); return; }
    try {
      const res = await fetch(`${BACKEND_BASE}/api/feed/muted`, {
        headers: { "x-wallet": wallet },
      });
      if (!res.ok) return;
      const j = await res.json();
      setMuted(new Set((j.muted || []).map((m) => (m.username || "").toLowerCase())));
    } catch { /* keep prior set */ }
  }, [wallet]);
  useEffect(() => { refresh(); }, [refresh]);
  return [muted, refresh];
}

export default function FeedPage() {
  const t = useTheme();
  const walletCtx = useWallet();
  const wallet = walletCtx?.address || null;
  const [tab, setTab] = useState("foryou");
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [muted, refreshMuted] = useMutedSet(wallet);

  useEffect(() => {
    const target = TABS.find((x) => x.key === tab) || TABS[0];
    const ctl = new AbortController();
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        const res = await fetch(`${BACKEND_BASE}${target.endpoint}?limit=30`, {
          headers: wallet ? { "x-wallet": wallet } : {},
          signal: ctl.signal,
        });
        if (!res.ok) throw new Error(`${target.label} ${res.status}`);
        const j = await res.json();
        setPosts(j.posts || []);
      } catch (e) {
        if (e.name !== "AbortError") setErr(e.message);
      } finally {
        setLoading(false);
      }
    })();
    return () => ctl.abort();
  }, [tab, wallet]);

  const visible = useMemo(() => {
    if (muted.size === 0) return posts;
    return posts.filter((p) => {
      const u = p.author?.username?.toLowerCase();
      return !u || !muted.has(u);
    });
  }, [posts, muted]);

  const mute = useCallback(async (username) => {
    if (!wallet || !username) return;
    try {
      await fetch(`${BACKEND_BASE}/api/feed/mute`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": wallet },
        body: JSON.stringify({ targetUsername: username }),
      });
      refreshMuted();
    } catch { /* swallow */ }
  }, [wallet, refreshMuted]);

  // Optimistic updates — flip the like/repost flag and adjust the
  // counter client-side so the UI feels instant. If the API call
  // fails, revert.
  const patchPost = useCallback((id, patch) => {
    setPosts((prev) => prev.map((p) => p.id === id ? { ...p, ...patch } : p));
  }, []);

  const onLike = useCallback(async (post) => {
    if (!wallet) { walletCtx?.showModal?.(); return; }
    const next = !post.likedByMe;
    patchPost(post.id, {
      likedByMe: next,
      likes: Math.max(0, (post.likes || 0) + (next ? 1 : -1)),
    });
    try {
      await fetch(`${BACKEND_BASE}/api/social/like`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": wallet },
        body: JSON.stringify({ postId: post.id, on: next }),
      });
    } catch {
      patchPost(post.id, { likedByMe: post.likedByMe, likes: post.likes });
    }
  }, [wallet, patchPost, walletCtx]);

  const onRepost = useCallback(async (post) => {
    if (!wallet) { walletCtx?.showModal?.(); return; }
    const next = !post.repostedByMe;
    patchPost(post.id, {
      repostedByMe: next,
      reposts: Math.max(0, (post.reposts || 0) + (next ? 1 : -1)),
    });
    try {
      await fetch(`${BACKEND_BASE}/api/social/repost`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": wallet },
        body: JSON.stringify({ postId: post.id, on: next }),
      });
    } catch {
      patchPost(post.id, { repostedByMe: post.repostedByMe, reposts: post.reposts });
    }
  }, [wallet, patchPost, walletCtx]);

  const onReply = useCallback((post) => {
    // Prompt a top-level compose prefilled with the reply text; the
    // backend links the reply on submit via the replyTo field. Full
    // inline comment UI lands with the profile page in the next cut.
    const reply = typeof window !== "undefined" ? window.prompt(`Reply to @${post.author?.username || "user"}:`) : "";
    if (!reply || !wallet) return;
    fetch(`${BACKEND_BASE}/api/social/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-wallet": wallet },
      body: JSON.stringify({ postId: post.id, content: reply.slice(0, 500) }),
    }).then(() => {
      patchPost(post.id, { comments: (post.comments || 0) + 1 });
    }).catch(() => {});
  }, [wallet, patchPost]);

  const onTip = useCallback((post) => {
    // Tip modal lives in the legacy IronFeedPage; for the new shell we
    // deep-link there for now. A dedicated TipModal extraction is
    // tracked as a follow-up once all entry points use AppShell.
    if (typeof window !== "undefined") window.location.href = `/?tip=${post.id}`;
  }, []);

  const prependPost = useCallback((p) => {
    if (!p) return;
    setPosts((prev) => [p, ...prev]);
  }, []);

  return (
    <AppShell rightPanel={<YourDeploysPanel />}>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "12px 16px" }}>
        <ComposeBar onPosted={prependPost} />

        {/* Tab strip */}
        <div style={{
          display: "flex",
          gap: 2,
          borderBottom: `1px solid ${t.border}`,
          marginBottom: 12,
          overflowX: "auto",
        }}>
          {TABS.map((tb) => {
            const active = tb.key === tab;
            return (
              <button
                key={tb.key}
                type="button"
                onClick={() => setTab(tb.key)}
                style={{
                  padding: "10px 14px",
                  background: "transparent",
                  border: "none",
                  fontSize: 13,
                  fontWeight: active ? 700 : 500,
                  color: active ? t.text : t.textDim,
                  borderBottom: `2px solid ${active ? t.accent : "transparent"}`,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {tb.label}
              </button>
            );
          })}
        </div>

        {/* States */}
        {loading && posts.length === 0 && (
          <div style={{ padding: 24, color: t.textDim, fontSize: 12, textAlign: "center" }}>
            Loading…
          </div>
        )}
        {err && (
          <div style={{ padding: 24, color: "var(--red)", fontSize: 12, textAlign: "center" }}>
            {err}
          </div>
        )}
        {!loading && !err && visible.length === 0 && (
          <div style={{
            padding: 40, color: t.textDim, fontSize: 13, textAlign: "center",
            border: `1px dashed ${t.border}`, borderRadius: 10,
          }}>
            {tab === "following" && !wallet
              ? "Connect a wallet to see your Following feed."
              : tab === "voices"
              ? "No Voice posts yet. Tap the Voice toggle in the composer to add one."
              : tab === "ironclaw-alerts"
              ? "No active alerts."
              : tab === "news"
              ? "Newsbot hasn't ingested anything yet. Come back in a minute."
              : "Nothing here yet."}
          </div>
        )}

        {/* Feed */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {visible.map((p) => (
            <FeedCard
              key={p.id}
              post={p}
              viewer={walletCtx}
              isOwn={wallet && p.author?.wallet_address?.toLowerCase() === wallet.toLowerCase()}
              onMute={mute}
              onLike={()   => onLike(p)}
              onRepost={() => onRepost(p)}
              onTip={()    => onTip(p)}
              onReply={()  => onReply(p)}
            />
          ))}
        </div>
      </div>
    </AppShell>
  );
}
