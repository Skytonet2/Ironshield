"use client";
// FeedCard — the new denser card for Phase 4-2.
//
// Spec §8B:
//   - left avatar (40px)
//   - top row: [DisplayName] @handle · [time] ... ⚡ Coin It (hover)
//   - content (auto-highlight $TICKER and CAs for Alpha-adjacent feel)
//   - media grid (1 / 2 / 3+ layouts)
//   - bottom row: 👁 💬 🔁 ❤️ 💰 — icon + count, label on hover
//   - glass card; 8px gap between cards, no hard divider
//
// Also wires useImpression so counting lives wherever cards live —
// no separate plumbing from each consumer.

import { useMemo } from "react";
import { MessageCircle, Repeat2, Heart, DollarSign, Eye, VolumeX, Shield, CheckCircle2 } from "lucide-react";
import { useTheme } from "@/lib/contexts";
import useImpression from "@/lib/hooks/useImpression";
import CoinItButton from "./CoinItButton";

function fmtCount(n) {
  const v = Number(n || 0);
  if (v < 1000) return String(v);
  if (v < 1_000_000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}K`;
  return `${(v / 1_000_000).toFixed(1)}M`;
}

function timeAgo(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60)    return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60)    return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24)    return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30)    return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Highlight $TICKER and CA-shaped substrings inside the content.
// Matches the Alpha tab's detection regex so visual + filter agree.
function renderContentWithHighlights(content, accent) {
  if (!content) return null;
  const re = /(\$[A-Z]{2,10}\b|\b[a-z0-9_-]+\.(?:near|tkn\.near)\b)/g;
  const parts = [];
  let last = 0;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) parts.push(content.slice(last, m.index));
    parts.push(
      <span key={m.index} style={{
        color: accent, fontWeight: 600,
        fontFamily: m[0].startsWith("$") ? "inherit" : "var(--font-jetbrains-mono), monospace",
      }}>
        {m[0]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push(content.slice(last));
  return parts.length ? parts : content;
}

function MediaGrid({ urls, t }) {
  if (!urls?.length) return null;
  const cols = urls.length === 1 ? "1fr" : "1fr 1fr";
  return (
    <div style={{
      marginTop: 10,
      display: "grid",
      gridTemplateColumns: cols,
      gap: 4,
    }}>
      {urls.slice(0, 4).map((u, i) => (
        <img
          key={i}
          src={u}
          alt=""
          loading="lazy"
          style={{
            width: "100%",
            maxHeight: urls.length === 1 ? 420 : 220,
            objectFit: "cover",
            borderRadius: 10,
            border: `1px solid ${t.border}`,
          }}
          onError={(e) => { e.currentTarget.style.display = "none"; }}
        />
      ))}
    </div>
  );
}

function Metric({ Icon, label, count, active, color, onClick, t }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 8px",
        borderRadius: 6,
        background: "transparent",
        border: "none",
        color: active ? color : t.textDim,
        fontSize: 12,
        fontFamily: "var(--font-jetbrains-mono), monospace",
        cursor: "pointer",
        transition: "color 120ms var(--ease-out), background 120ms var(--ease-out)",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-card-hover)"; e.currentTarget.style.color = color || t.text; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = active ? color : t.textDim; }}
    >
      <Icon size={13} />
      {fmtCount(count)}
    </button>
  );
}

export default function FeedCard({ post, viewer, isOwn, onLike, onRepost, onTip, onReply, onMute }) {
  const t = useTheme();
  const nodeRef = useImpression({
    postId: post?.id,
    isOwn: !!isOwn,
    viewerWallet: viewer?.wallet_address || null,
  });

  const author = post?.author || {};
  const isAgent    = author?.account_type === "AGENT";
  const isVerified = !!author?.verified;
  const isNewsBot  = author?.wallet_address === "sys:ironnews";
  const isXCross   = author?.account_type === "X" || author?.username?.startsWith("x/");

  const rendered = useMemo(
    () => renderContentWithHighlights(post?.content, t.accent),
    [post?.content, t.accent]
  );

  const coinItText = post?.title || post?.content || "";
  const coinItName = post?.title || (post?.content?.slice(0, 40) || "");

  return (
    <article
      ref={nodeRef}
      className="card feed-item-enter"
      style={{
        display: "flex",
        gap: 12,
        padding: "14px 16px",
        borderRadius: 12,
        background: "var(--bg-card)",
        border: `1px solid ${t.border}`,
      }}
    >
      {/* Avatar */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <a
          href={`/@${author?.username || ""}`}
          style={{ display: "block" }}
        >
          {author?.pfp_url ? (
            <img
              src={author.pfp_url}
              alt={author?.username || ""}
              width={40}
              height={40}
              style={{ borderRadius: "50%", objectFit: "cover", background: "var(--bg-input)" }}
              onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
            />
          ) : (
            <div style={{
              width: 40, height: 40, borderRadius: "50%",
              background: "var(--accent-dim)", color: t.accent,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 700, fontSize: 14,
            }}>
              {(author?.display_name || author?.username || "?")[0]?.toUpperCase()}
            </div>
          )}
        </a>
        {isXCross && (
          <span
            title="Cross-posted from X"
            style={{
              position: "absolute",
              bottom: -4, right: -4,
              width: 16, height: 16,
              borderRadius: "50%",
              background: t.bg,
              border: `1px solid ${t.border}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 9, fontWeight: 700, color: t.textMuted,
            }}
          >
            𝕏
          </span>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ color: t.white, fontWeight: 700, fontSize: 13 }}>
            {author?.display_name || author?.username || "anon"}
          </span>
          {isVerified && (
            <CheckCircle2
              size={13}
              style={{ color: t.accent }}
              aria-label="verified"
            />
          )}
          {isAgent && (
            <span style={{
              fontSize: 9, padding: "1px 5px", borderRadius: 4,
              background: "var(--accent-dim)", color: t.accent,
              letterSpacing: 0.6, textTransform: "uppercase",
              display: "inline-flex", alignItems: "center", gap: 3,
            }}>
              <Shield size={9} /> {isNewsBot ? "NEWS" : "AGENT"}
            </span>
          )}
          <span style={{ color: t.textMuted, fontSize: 12 }}>
            @{author?.username || "unknown"}
          </span>
          <span style={{ color: t.textDim, fontSize: 12 }}>· {timeAgo(post?.createdAt)}</span>

          <span style={{ flex: 1 }} />

          {/* Hover-revealed Coin It */}
          <CoinItButton
            sourceType="post"
            sourcePostId={post?.id}
            sourceText={coinItText}
            suggestedName={coinItName}
            style={{ opacity: 0, transition: "opacity 120ms var(--ease-out)" }}
          />
          {onMute && author?.username && (
            <button
              type="button"
              onClick={() => onMute(author.username)}
              title={`Mute @${author.username}`}
              style={{
                background: "transparent", border: "none",
                color: t.textDim, cursor: "pointer", padding: 4,
                opacity: 0.6,
              }}
            >
              <VolumeX size={13} />
            </button>
          )}
        </div>

        {/* Title (for article kind) */}
        {post?.kind === "article" && post?.title && (
          <h3 style={{
            margin: "6px 0 2px",
            fontSize: 15,
            fontWeight: 600,
            color: t.white,
            lineHeight: 1.3,
          }}>
            {post.title}
          </h3>
        )}

        {/* Content */}
        <div style={{
          color: t.text,
          fontSize: 14,
          lineHeight: 1.45,
          marginTop: 4,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}>
          {rendered}
        </div>

        <MediaGrid urls={post?.mediaUrls} t={t} />

        {/* Metrics */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          marginTop: 10,
          marginLeft: -8,
        }}>
          <Metric Icon={Eye}          label="Impressions" count={post?.impressions} t={t} />
          <Metric Icon={MessageCircle} label="Replies"     count={post?.comments}    onClick={onReply}  t={t} />
          <Metric Icon={Repeat2}      label="Reposts"     count={post?.reposts}     onClick={onRepost} active={post?.repostedByMe} color="var(--green)" t={t} />
          <Metric Icon={Heart}        label="Likes"       count={post?.likes}       onClick={onLike}   active={post?.likedByMe}    color="var(--red)"   t={t} />
          <Metric Icon={DollarSign}   label={`Tips${post?.tipTotalUsd ? ` · $${post.tipTotalUsd.toFixed(2)}` : ""}`}
                  count={post?.tipCount}    onClick={onTip}   color={t.accent} t={t} />
        </div>
      </div>

      <style jsx>{`
        article:hover :global(button[title="Launch this as a token"]) {
          opacity: 1 !important;
        }
      `}</style>
    </article>
  );
}
