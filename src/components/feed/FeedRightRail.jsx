"use client";
// FeedRightRail — the composite widget stack that sits in AppShell's
// rightPanel slot on /feed (and /profile).
//
// Four cards, top to bottom:
//   1. Your Account   — identity + follower/point stats + CTA to
//                       profile. Shows a "Sign in" variant when no
//                       wallet is connected.
//   2. Trending Topics — 5 rows of #topic · N posts + rising/cooling
//                       arrow. Seeded from an IronShield-branded list
//                       for now; swaps to the backend's
//                       /api/feed/trending endpoint once it lands.
//   3. Who to Follow  — 3 rows of suggested accounts with a Follow
//                       button. POSTs /api/social/follow.
//   4. IronShield Tips — static promo block that routes into Staking.
//
// Everything is glass-card styled (semi-transparent, subtle border,
// inner glow). Kept lightweight so the rail stays snappy.

import { useEffect, useMemo, useState } from "react";
import { useTheme, useWallet } from "@/lib/contexts";
import {
  Shield, CheckCircle2, Users, Coins, Flame, ArrowUpRight, ArrowDownRight,
  TrendingUp, Sparkles, Activity,
} from "lucide-react";

const BACKEND_BASE = (() => {
  if (typeof window === "undefined") return "";
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3001";
  return "https://ironclaw-backend.onrender.com";
})();

// Fallback trending topics — used when the backend doesn't (yet)
// serve /api/feed/trending. Counts are intentionally coarse so the
// fallback can't be confused with real signal.
const FALLBACK_TRENDING = [
  { tag: "IronClaw",    count: "12.4K", dir: "up"   },
  { tag: "Automations", count: "8.7K",  dir: "up"   },
  { tag: "Web3",        count: "7.2K",  dir: "up"   },
  { tag: "Governance",  count: "5.6K",  dir: "up"   },
  { tag: "NewsCoin",    count: "4.3K",  dir: "down" },
];

const FALLBACK_SUGGESTED = [
  { name: "IronClaw",     handle: "ironclaw",    verified: true,  Icon: Shield },
  { name: "NewsCoin",     handle: "newscoin",    verified: true,  Icon: Coins },
  { name: "Web3 Warrior", handle: "web3warrior", verified: false, Icon: Users },
];

function glassCard(t) {
  return {
    padding: 14,
    borderRadius: 14,
    background: "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.00)), var(--bg-card)",
    border: `1px solid ${t.border}`,
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
  };
}

export default function FeedRightRail() {
  const t = useTheme();
  const { address, showModal } = useWallet();
  const [trending, setTrending] = useState(FALLBACK_TRENDING);
  const [suggested, setSuggested] = useState(FALLBACK_SUGGESTED);
  const [stats, setStats] = useState({ followers: 0, following: 0, points: 0 });
  const [pro, setPro] = useState(false);

  useEffect(() => {
    // Best-effort hydration — any of these endpoints can be missing
    // in production and the fallback keeps the UI useful.
    const ctl = new AbortController();
    (async () => {
      try {
        const r = await fetch(`${BACKEND_BASE}/api/feed/trending?limit=5`, { signal: ctl.signal });
        if (r.ok) {
          const j = await r.json();
          if (Array.isArray(j.topics) && j.topics.length) setTrending(j.topics);
        }
      } catch {}
      try {
        const r = await fetch(`${BACKEND_BASE}/api/social/who-to-follow?limit=3`, { signal: ctl.signal });
        if (r.ok) {
          const j = await r.json();
          if (Array.isArray(j.users) && j.users.length) {
            setSuggested(j.users.map((u) => ({
              name: u.display_name || u.username,
              handle: u.username,
              verified: !!u.verified,
              pfp: u.pfp_url,
            })));
          }
        }
      } catch {}
    })();
    return () => ctl.abort();
  }, []);

  useEffect(() => {
    if (!address) return;
    const ctl = new AbortController();
    fetch(`${BACKEND_BASE}/api/profile/${encodeURIComponent(address)}`, { signal: ctl.signal })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (!j?.user) return;
        setStats({
          followers: j.user.followers || 0,
          following: j.user.following || 0,
          points: j.user.points || 0,
        });
        setPro(!!j.user.pro || !!j.user.verified);
      })
      .catch(() => {});
    return () => ctl.abort();
  }, [address]);

  const short = useMemo(() => {
    if (!address) return null;
    return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
  }, [address]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 14 }}>
      {/* Your Account */}
      <section style={glassCard(t)}>
        <div style={{
          fontSize: 11, color: t.textDim, fontWeight: 600,
          letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10,
        }}>
          Your Account
        </div>

        {!address ? (
          <div>
            <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.5, marginBottom: 10 }}>
              Sign in to see your followers, points, and post history right here.
            </div>
            <button
              type="button"
              onClick={() => showModal?.()}
              style={{
                padding: "8px 14px", borderRadius: 8, border: "none",
                background: t.accent, color: "#fff", fontWeight: 700,
                fontSize: 12, cursor: "pointer",
              }}
            >
              Connect wallet
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 44, height: 44, borderRadius: "50%",
                background: `linear-gradient(135deg, ${t.accent}, #0ea5e9)`,
                color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16, fontWeight: 800, flexShrink: 0,
              }}>
                <Shield size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: t.white, display: "flex", alignItems: "center", gap: 4 }}>
                  Shield Holder
                  <CheckCircle2 size={12} color={t.accent} />
                </div>
                <div style={{ fontSize: 12, color: t.textDim }}>
                  @{short}
                </div>
              </div>
            </div>

            {pro && (
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                marginTop: 8, padding: "3px 8px", borderRadius: 999,
                background: "linear-gradient(135deg, rgba(168,85,247,0.2), rgba(59,130,246,0.14))",
                border: `1px solid rgba(168,85,247,0.35)`,
                color: "#c084fc", fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
              }}>
                <Sparkles size={10} /> IronShield Pro
              </div>
            )}

            <div style={{
              display: "grid", gap: 6,
              gridTemplateColumns: "1fr 1fr 1fr",
              marginTop: 14,
            }}>
              <Stat label="Followers" value={fmtCount(stats.followers)} t={t} />
              <Stat label="Following" value={fmtCount(stats.following)} t={t} />
              <Stat label="Points"    value={fmtCount(stats.points)} t={t} />
            </div>

            <a
              href={`/profile?address=${encodeURIComponent(address)}`}
              style={{
                display: "block", textAlign: "center", marginTop: 12,
                padding: "8px 12px", borderRadius: 8,
                border: `1px solid ${t.border}`, background: "var(--bg-surface)",
                color: t.text, fontSize: 12, fontWeight: 600, textDecoration: "none",
              }}
            >
              View Profile
            </a>
          </>
        )}
      </section>

      {/* Market Sentiment — NewsCoin/Trending reference panel #7.
          Shows an overall sentiment gauge (Bullish / Neutral / Bearish)
          plus a 24h delta pill and a mini list of trending narratives
          with directional arrows. Uses static placeholder numbers
          until the backend sentiment endpoint lands — every label,
          color, and layout is driven by the `sentiment` state so
          wiring later is a one-line swap. */}
      <MarketSentimentCard t={t} />

      {/* Trending Topics */}
      <section style={glassCard(t)}>
        <div style={{
          display: "flex", alignItems: "center", gap: 6, marginBottom: 8,
        }}>
          <TrendingUp size={12} color={t.accent} />
          <div style={{ fontSize: 13, color: t.text, fontWeight: 700 }}>
            Trending Topics
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {trending.map((x) => {
            const up = x.dir === "up" || x.direction === "up";
            return (
              <a
                key={x.tag}
                href={`/search?q=${encodeURIComponent("#" + x.tag)}`}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "6px 6px", borderRadius: 6,
                  color: "inherit", textDecoration: "none",
                  transition: "background 120ms ease",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ color: t.textDim, fontSize: 13, fontWeight: 700 }}>#</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: t.text, flex: 1, minWidth: 0 }}>
                  {x.tag}
                </span>
                <span style={{ fontSize: 11, color: t.textDim }}>
                  {x.count} posts
                </span>
                {up
                  ? <ArrowUpRight   size={12} color="var(--green)" />
                  : <ArrowDownRight size={12} color="var(--red)" />}
              </a>
            );
          })}
        </div>
        <div style={{
          textAlign: "center", paddingTop: 8, marginTop: 4,
          borderTop: `1px solid ${t.border}`,
        }}>
          <a href="/trends" style={{ fontSize: 12, color: t.accent, textDecoration: "none", fontWeight: 600 }}>
            View all
          </a>
        </div>
      </section>

      {/* Who to Follow */}
      <section style={glassCard(t)}>
        <div style={{
          fontSize: 13, color: t.text, fontWeight: 700, marginBottom: 10,
        }}>
          Who to follow
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {suggested.map((x) => (
            <FollowRow key={x.handle} user={x} t={t} viewerAddress={address} />
          ))}
        </div>
        <div style={{
          textAlign: "center", paddingTop: 8, marginTop: 4,
          borderTop: `1px solid ${t.border}`,
        }}>
          <a href="/search?type=people" style={{ fontSize: 12, color: t.accent, textDecoration: "none", fontWeight: 600 }}>
            Show more
          </a>
        </div>
      </section>

      {/* Your Deploys — renders when the viewer has launched coins.
          Silent (returns null) when none exist or wallet isn't connected,
          so the rail stays tidy for new users. */}
      <YourDeploysCard t={t} glass={glassCard(t)} address={address} />

      {/* IronShield Tips */}
      <section style={{
        ...glassCard(t),
        background: "linear-gradient(135deg, rgba(59,130,246,0.1), rgba(14,165,233,0.05)), var(--bg-card)",
        borderColor: "rgba(59,130,246,0.35)",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: `linear-gradient(135deg, ${t.accent}, #0ea5e9)`,
            color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <Flame size={16} />
          </div>
          <div>
            <div style={{ fontSize: 13, color: t.text, fontWeight: 700, marginBottom: 2 }}>
              IronShield Tips
            </div>
            <div style={{ fontSize: 12, color: t.textDim, lineHeight: 1.45, marginBottom: 8 }}>
              Stake $IRON to earn rewards and unlock governance voting.
            </div>
            <a href="/staking" style={{ color: t.accent, fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
              Stake now →
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, t }) {
  return (
    <div style={{
      textAlign: "center",
      padding: "8px 4px", borderRadius: 8,
      background: "var(--bg-surface)",
    }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: t.white }}>{value}</div>
      <div style={{ fontSize: 10, color: t.textDim, letterSpacing: 0.4, textTransform: "uppercase" }}>
        {label}
      </div>
    </div>
  );
}

function FollowRow({ user, t, viewerAddress }) {
  const { Icon, pfp, name, handle, verified } = user;
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (!viewerAddress) return;
    setBusy(true);
    const next = !following;
    setFollowing(next);
    try {
      await fetch(`${BACKEND_BASE}/api/social/follow`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": viewerAddress },
        body: JSON.stringify({ username: handle, on: next }),
      });
    } catch { setFollowing(!next); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {pfp ? (
        <img src={pfp} alt="" width={32} height={32} style={{ borderRadius: "50%", objectFit: "cover" }} />
      ) : (
        <div style={{
          width: 32, height: 32, borderRadius: "50%",
          background: `linear-gradient(135deg, ${t.accent}, #0ea5e9)`,
          color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          {Icon ? <Icon size={14} /> : name?.[0]?.toUpperCase() || "?"}
        </div>
      )}
      <a
        href={`/profile?username=${encodeURIComponent(handle)}`}
        style={{ flex: 1, minWidth: 0, textDecoration: "none", color: "inherit" }}
      >
        <div style={{
          fontSize: 13, fontWeight: 700, color: t.text,
          display: "flex", alignItems: "center", gap: 4,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {name}
          {verified && <CheckCircle2 size={11} color={t.accent} />}
        </div>
        <div style={{ fontSize: 11, color: t.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          @{handle}
        </div>
      </a>
      <button
        type="button"
        disabled={busy || !viewerAddress}
        onClick={toggle}
        style={{
          padding: "5px 12px", borderRadius: 999,
          border: `1px solid ${following ? t.border : t.accent}`,
          background: following ? "transparent" : "var(--accent-dim)",
          color: following ? t.textMuted : t.accent,
          fontSize: 11, fontWeight: 700, cursor: viewerAddress ? "pointer" : "not-allowed",
          opacity: viewerAddress ? 1 : 0.5,
        }}
      >
        {following ? "Following" : "Follow"}
      </button>
    </div>
  );
}

function fmtCount(n) {
  const v = Number(n || 0);
  if (v < 1000) return String(v);
  if (v < 1_000_000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K`;
  return `${(v / 1_000_000).toFixed(1)}M`;
}

// ── Market Sentiment ────────────────────────────────────────────────
// A condensed version of the reference NewsCoin/Trending card. The
// gauge is drawn with a single SVG path so we don't pull in any chart
// library. Narratives list reuses the same up/down arrow motif as
// Trending Topics for visual coherence.
const SENTIMENT_FALLBACK = {
  score: 74, label: "Bullish", delta: 12, // 0-100
  narratives: [
    { tag: "AI Agents",      change: 24.5 },
    { tag: "Real World Assets", change: 18.7 },
    { tag: "Bitcoin L2s",    change: 15.2 },
    { tag: "DePIN",          change: -4.3 },
  ],
};

function MarketSentimentCard({ t }) {
  const [data, setData] = useState(SENTIMENT_FALLBACK);

  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/market/sentiment", { signal: ctl.signal })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (j && typeof j.score === "number") setData(j); })
      .catch(() => {});
    return () => ctl.abort();
  }, []);

  const label = data.label || (
    data.score >= 60 ? "Bullish" : data.score <= 40 ? "Bearish" : "Neutral"
  );
  const color =
    data.score >= 60 ? "#10b981" :
    data.score <= 40 ? "#ef4444" :
    "#f59e0b";

  return (
    <section style={{
      padding: 14, borderRadius: 14,
      background: "linear-gradient(180deg, rgba(168,85,247,0.05), rgba(59,130,246,0.02)), var(--bg-card)",
      border: `1px solid ${t.border}`,
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <Activity size={12} color={t.accent} />
        <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>
          Market Sentiment
        </div>
        <div style={{ flex: 1 }} />
        <span style={{
          fontSize: 9, padding: "2px 8px", borderRadius: 999,
          background: "rgba(16,185,129,0.12)", color: "#10b981",
          border: "1px solid rgba(16,185,129,0.35)",
          fontWeight: 800, letterSpacing: 0.5,
        }}>LIVE</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <SentimentGauge score={data.score} color={color} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 800, color }}>{label}</div>
          <div style={{ fontSize: 11, color: t.textDim, marginTop: 2 }}>
            {data.score}/100 score
          </div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 3,
            marginTop: 6, fontSize: 11, fontWeight: 700,
            color: data.delta >= 0 ? "#10b981" : "#ef4444",
          }}>
            {data.delta >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
            {Math.abs(data.delta)} pts (24h)
          </div>
        </div>
      </div>

      <div style={{
        marginTop: 14, paddingTop: 12,
        borderTop: `1px solid ${t.border}`,
      }}>
        <div style={{
          fontSize: 11, color: t.textDim, fontWeight: 600,
          letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8,
        }}>
          Trending Narratives
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {(data.narratives || []).slice(0, 5).map((n, i) => {
            const up = n.change >= 0;
            return (
              <a
                key={n.tag}
                href={`/search?q=${encodeURIComponent(n.tag)}`}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "6px 4px", borderRadius: 6,
                  color: "inherit", textDecoration: "none",
                  transition: "background 120ms ease",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-surface)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{
                  width: 18, textAlign: "center",
                  fontSize: 11, color: t.textDim, fontWeight: 600,
                  fontFamily: "var(--font-jetbrains-mono), monospace",
                }}>{i + 1}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: t.text }}>
                  {n.tag}
                </span>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 2,
                  fontSize: 11, fontWeight: 700,
                  color: up ? "#10b981" : "#ef4444",
                }}>
                  {up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                  {up ? "+" : ""}{n.change.toFixed(1)}%
                </span>
              </a>
            );
          })}
        </div>
        <a href="/trends" style={{
          display: "block", textAlign: "center", marginTop: 8, paddingTop: 8,
          borderTop: `1px solid ${t.border}`,
          color: t.accent, fontSize: 12, fontWeight: 600, textDecoration: "none",
        }}>
          View all narratives
        </a>
      </div>
    </section>
  );
}

// Semi-circular "speedometer" gauge. r=32, ranges the bottom half
// from left (0) to right (100). We draw a full background arc then
// overlay the colored progress arc — no chart lib needed.
function SentimentGauge({ score, color }) {
  const clamped = Math.max(0, Math.min(100, score || 0));
  // Arc geometry: 180° sweep from angle π → 0.
  const r = 30;
  const cx = 40, cy = 44;
  const startAngle = Math.PI;
  const endAngle = startAngle + (clamped / 100) * -Math.PI;
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const largeArc = clamped > 50 ? 1 : 0;
  const path = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
  // Needle
  const needleAngle = startAngle - Math.PI * (clamped / 100);
  const nx = cx + (r - 6) * Math.cos(needleAngle);
  const ny = cy + (r - 6) * Math.sin(needleAngle);

  return (
    <svg width="80" height="56" viewBox="0 0 80 56" style={{ flexShrink: 0 }}>
      {/* Background arc */}
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
      />
      {/* Progress arc */}
      <path
        d={path}
        stroke={color}
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
      />
      {/* Needle */}
      <line
        x1={cx} y1={cy} x2={nx} y2={ny}
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r="3" fill={color} />
    </svg>
  );
}

// Your Deploys card — reuses the /api/newscoin/by-creator endpoint the
// profile page already queries. Silently renders nothing when the
// wallet has no launches so the rail doesn't show an empty card to
// non-creators.
function YourDeploysCard({ t, glass, address }) {
  const [coins, setCoins] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!address) { setCoins([]); return; }
    const ctl = new AbortController();
    setLoading(true);
    fetch(`${BACKEND_BASE}/api/newscoin/by-creator?creator=${encodeURIComponent(address)}`, { signal: ctl.signal })
      .then(r => r.ok ? r.json() : { coins: [] })
      .then(j => setCoins(Array.isArray(j.coins) ? j.coins : []))
      .catch(() => setCoins([]))
      .finally(() => setLoading(false));
    return () => ctl.abort();
  }, [address]);

  if (!address) return null;
  if (!loading && coins.length === 0) return null;

  return (
    <section style={glass}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <Coins size={13} color={t.accent} />
        <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, color: t.textMuted, textTransform: "uppercase", flex: 1 }}>
          Your Deploys
        </div>
        <a href="/profile?tab=deployed" style={{ fontSize: 11, color: t.accent, fontWeight: 600, textDecoration: "none" }}>
          View all
        </a>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {loading && coins.length === 0 && (
          <>
            <div style={{ height: 38, borderRadius: 8, background: "rgba(255,255,255,0.04)" }} />
            <div style={{ height: 38, borderRadius: 8, background: "rgba(255,255,255,0.04)" }} />
          </>
        )}
        {coins.slice(0, 4).map((c) => (
          <a
            key={c.id || c.ticker}
            href={`/newscoin?token=${encodeURIComponent(c.ticker || c.id)}`}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 10px", borderRadius: 8,
              border: `1px solid ${t.border}`, background: "var(--bg-input)",
              textDecoration: "none", color: t.text,
            }}
          >
            <div style={{
              width: 26, height: 26, borderRadius: 6,
              background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
              color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 800, flexShrink: 0,
            }}>
              {(c.ticker || c.name || "?")[0]?.toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: t.white, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {c.name || c.ticker}
              </div>
              <div style={{ fontSize: 10, color: t.textDim }}>
                ${c.ticker || "?"} · {c.chain || "near"}
              </div>
            </div>
            {c.priceUsd != null && (
              <div style={{ fontSize: 11, color: t.text, fontFamily: "var(--font-jetbrains-mono), monospace" }}>
                ${Number(c.priceUsd).toFixed(c.priceUsd < 1 ? 4 : 2)}
              </div>
            )}
          </a>
        ))}
      </div>
    </section>
  );
}
