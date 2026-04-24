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
import FeedRightRail from "@/components/feed/FeedRightRail";
import ReferrerFollowPrompt from "@/components/feed/ReferrerFollowPrompt";
import { m, feedContainerVariants, feedCardVariants } from "@/lib/motion";
import { TipModal } from "@/components/TipModal";

const BACKEND_BASE = (() => {
  if (typeof window === "undefined") return "";
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3001";
  return "https://ironclaw-backend.onrender.com";
})();

// Read Voices preferences from localStorage and serialize them into
// the query-string format the /api/feed/voices endpoint accepts. When
// the user hasn't set any prefs yet (returns DEFAULTS from VoicesTab),
// only the enabled categories go on the wire — empty = all categories
// on the backend side.
function voicesQuery() {
  if (typeof window === "undefined") return "";
  try {
    const v = JSON.parse(localStorage.getItem("ironshield:voices-prefs") || "null");
    if (!v) return "";
    const cats = v.categories || {};
    const enabled = Object.keys(cats).filter((k) => cats[k]);
    const parts = [];
    // Always attach `categories=` (even empty) so users can explicitly
    // opt out of all preset categories and only pull their customs.
    parts.push(`categories=${encodeURIComponent(enabled.join(","))}`);
    if (Array.isArray(v.customHandles) && v.customHandles.length) {
      parts.push(`handles=${encodeURIComponent(v.customHandles.join(","))}`);
    }
    return parts.join("&");
  } catch { return ""; }
}

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
  // Initial tab is read from ?tab= so the sidebar Feed-section
  // shortcuts deep-link correctly (/feed?tab=voices etc). Subsequent
  // sidebar picks fire an ironshield:feed-tab event which this page
  // listens for — no remount when the tab changes from the sidebar.
  const [tab, setTab] = useState(() => {
    if (typeof window === "undefined") return "foryou";
    try {
      const q = new URLSearchParams(window.location.search).get("tab");
      return TABS.some((t) => t.key === q) ? q : "foryou";
    } catch { return "foryou"; }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onTab = (e) => { if (e.detail && TABS.some((t) => t.key === e.detail)) setTab(e.detail); };
    window.addEventListener("ironshield:feed-tab", onTab);
    return () => window.removeEventListener("ironshield:feed-tab", onTab);
  }, []);
  // When the tab strip (on-page) changes, mirror to the sidebar by
  // broadcasting. Keeps the two in lockstep.
  const setTabAndNotify = useCallback((next) => {
    setTab(next);
    if (typeof window !== "undefined") {
      try { window.history.replaceState(null, "", `/feed?tab=${encodeURIComponent(next)}`); } catch {}
      window.dispatchEvent(new CustomEvent("ironshield:feed-tab", { detail: next }));
    }
  }, []);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  // Voices-tab upstream status — "ok" | "not_configured" | "upstream_down".
  // Used to render a small "Voices temporarily unavailable" banner so
  // users with no tweets don't stare at an empty feed wondering what
  // broke. Only set when viewing the voices tab.
  const [voicesStatus, setVoicesStatus] = useState("ok");
  const [muted, refreshMuted] = useMutedSet(wallet);

  useEffect(() => {
    const target = TABS.find((x) => x.key === tab) || TABS[0];
    const ctl = new AbortController();
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        // For the default For You feed, blend in recent Voices posts
        // so users see influencer takes + native voice posts alongside
        // regular posts — without having to switch tabs. On every other
        // tab we just render that tab's endpoint.
        if (tab === "foryou") {
          const [fy, vc] = await Promise.all([
            fetch(`${BACKEND_BASE}${target.endpoint}?limit=30`, {
              headers: wallet ? { "x-wallet": wallet } : {},
              signal: ctl.signal,
            }).then(r => r.ok ? r.json() : { posts: [] }).catch(() => ({ posts: [] })),
            fetch(`${BACKEND_BASE}/api/feed/voices?limit=15${voicesQuery() ? `&${voicesQuery()}` : ""}`, {
              headers: wallet ? { "x-wallet": wallet } : {},
              signal: ctl.signal,
            }).then(r => r.ok ? r.json() : { posts: [] }).catch(() => ({ posts: [] })),
          ]);
          // Dedupe on id, then sort by createdAt. Voices from Nitter use
          // string ids like "x:1234" so they won't collide with native
          // numeric ids — the Map handles both.
          const byId = new Map();
          for (const p of [...(fy.posts || []), ...(vc.posts || [])]) {
            if (p?.id != null) byId.set(p.id, p);
          }
          const merged = Array.from(byId.values()).sort((a, b) => {
            const ta = new Date(a.createdAt || a.created_at || 0).getTime();
            const tb = new Date(b.createdAt || b.created_at || 0).getTime();
            return tb - ta;
          });
          setPosts(merged);
        } else {
          // Voices tab: append the user's category/handle prefs so the
          // endpoint returns only the mix they configured in Settings.
          const extra = tab === "voices" && voicesQuery() ? `&${voicesQuery()}` : "";
          const res = await fetch(`${BACKEND_BASE}${target.endpoint}?limit=30${extra}`, {
            headers: wallet ? { "x-wallet": wallet } : {},
            signal: ctl.signal,
          });
          if (!res.ok) throw new Error(`${target.label} ${res.status}`);
          const j = await res.json();
          setPosts(j.posts || []);
          if (tab === "voices") {
            setVoicesStatus(j.externalStatus || "ok");
          }
        }
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
    // Optimistic: drop any post by this author from the current view
    // immediately so the button gives instant feedback. The server
    // fetch + refreshMuted() keeps the muted set authoritative.
    setPosts((prev) => prev.filter((p) =>
      (p?.author?.username || "").toLowerCase() !== username.toLowerCase()
    ));
    try {
      await fetch(`${BACKEND_BASE}/api/feed/mute`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": wallet },
        body: JSON.stringify({ targetUsername: username }),
      });
      refreshMuted();
    } catch { /* swallow */ }
  }, [wallet, refreshMuted]);

  const deletePost = useCallback(async (post) => {
    if (!wallet || !post?.id) return;
    // Optimistic: yank the card before the server confirms so it
    // vanishes instantly. If the DELETE fails, we re-add it.
    const prev = posts;
    setPosts((ps) => ps.filter((p) => p.id !== post.id));
    try {
      const r = await fetch(`${BACKEND_BASE}/api/posts/${post.id}`, {
        method: "DELETE",
        headers: { "x-wallet": wallet },
      });
      if (!r.ok) throw new Error(`delete failed (${r.status})`);
    } catch (e) {
      setPosts(prev);
      alert(`Couldn't delete: ${e.message}`);
    }
  }, [wallet, posts]);

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

  const onReply = useCallback(async (post, text) => {
    // Called by FeedCard's inline Reddit-style reply composer with the
    // text already entered. If we ever need to open a standalone
    // "reply to this" composer from outside the card, we can re-add a
    // prompt() fallback.
    if (!wallet) { walletCtx?.showModal?.(); return; }
    const content = String(text || "").trim().slice(0, 500);
    if (!content) return;
    try {
      await fetch(`${BACKEND_BASE}/api/social/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": wallet },
        body: JSON.stringify({ postId: post.id, content }),
      });
      patchPost(post.id, { comments: (post.comments || 0) + 1 });
    } catch { /* swallow */ }
  }, [wallet, patchPost, walletCtx]);

  const [tipPost, setTipPost] = useState(null);
  const onTip = useCallback((post) => {
    // Open the tip modal in-place instead of redirecting to the legacy
    // IronFeedPage — the redirect was breaking the flow entirely (the
    // target page didn't read `?tip=` back into an open modal state).
    if (!wallet) { walletCtx?.showModal?.(); return; }
    setTipPost(post);
  }, [wallet, walletCtx]);

  const onTipped = useCallback((tip) => {
    if (!tipPost) return;
    // Bump the tipped post's counter + USD total optimistically so the
    // FeedCard reflects the new state without a full reload.
    patchPost(tipPost.id, {
      tipCount:    (tipPost.tipCount    || 0) + 1,
      tipTotalUsd: (tipPost.tipTotalUsd || 0) + Number(tip?.amountUsd || 0),
    });
    setTipPost(null);
  }, [tipPost, patchPost]);

  const prependPost = useCallback((p) => {
    if (!p) return;
    setPosts((prev) => [p, ...prev]);
  }, []);

  return (
    <AppShell rightPanel={<FeedRightRail />}>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "12px 16px" }}>
        {/* Invited-by banner — renders only for brand-new users who
            arrived via /?ref=<code>. Dismissed permanently after the
            first click or x. See ReferrerFollowPrompt for details. */}
        <ReferrerFollowPrompt />
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
                onClick={() => setTabAndNotify(tb.key)}
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

        {/* Voices upstream status banner — only on the Voices tab,
            only when the backend flagged the X-source as dead. Gives
            users a reason when the feed's thin instead of an
            unexplained empty page. */}
        {tab === "voices" && voicesStatus !== "ok" && (
          <div style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: `1px solid rgba(245,158,11,0.35)`,
            background: "rgba(245,158,11,0.08)",
            color: t.text, fontSize: 12, lineHeight: 1.5,
            marginBottom: 10,
          }}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>
              Voices: external feed temporarily unavailable
            </div>
            <div style={{ color: t.textDim }}>
              {voicesStatus === "not_configured"
                ? "The X-bridge isn't configured on this backend — only native IronShield posts show below."
                : "The upstream Nitter instance isn't responding right now. Native posts still work; X-sourced tweets will come back when upstream recovers."}
            </div>
          </div>
        )}

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
              : tab === "news"
              ? "Newsbot hasn't ingested anything yet. Come back in a minute."
              : tab === "ironclaw-alerts"
              ? "No active alerts."
              : "Nothing here yet."}
          </div>
        )}

        {/* Feed — framer staggered enter so cards cascade in. The
            container key includes the tab so switching tabs re-runs
            the stagger (instant tab switch would feel dead). */}
        <m.div
          key={tab}
          variants={feedContainerVariants}
          initial="initial"
          animate="animate"
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          {visible.map((p) => (
            <m.div key={p.id} variants={feedCardVariants}>
              <FeedCard
                post={p}
                viewer={walletCtx}
                isOwn={wallet && p?.author?.wallet_address && wallet.toLowerCase() === p.author.wallet_address.toLowerCase()}
                onMute={mute}
                onDelete={deletePost}
                onLike={()   => onLike(p)}
                onRepost={() => onRepost(p)}
                onTip={()    => onTip(p)}
                onReply={(text) => onReply(p, text)}
              />
            </m.div>
          ))}
        </m.div>
      </div>

      {tipPost && (
        <TipModal
          post={tipPost}
          wallet={wallet}
          selector={walletCtx?.selector}
          openWallet={() => walletCtx?.showModal?.()}
          onClose={() => setTipPost(null)}
          onTipped={onTipped}
        />
      )}
    </AppShell>
  );
}
