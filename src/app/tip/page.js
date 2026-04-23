"use client";
// Public tip page — /tip/?u=<username or wallet>
//
// Shareable external link that surfaces a creator's tip stats + their posts.
// Visitors can browse without connecting; clicking a tip button prompts
// wallet connect if not connected. Works on static export (no dynamic route
// segment — username lives in the query string).

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Zap, ArrowLeft, Flame, Crown, CalendarClock, Copy, Check } from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import { TipModal, TipHistoryDrawer } from "@/components/TipModal";
import AppShell from "@/components/shell/AppShell";
import { API_BASE as API } from "@/lib/apiBase";

function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function shortWallet(w = "") {
  return w.length > 18 ? `${w.slice(0, 8)}…${w.slice(-6)}` : w;
}

// Root layout already supplies ThemeProvider + WalletProvider.
// Suspense is required for useSearchParams during static export.
export default function TipPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <TipPageInner />
    </Suspense>
  );
}

function LoadingFallback() {
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center",
      background: "#080b12", color: "#94a3b8" }}>Loading…</div>
  );
}

function TipPageInner() {
  const t = useTheme();
  const { connected, address: wallet, selector, showModal: openWallet } = useWallet();
  const sp = useSearchParams();
  const key = sp.get("u") || sp.get("username") || "";

  const [profile, setProfile] = useState(null);
  const [stats, setStats]     = useState(null);
  const [posts, setPosts]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [copied, setCopied]   = useState(false);

  const [tipPost, setTipPost]               = useState(null);
  const [tipHistoryPost, setTipHistoryPost] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!key) {
        setError("Missing creator. Use /tip/?u=<username or wallet>");
        setLoading(false);
        return;
      }
      try {
        const [profRes, statsRes] = await Promise.all([
          fetch(`${API}/api/profile/${encodeURIComponent(key)}`).then(r => r.ok ? r.json() : Promise.reject(new Error(`profile ${r.status}`))),
          fetch(`${API}/api/tips/creator/${encodeURIComponent(key)}`).then(r => r.ok ? r.json() : null),
        ]);
        if (cancelled) return;
        setProfile(profRes.user);
        setStats(statsRes);

        const postsRes = await fetch(
          `${API}/api/profile/${profRes.user.id}/posts`,
          wallet ? { headers: { "x-wallet": wallet } } : undefined,
        );
        if (postsRes.ok) {
          const json = await postsRes.json();
          if (!cancelled) setPosts(json.posts || []);
        }
      } catch (e) {
        if (!cancelled) setError(e?.message || "Couldn't load creator");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [key, wallet]);

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  if (loading) return <LoadingFallback />;

  if (error || !profile) {
    return (
      <div style={{ minHeight: "100vh", background: t.bg, color: t.text,
        display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <Zap size={40} color={t.amber} style={{ marginBottom: 12 }} />
          <h2 style={{ color: t.white, margin: "0 0 8px" }}>Creator not found</h2>
          <p style={{ color: t.textMuted, fontSize: 14 }}>{error || "We couldn't find this creator."}</p>
          <a href="/" style={{ color: t.accent, fontSize: 14 }}>← Back to IronShield</a>
        </div>
      </div>
    );
  }

  const topPost = stats?.topPost
    ? posts.find(p => p.id === stats.topPost.postId)
    : null;

  return (
    <AppShell>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "20px 18px 60px" }}>
        {/* Share action — kept local to the tip surface so visitors
            can grab the URL without hunting through the nav. */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <button onClick={copyShareLink} style={{
            padding: "8px 12px", borderRadius: 999, background: t.bgSurface, border: `1px solid ${t.border}`,
            color: t.text, cursor: "pointer", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            {copied ? <><Check size={14} color={t.green} /> Copied</> : <><Copy size={14} /> Share link</>}
          </button>
        </div>
        {/* Banner */}
        {profile.bannerUrl && (
          <div style={{ height: 140, borderRadius: 14, overflow: "hidden", marginBottom: 16,
            background: `url(${profile.bannerUrl}) center/cover` }} />
        )}

        {/* Header card */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
          {profile.pfpUrl ? (
            <img src={profile.pfpUrl} alt="" style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover" }} />
          ) : (
            <div style={{ width: 72, height: 72, borderRadius: "50%",
              background: `linear-gradient(135deg, ${t.accent}, #0ea5e9)`,
              display: "grid", placeItems: "center", color: "#fff", fontWeight: 800, fontSize: 28 }}>
              {(profile.displayName || profile.username || "?")[0]?.toUpperCase()}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, color: t.white, fontSize: 22, fontWeight: 800 }}>
              {profile.displayName || profile.username || shortWallet(profile.walletAddress)}
            </h1>
            <div style={{ color: t.textMuted, fontSize: 13 }}>@{profile.username} · {shortWallet(profile.walletAddress)}</div>
            {profile.bio && <div style={{ color: t.text, fontSize: 13, marginTop: 6 }}>{profile.bio}</div>}
          </div>
          <button onClick={() => {
            if (!connected) { openWallet(); return; }
            // Open the tip modal against the creator's top post, or fall back
            // to the most recent post. Creator-level tips route to whichever
            // post is surfaced here.
            const target = topPost || posts[0];
            if (target) setTipPost(target);
          }} style={{
            ...primaryBtn(t), display: "inline-flex", alignItems: "center", gap: 6,
            padding: "10px 16px", fontSize: 14,
          }}>
            <Zap size={16} fill="#fff" /> Tip creator
          </button>
        </div>

        {/* Creator tip stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 20 }}>
          <StatCard t={t} icon={<Zap size={16} color={t.amber} />}
            label="Total tips" value={`${stats?.totalTips || 0}`}
            sub={`≈ $${Number(stats?.totalTipsUsd || 0).toFixed(2)} USD`} />
          <StatCard t={t} icon={<Crown size={16} color="#f5b301" />}
            label="Top post"
            value={stats?.topPost ? `$${Number(stats.topPost.totalUsd).toFixed(0)}` : "—"}
            sub={stats?.topPost ? `${stats.topPost.tipCount} tip${stats.topPost.tipCount === 1 ? "" : "s"}` : "No tips yet"} />
          <StatCard t={t} icon={<CalendarClock size={16} color={t.green} />}
            label="Tip streak" value={`${stats?.tipStreakDays || 0} days`}
            sub={stats?.tipStreakDays > 0 ? "Keep it going" : "—"} />
        </div>

        {/* Hint banner for unconnected visitors */}
        {!connected && (
          <div style={{
            padding: "12px 14px", borderRadius: 12, marginBottom: 16,
            background: `${t.accent}14`, border: `1px solid ${t.accent}44`, color: t.text, fontSize: 13,
          }}>
            Connect your wallet to tip this creator in <strong>any token</strong> you hold — NEAR, USDC, or anything else.
          </div>
        )}

        {/* Posts list */}
        <h2 style={{ color: t.white, fontSize: 16, margin: "8px 0 10px" }}>Recent posts</h2>
        {posts.length === 0 && (
          <div style={{ padding: 32, textAlign: "center", color: t.textMuted, fontSize: 13,
            background: t.bgCard, borderRadius: 12, border: `1px solid ${t.border}` }}>
            This creator hasn't posted yet.
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {posts.map(p => (
            <TipPostRow key={p.id} t={t} post={p}
              onTip={() => connected ? setTipPost(p) : openWallet()}
              onHistory={() => setTipHistoryPost(p)} />
          ))}
        </div>
      </div>

      {tipPost && (
        <TipModal
          post={tipPost}
          wallet={wallet}
          selector={selector}
          openWallet={openWallet}
          onClose={() => setTipPost(null)}
          onTipped={() => {
            setTipPost(null);
            // Refresh stats + posts after a tip lands
            (async () => {
              const [s, postsRes] = await Promise.all([
                fetch(`${API}/api/tips/creator/${encodeURIComponent(key)}`).then(r => r.ok ? r.json() : null),
                fetch(`${API}/api/profile/${profile.id}/posts`,
                  wallet ? { headers: { "x-wallet": wallet } } : undefined).then(r => r.ok ? r.json() : null),
              ]);
              if (s) setStats(s);
              if (postsRes?.posts) setPosts(postsRes.posts);
            })();
          }}
        />
      )}
      {tipHistoryPost && (
        <TipHistoryDrawer
          post={tipHistoryPost}
          onClose={() => setTipHistoryPost(null)}
          openTipModal={() => { setTipPost(tipHistoryPost); setTipHistoryPost(null); }}
        />
      )}

      <style>{`.ix-spin { animation: ixSpin 1s linear infinite; } @keyframes ixSpin { to { transform: rotate(360deg); } }`}</style>
    </AppShell>
  );
}

function StatCard({ t, icon, label, value, sub }) {
  return (
    <div style={{
      padding: "12px 14px", borderRadius: 12, background: t.bgCard, border: `1px solid ${t.border}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: t.textMuted, fontSize: 11, fontWeight: 600 }}>
        {icon} <span>{label}</span>
      </div>
      <div style={{ color: t.white, fontSize: 20, fontWeight: 800, marginTop: 4 }}>{value}</div>
      <div style={{ color: t.textDim, fontSize: 11 }}>{sub}</div>
    </div>
  );
}

function TipPostRow({ t, post, onTip, onHistory }) {
  const tipCount    = Number(post.tipCount || 0);
  const tipTotalUsd = Number(post.tipTotalUsd || 0);
  const tier        = tipTotalUsd >= 100 ? { color: "#f5b301", label: "Hot Post" }
                    : tipTotalUsd >= 25  ? { color: "#c0c0c0", label: null }
                    : tipTotalUsd >= 5   ? { color: "#cd7f32", label: null }
                    : null;
  const glowRing = tier
    ? { boxShadow: `inset 0 0 0 1px ${tier.color}55, 0 0 14px ${tier.color}22` }
    : {};
  return (
    <article style={{
      padding: "12px 14px", borderRadius: 12, background: t.bgCard,
      border: `1px solid ${t.border}`, ...glowRing,
    }}>
      {tier?.label && (
        <div style={{ fontSize: 11, color: tier.color, fontWeight: 800, marginBottom: 6,
          display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px",
          borderRadius: 999, background: `${tier.color}18`, border: `1px solid ${tier.color}44` }}>
          <Flame size={11} /> {tier.label}
        </div>
      )}
      <div style={{ color: t.textDim, fontSize: 11, marginBottom: 4 }}>{timeAgo(post.createdAt)} ago</div>
      <p style={{ color: t.text, fontSize: 14, margin: "4px 0", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {post.content}
      </p>
      {post.mediaUrls?.[0] && post.mediaType !== "VIDEO" && (
        <img src={post.mediaUrls[0]} alt="" style={{ width: "100%", borderRadius: 10,
          maxHeight: 360, objectFit: "cover", marginTop: 6 }} />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
        <button onClick={onTip} style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px",
          borderRadius: 999, background: t.amber, color: "#000", border: "none", cursor: "pointer",
          fontWeight: 800, fontSize: 13,
        }}>
          <Zap size={14} fill="#000" /> Tip
        </button>
        {tipCount > 0 && (
          <button onClick={onHistory} style={{
            padding: "8px 12px", borderRadius: 999, background: "transparent",
            color: tier?.color || t.textMuted, border: `1px solid ${tier?.color || t.border}`,
            cursor: "pointer", fontSize: 12, fontWeight: 700,
          }}>
            {tipCount} tip{tipCount === 1 ? "" : "s"} · ${tipTotalUsd.toFixed(0)}
          </button>
        )}
      </div>
    </article>
  );
}

function primaryBtn(t) {
  return {
    padding: "8px 14px", background: t.accent, color: "#fff",
    border: "none", borderRadius: 999, cursor: "pointer", fontSize: 13, fontWeight: 700,
  };
}
