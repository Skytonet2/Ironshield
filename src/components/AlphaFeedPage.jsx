"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Rss, TrendingUp, Zap, Droplets, Flame, Globe,
  ChevronDown, ChevronUp, ThumbsUp, MessageCircle,
  Send, Wallet, RefreshCw, ExternalLink, X
} from "lucide-react";
import { Section, Badge, Btn } from "./Primitives";
import { useTheme, useWallet } from "@/lib/contexts";

// ── Constants ────────────────────────────────────────────────────
const BACKEND_URL =
  typeof process !== "undefined" && process.env?.NEXT_PUBLIC_BACKEND_URL
    ? process.env.NEXT_PUBLIC_BACKEND_URL
    : "http://localhost:3001";

const POLL_INTERVAL_MS = 60_000;
const LS_KEY_UPVOTES   = "alpha_feed_upvotes_v1";
const LS_KEY_COMMENTS  = "alpha_feed_comments_v1";

// ── Category config ──────────────────────────────────────────────
const CATEGORIES = [
  { key: "all",      label: "All",        icon: Globe,      color: "#3b82f6" },
  { key: "news",     label: "News",        icon: Rss,        color: "#10b981" },
  { key: "kol",      label: "KOL Alpha",   icon: Zap,        color: "#f59e0b" },
  { key: "trending", label: "Trending",    icon: TrendingUp, color: "#8b5cf6" },
  { key: "airdrops", label: "Airdrops",    icon: Droplets,   color: "#06b6d4" },
  { key: "chaos",    label: "Chaos",       icon: Flame,      color: "#ef4444" },
];

// ── Sample / fallback data ────────────────────────────────────────
const SAMPLE_ITEMS = [
  {
    id: "sample-1",
    category: "kol",
    source: "Ansem",
    handle: "@blknoiz06",
    avatar: "A",
    avatarColor: "#f59e0b",
    timestamp: Date.now() - 1_200_000,
    content:
      "SOL is the only L1 that passes the 'would I use this in 10 years' test. Everything else is still solving 2021 problems. The new wave of consumer apps coming is going to shock people.",
    link: "https://twitter.com/blknoiz06",
    upvotes: 312,
    isSample: true,
  },
  {
    id: "sample-2",
    category: "news",
    source: "CoinDesk",
    handle: "coindesk.com",
    avatar: "CD",
    avatarColor: "#10b981",
    timestamp: Date.now() - 3_600_000,
    content:
      "BlackRock's IBIT Bitcoin ETF crosses $50B AUM in record time, surpassing gold ETF inflows from 2004. Institutional allocations to crypto expected to triple by Q4 2026.",
    link: "https://coindesk.com",
    upvotes: 184,
    isSample: true,
  },
  {
    id: "sample-3",
    category: "airdrops",
    source: "Alpha Insider",
    handle: "@alphainsider",
    avatar: "AI",
    avatarColor: "#06b6d4",
    timestamp: Date.now() - 7_200_000,
    content:
      "🚨 Monad testnet airdrop confirmed. Snapshot in ~3 weeks. Key actions: bridge at least 0.1 ETH, swap on MonadSwap 10+ times, mint the free NFT. Seed backers: Paradigm + Coinbase Ventures. This will be significant.",
    link: "#",
    upvotes: 891,
    isSample: true,
  },
  {
    id: "sample-4",
    category: "trending",
    source: "DexScreener",
    handle: "dexscreener.com",
    avatar: "DX",
    avatarColor: "#8b5cf6",
    timestamp: Date.now() - 900_000,
    content:
      "$NEAR +34% in 24h. Volume spiking across ref.finance and Jumbo DEX. Large wallet accumulation detected — 2.4M NEAR moved off exchanges in the last 6 hours. Watch for continuation above $5.20.",
    link: "https://dexscreener.com",
    upvotes: 456,
    isSample: true,
  },
  {
    id: "sample-5",
    category: "chaos",
    source: "Cobie",
    handle: "@cobie",
    avatar: "C",
    avatarColor: "#ef4444",
    timestamp: Date.now() - 5_400_000,
    content:
      "Another perps exchange hacked. $47M gone. Bridge audit wasn't done in 6 months. This is why you don't keep life savings on-chain until you understand what you're signing. Reminder: not your keys, not your coins.",
    link: "https://twitter.com/cobie",
    upvotes: 2103,
    isSample: true,
  },
  {
    id: "sample-6",
    category: "kol",
    source: "Route 2 FI",
    handle: "@Route2FI",
    avatar: "R2",
    avatarColor: "#f59e0b",
    timestamp: Date.now() - 10_800_000,
    content:
      "Restaking is the most important narrative right now. EigenLayer, Symbiotic, Karak — all competing for the same TVL. My thesis: the winner won't be the first, it'll be the one with the best slashing UX. Watch Karak closely.",
    link: "https://twitter.com/Route2FI",
    upvotes: 738,
    isSample: true,
  },
];

// ── Utilities ────────────────────────────────────────────────────
function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000)    return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function readLS(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function writeLS(key, value) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ── Skeleton ─────────────────────────────────────────────────────
function SkeletonCard({ t }) {
  return (
    <div style={{
      background: t.bgCard, border: `1px solid ${t.border}`,
      borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 14,
    }}>
      {[80, 100, 60].map((w, i) => (
        <div key={i} style={{
          height: i === 0 ? 14 : i === 1 ? 40 : 10,
          width: `${w}%`, borderRadius: 6,
          background: `linear-gradient(90deg, ${t.bgSurface} 25%, ${t.border} 50%, ${t.bgSurface} 75%)`,
          backgroundSize: "200% 100%",
          animation: "shimmer 1.4s infinite",
        }} />
      ))}
    </div>
  );
}

// ── Comment thread ────────────────────────────────────────────────
function CommentThread({ itemId, t, connected, address, showModal }) {
  const [comments, setComments] = useState(() =>
    readLS(LS_KEY_COMMENTS, {})[itemId] || []
  );
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState(null); // { id, handle }
  const [upvotedReplies, setUpvotedReplies] = useState(
    () => readLS("alpha_reply_upvotes_v1", {})
  );
  const inputRef = useRef(null);

  const persistComments = useCallback((updated) => {
    setComments(updated);
    const all = readLS(LS_KEY_COMMENTS, {});
    all[itemId] = updated;
    writeLS(LS_KEY_COMMENTS, all);
  }, [itemId]);

  const submit = () => {
    if (!text.trim()) return;
    if (!connected) { showModal(); return; }
    const newComment = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      author: address,
      text: text.trim(),
      ts: Date.now(),
      replyTo: replyTo ? replyTo.id : null,
      replyToHandle: replyTo ? replyTo.handle : null,
      upvotes: 0,
    };
    persistComments([...comments, newComment]);
    setText("");
    setReplyTo(null);
  };

  const upvoteReply = (id) => {
    if (!connected) { showModal(); return; }
    const key = `${itemId}-${id}`;
    if (upvotedReplies[key]) return;
    const updated = { ...upvotedReplies, [key]: true };
    setUpvotedReplies(updated);
    writeLS("alpha_reply_upvotes_v1", updated);
    persistComments(comments.map(c => c.id === id ? { ...c, upvotes: (c.upvotes || 0) + 1 } : c));
  };

  const topLevel = comments.filter(c => !c.replyTo);
  const replies  = comments.filter(c => !!c.replyTo);

  const shortAddr = (a) => a?.length > 14 ? `${a.slice(0, 8)}…${a.slice(-4)}` : (a || "anon");

  return (
    <div style={{ marginTop: 16, borderTop: `1px solid ${t.border}`, paddingTop: 16 }}>
      {/* Input row */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "flex-start" }}>
        <div style={{
          width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
          background: connected ? `${t.accent}22` : t.bgSurface,
          border: `1px solid ${connected ? t.accent + "44" : t.border}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 700, color: connected ? t.accent : t.textDim,
        }}>
          {connected ? shortAddr(address).slice(0, 2).toUpperCase() : "?"}
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          {replyTo && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: t.textMuted }}>
              <span>Replying to <span style={{ color: t.accent }}>{replyTo.handle}</span></span>
              <button onClick={() => setReplyTo(null)} style={{ background: "none", border: "none", cursor: "pointer", color: t.textDim, display: "flex" }}>
                <X size={12} />
              </button>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <input
              ref={inputRef}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
              placeholder={connected ? "Add your take…" : "Connect wallet to comment"}
              style={{
                flex: 1, background: t.bgSurface, border: `1px solid ${t.border}`,
                borderRadius: 10, padding: "9px 14px", fontSize: 13, color: t.text,
                outline: "none", fontFamily: "inherit",
              }}
            />
            <button onClick={submit} style={{
              background: t.accent, border: "none", borderRadius: 10,
              width: 38, height: 38, display: "flex", alignItems: "center",
              justifyContent: "center", cursor: "pointer", flexShrink: 0,
            }}>
              <Send size={15} color="#fff" />
            </button>
          </div>
        </div>
      </div>

      {/* Comment list */}
      {topLevel.length === 0 && (
        <div style={{ fontSize: 12, color: t.textDim, textAlign: "center", padding: "8px 0" }}>
          No comments yet. Be the first.
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {topLevel.map(comment => {
          const replyList = replies.filter(r => r.replyTo === comment.id);
          const upvoteKey = `${itemId}-${comment.id}`;
          const alreadyUpvoted = !!upvotedReplies[upvoteKey];
          return (
            <div key={comment.id}>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                  background: `${t.accent}18`, border: `1px solid ${t.accent}33`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 700, color: t.accent,
                }}>
                  {shortAddr(comment.author).slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 3 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: t.text, fontFamily: "'JetBrains Mono', monospace" }}>
                      {shortAddr(comment.author)}
                    </span>
                    <span style={{ fontSize: 11, color: t.textDim }}>{timeAgo(comment.ts)}</span>
                  </div>
                  {comment.replyToHandle && (
                    <span style={{ fontSize: 11, color: t.accent, marginBottom: 2, display: "block" }}>
                      → {comment.replyToHandle}
                    </span>
                  )}
                  <div style={{ fontSize: 13, color: t.textMuted, lineHeight: 1.5 }}>{comment.text}</div>
                  <div style={{ display: "flex", gap: 14, marginTop: 6, alignItems: "center" }}>
                    <button onClick={() => upvoteReply(comment.id)} style={{
                      background: "none", border: "none", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 4,
                      fontSize: 11, color: alreadyUpvoted ? t.accent : t.textDim,
                    }}>
                      <ThumbsUp size={12} /> {comment.upvotes || 0}
                    </button>
                    <button onClick={() => {
                      setReplyTo({ id: comment.id, handle: shortAddr(comment.author) });
                      inputRef.current?.focus();
                    }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: t.textDim }}>
                      Reply
                    </button>
                  </div>
                </div>
              </div>
              {replyList.length > 0 && (
                <div style={{ marginLeft: 38, marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                  {replyList.map(reply => {
                    const rKey = `${itemId}-${reply.id}`;
                    const rUpvoted = !!upvotedReplies[rKey];
                    return (
                      <div key={reply.id} style={{ display: "flex", gap: 8 }}>
                        <div style={{
                          width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                          background: `${t.green}18`, border: `1px solid ${t.green}33`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 9, fontWeight: 700, color: t.green,
                        }}>
                          {shortAddr(reply.author).slice(0, 2).toUpperCase()}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 2 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: t.text, fontFamily: "'JetBrains Mono', monospace" }}>
                              {shortAddr(reply.author)}
                            </span>
                            <span style={{ fontSize: 10, color: t.textDim }}>{timeAgo(reply.ts)}</span>
                          </div>
                          {reply.replyToHandle && (
                            <span style={{ fontSize: 10, color: t.accent }}>→ {reply.replyToHandle} </span>
                          )}
                          <span style={{ fontSize: 12, color: t.textMuted, lineHeight: 1.5 }}>{reply.text}</span>
                          <div style={{ marginTop: 4 }}>
                            <button onClick={() => upvoteReply(reply.id)} style={{
                              background: "none", border: "none", cursor: "pointer",
                              display: "flex", alignItems: "center", gap: 4,
                              fontSize: 10, color: rUpvoted ? t.accent : t.textDim,
                            }}>
                              <ThumbsUp size={11} /> {reply.upvotes || 0}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Feed Item Card ────────────────────────────────────────────────
function FeedCard({ item, t, connected, address, showModal }) {
  const [expanded, setExpanded]     = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [upvotes, setUpvotes]       = useState(item.upvotes || 0);
  const [upvoted, setUpvoted]       = useState(false);
  const [commentCount, setCommentCount] = useState(0);

  // Initialise from localStorage
  useEffect(() => {
    const storedUpvotes  = readLS(LS_KEY_UPVOTES, {});
    const storedComments = readLS(LS_KEY_COMMENTS, {});
    if (storedUpvotes[item.id]) {
      setUpvoted(true);
      setUpvotes(v => v + (storedUpvotes[item.id] === "extra" ? 1 : 0));
    }
    const itemComments = storedComments[item.id] || [];
    setCommentCount(itemComments.length);
  }, [item.id]);

  // Track comment count changes from child
  const onCommentsChange = useCallback(() => {
    const storedComments = readLS(LS_KEY_COMMENTS, {});
    setCommentCount((storedComments[item.id] || []).length);
  }, [item.id]);

  const handleUpvote = () => {
    if (upvoted) return;
    if (!connected) { showModal(); return; }
    setUpvoted(true);
    setUpvotes(v => v + 1);
    const stored = readLS(LS_KEY_UPVOTES, {});
    stored[item.id] = "extra";
    writeLS(LS_KEY_UPVOTES, stored);
  };

  const cat = CATEGORIES.find(c => c.key === item.category) || CATEGORIES[0];
  const CatIcon = cat.icon;
  const isLong = item.content.length > 200;
  const displayContent = isLong && !expanded
    ? item.content.slice(0, 200) + "…"
    : item.content;

  return (
    <div
      style={{
        background: t.bgCard,
        border: `1px solid ${t.border}`,
        borderRadius: 16,
        padding: "20px 24px",
        transition: "border-color 0.25s, box-shadow 0.25s",
        position: "relative",
        overflow: "hidden",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = cat.color + "66";
        e.currentTarget.style.boxShadow   = `0 0 28px ${cat.color}18`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = t.border;
        e.currentTarget.style.boxShadow   = "none";
      }}
    >
      {/* Accent strip */}
      <div style={{
        position: "absolute", top: 0, left: 0, width: 3,
        height: "100%", background: cat.color, borderRadius: "16px 0 0 16px",
        opacity: 0.7,
      }} />

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        {/* Avatar */}
        <div style={{
          width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
          background: `${item.avatarColor}22`,
          border: `1.5px solid ${item.avatarColor}55`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, fontWeight: 800, color: item.avatarColor,
          letterSpacing: -0.5,
        }}>
          {item.avatar}
        </div>

        {/* Source info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: t.white, whiteSpace: "nowrap" }}>
              {item.source}
            </span>
            <span style={{ fontSize: 12, color: t.textDim, whiteSpace: "nowrap" }}>
              {item.handle}
            </span>
            {item.isSample && (
              <Badge color={t.textDim} style={{ fontSize: 9 }}>Sample</Badge>
            )}
          </div>
          <div style={{ fontSize: 11, color: t.textDim, marginTop: 1 }}>{timeAgo(item.timestamp)}</div>
        </div>

        {/* Category badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <Badge color={cat.color}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <CatIcon size={10} />
              {cat.label}
            </span>
          </Badge>
        </div>
      </div>

      {/* Content */}
      <div style={{ fontSize: 14, color: t.text, lineHeight: 1.7, marginBottom: 14 }}>
        {displayContent}
        {isLong && (
          <button
            onClick={() => setExpanded(v => !v)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: t.accent, fontSize: 13, fontWeight: 600,
              padding: "0 4px", display: "inline-flex", alignItems: "center", gap: 3,
            }}
          >
            {expanded ? <><ChevronUp size={13} /> less</> : <><ChevronDown size={13} /> more</>}
          </button>
        )}
      </div>

      {/* Action row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {/* Upvote */}
        <button
          onClick={handleUpvote}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 14px", borderRadius: 20,
            border: `1px solid ${upvoted ? t.accent + "55" : t.border}`,
            background: upvoted ? `${t.accent}14` : "transparent",
            color: upvoted ? t.accent : t.textMuted,
            fontSize: 13, fontWeight: 600, cursor: upvoted ? "default" : "pointer",
            transition: "all 0.2s",
          }}
        >
          <ThumbsUp size={14} />
          {upvotes}
        </button>

        {/* Comments toggle */}
        <button
          onClick={() => setShowComments(v => !v)}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 14px", borderRadius: 20,
            border: `1px solid ${showComments ? t.accent + "55" : t.border}`,
            background: showComments ? `${t.accent}14` : "transparent",
            color: showComments ? t.accent : t.textMuted,
            fontSize: 13, fontWeight: 600, cursor: "pointer",
            transition: "all 0.2s",
          }}
        >
          <MessageCircle size={14} />
          {commentCount > 0 ? commentCount : "Comment"}
        </button>

        {/* External link */}
        {item.link && item.link !== "#" && (
          <a
            href={item.link}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "6px 12px", borderRadius: 20,
              border: `1px solid ${t.border}`,
              color: t.textDim, fontSize: 12, textDecoration: "none",
              transition: "color 0.2s, border-color 0.2s",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = t.text; e.currentTarget.style.borderColor = t.borderHover; }}
            onMouseLeave={e => { e.currentTarget.style.color = t.textDim; e.currentTarget.style.borderColor = t.border; }}
          >
            <ExternalLink size={12} /> Source
          </a>
        )}
      </div>

      {/* Comment thread (lazy mount) */}
      {showComments && (
        <div onClick={onCommentsChange}>
          <CommentThread
            itemId={item.id}
            t={t}
            connected={connected}
            address={address}
            showModal={showModal}
          />
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────
export default function AlphaFeedPage({ openWallet }) {
  const t = useTheme();
  const { connected, address, showModal } = useWallet();

  const [items, setItems]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [backendDown, setBackendDown] = useState(false);
  const [activeCategory, setActiveCategory] = useState("all");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [refreshing, setRefreshing]   = useState(false);
  const intervalRef = useRef(null);

  // ── Fetch ──────────────────────────────────────────────────────
  const fetchFeed = useCallback(async (category = "all", isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const url = `${BACKEND_URL}/api/alpha/feed${category !== "all" ? `?category=${category}` : ""}`;
      const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      setItems(list);
      setBackendDown(false);
      setLastUpdated(Date.now());
    } catch {
      // Backend unavailable — show sample data
      setItems(SAMPLE_ITEMS);
      setBackendDown(true);
      setLastUpdated(Date.now());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    fetchFeed(activeCategory);
    intervalRef.current = setInterval(() => fetchFeed(activeCategory), POLL_INTERVAL_MS);
    return () => clearInterval(intervalRef.current);
  }, [activeCategory, fetchFeed]);

  // ── Derived ────────────────────────────────────────────────────
  const filtered = activeCategory === "all"
    ? items
    : items.filter(i => i.category === activeCategory);

  // ── Shimmer keyframe injection ─────────────────────────────────
  useEffect(() => {
    if (typeof document === "undefined") return;
    const id = "alpha-shimmer-style";
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id = id;
    style.textContent = `
      @keyframes shimmer {
        0%   { background-position: -200% 0; }
        100% { background-position:  200% 0; }
      }
    `;
    document.head.appendChild(style);
  }, []);

  const openWalletFn = openWallet || showModal;

  // ── Render ─────────────────────────────────────────────────────
  return (
    <Section style={{ paddingTop: 90 }}>
      {/* Page header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <div style={{
                background: `${t.accent}18`, border: `1px solid ${t.accent}33`,
                borderRadius: 12, padding: 10, display: "flex",
              }}>
                <Zap size={22} color={t.accent} />
              </div>
              <div>
                <h1 style={{ fontSize: 28, fontWeight: 800, color: t.white, margin: 0, letterSpacing: "-0.5px" }}>
                  Alpha Feed
                </h1>
                <p style={{ fontSize: 14, color: t.textMuted, margin: 0, marginTop: 2 }}>
                  Real-time crypto intelligence — KOL alpha, news, airdrops & market chaos
                </p>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {backendDown && (
              <Badge color={t.amber} style={{ fontSize: 11 }}>
                Sample Data — Backend Offline
              </Badge>
            )}
            {lastUpdated && (
              <span style={{ fontSize: 11, color: t.textDim }}>
                Updated {timeAgo(lastUpdated)}
              </span>
            )}
            <button
              onClick={() => fetchFeed(activeCategory, true)}
              disabled={refreshing}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 16px", borderRadius: 10,
                border: `1px solid ${t.border}`, background: t.bgSurface,
                color: t.textMuted, fontSize: 13, fontWeight: 600,
                cursor: refreshing ? "not-allowed" : "pointer",
                opacity: refreshing ? 0.6 : 1, transition: "all 0.2s",
              }}
            >
              <RefreshCw size={13} style={{ animation: refreshing ? "spin 0.7s linear infinite" : "none" }} />
              Refresh
            </button>
          </div>
        </div>

        {/* Category filter tabs */}
        <div style={{
          display: "flex", gap: 6, flexWrap: "wrap",
          marginTop: 24, padding: "4px",
          background: t.bgSurface, border: `1px solid ${t.border}`,
          borderRadius: 14, width: "fit-content",
        }}>
          {CATEGORIES.map(cat => {
            const CatIcon = cat.icon;
            const active = activeCategory === cat.key;
            return (
              <button
                key={cat.key}
                onClick={() => setActiveCategory(cat.key)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 7,
                  padding: "8px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600,
                  border: active ? `1px solid ${cat.color}55` : "1px solid transparent",
                  background: active ? `${cat.color}18` : "transparent",
                  color: active ? cat.color : t.textMuted,
                  cursor: "pointer", transition: "all 0.2s",
                }}
              >
                <CatIcon size={13} />
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Feed */}
      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {[0, 1, 2, 3].map(i => <SkeletonCard key={i} t={t} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          background: t.bgCard, border: `1px solid ${t.border}`,
          borderRadius: 16, padding: "60px 24px",
          textAlign: "center",
        }}>
          <Rss size={32} color={t.textDim} style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: t.white, marginBottom: 8 }}>Feed loading…</div>
          <div style={{ fontSize: 13, color: t.textMuted }}>
            {backendDown
              ? "The backend is offline. Sample items will appear shortly."
              : "No items found for this category yet. Check back soon."}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {filtered.map(item => (
            <FeedCard
              key={item.id}
              item={item}
              t={t}
              connected={connected}
              address={address}
              showModal={openWalletFn}
            />
          ))}
        </div>
      )}

      {/* Footer hint */}
      {!loading && filtered.length > 0 && (
        <div style={{
          marginTop: 32, textAlign: "center",
          fontSize: 12, color: t.textDim,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        }}>
          <RefreshCw size={11} />
          Auto-refreshes every 60 seconds
          {!connected && (
            <span>
              {" · "}
              <button
                onClick={openWalletFn}
                style={{ background: "none", border: "none", cursor: "pointer", color: t.accent, fontSize: 12, fontWeight: 600, padding: 0 }}
              >
                <Wallet size={11} style={{ verticalAlign: "middle", marginRight: 3 }} />
                Connect wallet to vote &amp; comment
              </button>
            </span>
          )}
        </div>
      )}

      {/* Spin keyframe */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </Section>
  );
}
