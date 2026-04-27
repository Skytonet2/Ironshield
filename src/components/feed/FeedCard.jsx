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

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, Repeat2, Heart, DollarSign, Eye, VolumeX, Shield, CheckCircle2, Send, ChevronDown, ChevronUp, MoreHorizontal, Trash2, Flag, Share2, Quote, Copy, Check } from "lucide-react";
import { useTheme } from "@/lib/contexts";
import useImpression from "@/lib/hooks/useImpression";
import CoinItButton from "./CoinItButton";
import Avatar from "./Avatar";

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

// Extension sniff — sidesteps needing a `kind` field in the post
// schema. Known video MIMEs map to <video>, everything else stays as
// <img>. Empty/unknown → <img> with onError hiding, so bad URLs never
// leave an ugly broken icon.
const VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;

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
      {urls.slice(0, 4).map((u, i) => {
        const isVideo = VIDEO_RE.test(String(u));
        const sharedStyle = {
          width: "100%",
          maxHeight: urls.length === 1 ? 420 : 220,
          objectFit: "cover",
          borderRadius: 10,
          border: `1px solid ${t.border}`,
          background: "#0b0f17",
        };
        if (isVideo) {
          return (
            <video
              key={i}
              src={u}
              controls
              playsInline
              preload="metadata"
              style={sharedStyle}
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          );
        }
        return (
          <img
            key={i}
            src={u}
            alt=""
            loading="lazy"
            style={sharedStyle}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        );
      })}
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

export default function FeedCard({ post, viewer, isOwn, onLike, onRepost, onQuote, onTip, onReply, onMute, onDelete }) {
  const t = useTheme() || {};
  // viewer can arrive in two shapes depending on the caller:
  //   - the WalletCtx object (address field, used by /feed/page.js)
  //   - a server user row ({ wallet_address, username, ... }, used by
  //     IronFeedPage legacy call sites).
  // Without this fallback the impression POST silently lands with
  // viewerWallet=null and the backend bails with skipped:"no-wallet",
  // so every card's "views" counter stays stuck at 0.
  const nodeRef = useImpression({
    postId: post?.id,
    isOwn: !!isOwn,
    viewerWallet: viewer?.wallet_address || viewer?.address || null,
  });
  // Defensive: if the backend returns `null` as a post row (very
  // occasionally happens on cursor-boundary hydration), render
  // nothing instead of crashing on post.author. Same for viewer
  // with no wallet — profile links still work, just route to the
  // username instead of address.
  if (!post) return null;

  // Reddit-style inline reply. Click the Reply metric → textarea slides
  // open below the post; Enter (or the send button) fires onReply(text)
  // back to the feed which posts to /api/social/comment and bumps the
  // local counter.
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const submitReply = useCallback(async () => {
    const text = replyText.trim();
    if (!text || !onReply) return;
    setReplyBusy(true);
    try {
      await Promise.resolve(onReply(text));
      setReplyText("");
      setReplyOpen(false);
    } finally {
      setReplyBusy(false);
    }
  }, [replyText, onReply]);

  const author = post?.author || {};
  const isAgent    = author?.account_type === "AGENT";
  const isVerified = !!author?.verified;
  const isNewsBot  = author?.wallet_address === "sys:ironnews";
  const isXCross   = author?.account_type === "X" || author?.username?.startsWith("x/");
  // A post is a Voice when the composer flagged it as one (media_type
  // mirrored via the "mediaType" field on the API) or when the legacy
  // "kind" field is set to "voice". Voices render inline with everything
  // else in the feed but carry a visible label.
  const isVoice = post?.mediaType === "VOICE" || post?.media_type === "VOICE" || post?.kind === "voice";

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
          href={author?.wallet_address
              ? `/profile?address=${encodeURIComponent(author.wallet_address)}`
              : `/profile?username=${encodeURIComponent(author?.username || "")}`}
          style={{ display: "block" }}
        >
          <Avatar
            src={author?.pfp_url}
            alt={author?.username || ""}
            size={40}
            fallbackText={author?.display_name || author?.username || "?"}
            fallbackBg="var(--accent-dim)"
            fallbackColor={t.accent}
          />
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
        {/* Header row — display name, handle, and timestamp are all
            wrapped in links to the author's profile so tapping anywhere
            in the identity cluster routes there, like Twitter. */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <a
            href={author?.wallet_address
              ? `/profile?address=${encodeURIComponent(author.wallet_address)}`
              : `/profile?username=${encodeURIComponent(author?.username || "")}`}
            style={{ color: t.white, fontWeight: 700, fontSize: 13, textDecoration: "none" }}
          >
            {author?.display_name || author?.username || "anon"}
          </a>
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
          {isVoice && (
            <span style={{
              fontSize: 9, padding: "1px 5px", borderRadius: 4,
              background: "rgba(168,85,247,0.18)", color: "#c084fc",
              letterSpacing: 0.6, textTransform: "uppercase",
              display: "inline-flex", alignItems: "center", gap: 3,
            }} title="Voice post — a short take from the author">
              VOICE
            </span>
          )}
          <a
            href={author?.wallet_address
              ? `/profile?address=${encodeURIComponent(author.wallet_address)}`
              : `/profile?username=${encodeURIComponent(author?.username || "")}`}
            style={{ color: t.textMuted, fontSize: 12, textDecoration: "none" }}
          >
            @{author?.username || "unknown"}
          </a>
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
          <CardActionsMenu
            t={t}
            isOwn={isOwn}
            author={author}
            onMute={onMute}
            onDelete={onDelete && isOwn ? () => onDelete(post) : null}
          />
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

        {/* Content — click-to-open routes to the full post view. Only
            native posts (numeric id); X-sourced tweets ("x:123...") link
            out via their existing entity-pill handling. We use onClick
            + cursor:pointer rather than wrapping in an <a> because the
            content already has nested anchors (entity pills, mentions,
            hashtags) and nested <a> elements are an HTML spec no-no.
            The handler early-returns if the user tapped an inner link
            or button, so mentions / pills keep working. */}
        {(() => {
          const openable = post?.id != null && !String(post.id).startsWith("x:");
          const go = (e) => {
            if (!openable) return;
            if (e.target.closest && e.target.closest("a, button, input, textarea")) return;
            e.preventDefault();
            window.location.href = `/post/?id=${encodeURIComponent(post.id)}`;
          };
          return (
            <div
              role={openable ? "link" : undefined}
              tabIndex={openable ? 0 : undefined}
              onClick={go}
              onKeyDown={(e) => { if (openable && (e.key === "Enter" || e.key === " ")) go(e); }}
              style={{ cursor: openable ? "pointer" : "default" }}
            >
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
            </div>
          );
        })()}

        {/* Embedded quoted post — only renders when this post is a
            quote (post.quotedPost set by hydratePosts). Clickable: tapping
            anywhere on the embed opens the original post's detail view. */}
        {post?.quotedPost && <QuotedEmbed quoted={post.quotedPost} t={t} />}

        {/* Metrics */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          marginTop: 10,
          marginLeft: -8,
        }}>
          <Metric Icon={Eye}          label="Impressions" count={post?.impressions} t={t} />
          <Metric Icon={MessageCircle} label="Reply"       count={post?.comments}    onClick={() => setReplyOpen((v) => !v)} active={replyOpen} color={t.accent} t={t} />
          <RepostMenu
            count={post?.reposts}
            active={post?.repostedByMe}
            onRepost={onRepost}
            onQuote={onQuote ? () => onQuote(post) : null}
            t={t}
          />
          <Metric Icon={Heart}        label="Likes"       count={post?.likes}       onClick={onLike}   active={post?.likedByMe}    color="var(--red)"   t={t} />
          <Metric Icon={DollarSign}   label={`Tips${post?.tipTotalUsd ? ` · $${post.tipTotalUsd.toFixed(2)}` : ""}`}
                  count={post?.tipCount}    onClick={onTip}   color={t.accent} t={t} />
          <ShareButton post={post} t={t} />
        </div>

        {/* Reddit-style inline reply — shows below the post when the
            Reply metric is tapped. Enter submits (Shift+Enter for
            newlines). Counter on the post bumps via onReply.*/}
        {replyOpen && (
          <div style={{
            marginTop: 8,
            padding: 10,
            borderRadius: 10,
            border: `1px solid ${t.border}`,
            background: "var(--bg-surface)",
          }}>
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value.slice(0, 500))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitReply(); }
                if (e.key === "Escape") { setReplyOpen(false); setReplyText(""); }
              }}
              placeholder={`Reply to @${author?.username || "user"}…`}
              rows={2}
              autoFocus
              style={{
                width: "100%", resize: "vertical", minHeight: 52,
                padding: 8, borderRadius: 8,
                border: `1px solid ${t.border}`, background: "var(--bg-input)",
                color: t.text, fontSize: 13, fontFamily: "inherit", outline: "none",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <span style={{ fontSize: 11, color: t.textDim }}>
                {replyText.length}/500 · Enter to send · Shift+Enter for newline
              </span>
              <div style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => { setReplyOpen(false); setReplyText(""); }}
                style={{
                  padding: "6px 10px", borderRadius: 6,
                  border: `1px solid ${t.border}`, background: "transparent",
                  color: t.textMuted, fontSize: 12, cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={replyBusy || !replyText.trim()}
                onClick={submitReply}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "6px 12px", borderRadius: 6, border: "none",
                  background: t.accent, color: "#fff",
                  fontSize: 12, fontWeight: 700, cursor: replyBusy ? "wait" : "pointer",
                  opacity: (replyBusy || !replyText.trim()) ? 0.5 : 1,
                }}
              >
                <Send size={11} />
                {replyBusy ? "Posting…" : "Reply"}
              </button>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        article:hover :global(button[title="Launch this as a token"]) {
          opacity: 1 !important;
        }
      `}</style>
    </article>
  );
}

// Kebab menu on the top-right of each card. Surfaces "Delete" for
// posts the viewer owns, "Mute @user" + "Report" for everyone else's.
// Previously mute was the only affordance and was hidden in a
// nearly-invisible icon; this exposes all three at once.
function CardActionsMenu({ t, isOwn, author, onMute, onDelete }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const handleDelete = async () => {
    if (!onDelete) return;
    if (!window.confirm("Delete this post? This cannot be undone.")) return;
    setBusy(true);
    try { await onDelete(); setOpen(false); }
    finally { setBusy(false); }
  };

  const handleMute = () => {
    if (!onMute || !author?.username) return;
    onMute(author.username);
    setOpen(false);
  };

  const items = [];
  if (isOwn && onDelete) {
    items.push({ key: "delete", label: busy ? "Deleting…" : "Delete post", Icon: Trash2, color: "var(--red)", onClick: handleDelete, disabled: busy });
  }
  if (!isOwn && onMute && author?.username) {
    items.push({ key: "mute", label: `Mute @${author.username}`, Icon: VolumeX, onClick: handleMute });
  }
  if (!isOwn) {
    items.push({ key: "report", label: "Report post", Icon: Flag, onClick: () => { alert("Thanks — reporting flow lands next pass."); setOpen(false); } });
  }
  if (items.length === 0) return null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-label="Post actions"
        aria-expanded={open}
        style={{
          background: "transparent", border: "none",
          color: open ? t.accent : t.textDim,
          cursor: "pointer", padding: 4,
          borderRadius: 6,
          opacity: open ? 1 : 0.65,
          transition: "opacity 120ms ease, color 120ms ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
        onMouseLeave={(e) => { if (!open) e.currentTarget.style.opacity = "0.65"; }}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute", top: "calc(100% + 4px)", right: 0,
            minWidth: 180,
            background: "var(--bg-surface)",
            border: `1px solid ${t.border}`,
            borderRadius: 8,
            boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
            zIndex: 20, overflow: "hidden",
          }}
        >
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              disabled={it.disabled}
              onClick={it.onClick}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 8,
                padding: "8px 10px", border: "none", background: "transparent",
                color: it.color || t.text, fontSize: 12,
                cursor: it.disabled ? "wait" : "pointer", textAlign: "left",
              }}
              onMouseEnter={(e) => { if (!it.disabled) e.currentTarget.style.background = "var(--bg-card-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <it.Icon size={12} />
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Embedded quoted post — small, clickable, links to /post?id=<id>. */
function QuotedEmbed({ quoted, t }) {
  if (!quoted) return null;
  const author = quoted.author || {};
  const name   = author.display_name || author.username || "—";
  const handle = author.username ? `@${author.username}` : null;
  const href   = `/post?id=${encodeURIComponent(quoted.id)}`;
  return (
    <a
      href={href}
      onClick={(e) => e.stopPropagation()}
      style={{
        display: "block",
        marginTop: 10,
        padding: 10,
        borderRadius: 10,
        border: `1px solid ${t.border}`,
        background: "var(--bg-input)",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        {author.pfp_url ? (
          <img src={author.pfp_url} alt="" width={20} height={20}
               style={{ borderRadius: "50%", objectFit: "cover" }}
               onError={(e) => { e.currentTarget.style.visibility = "hidden"; }} />
        ) : (
          <div style={{
            width: 20, height: 20, borderRadius: "50%",
            background: `linear-gradient(135deg, #a855f7, ${t.accent})`,
            color: "#fff", fontSize: 10, fontWeight: 800,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>{(name[0] || "?").toUpperCase()}</div>
        )}
        <span style={{ fontSize: 12, fontWeight: 700, color: t.white }}>{name}</span>
        {handle && <span style={{ fontSize: 11, color: t.textDim }}>{handle}</span>}
      </div>
      <div style={{
        fontSize: 13, color: t.text, lineHeight: 1.45,
        whiteSpace: "pre-wrap", wordBreak: "break-word",
        display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden",
      }}>
        {quoted.content}
      </div>
      {Array.isArray(quoted.mediaUrls) && quoted.mediaUrls.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: t.textDim }}>
          [{quoted.mediaUrls.length} attached]
        </div>
      )}
    </a>
  );
}

/** Repost button with a menu: plain Repost or Quote. Closes on outside click.
 *  The menu is rendered into a portal on document.body so it escapes
 *  the per-card stacking context that framer-motion's <m.div> creates
 *  via transform/will-change — without the portal, the next FeedCard
 *  paints on top of the menu's text. */
function RepostMenu({ count, active, onRepost, onQuote, t }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);

  // Compute the menu's screen position from the trigger button. Re-measures
  // on open + on scroll/resize so the dropdown follows the trigger.
  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left });
  }, []);
  useEffect(() => {
    if (!open) return;
    place();
    const onScroll = () => place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, place]);

  // Outside click: include the trigger as well as the portal'd menu in
  // the "inside" check (the portal child isn't inside triggerRef).
  const menuRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      const t1 = triggerRef.current, m = menuRef.current;
      if (t1 && t1.contains(e.target)) return;
      if (m && m.contains(e.target))   return;
      setOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  if (!onQuote) {
    return (
      <Metric Icon={Repeat2} label="Reposts" count={count} onClick={onRepost} active={active} color="var(--green)" t={t} />
    );
  }

  const menu = open && pos && typeof document !== "undefined" && createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: "fixed", top: pos.top, left: pos.left, zIndex: 9999,
        minWidth: 160,
        background: t.bgCardHover || t.bgCard || "#141a2e",
        border: `1px solid ${t.accent || "rgba(255,255,255,0.18)"}`,
        borderRadius: 10,
        boxShadow: "0 16px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.4)",
        overflow: "hidden",
      }}
    >
      <MenuItem t={t} onClick={() => { setOpen(false); onRepost?.(); }}>
        <Repeat2 size={14} />
        <span>{active ? "Undo repost" : "Repost"}</span>
      </MenuItem>
      <MenuItem t={t} onClick={() => { setOpen(false); onQuote?.(); }}>
        <Quote size={14} />
        <span>Quote</span>
      </MenuItem>
    </div>,
    document.body,
  );

  return (
    <>
      <div ref={triggerRef} style={{ position: "relative", display: "inline-flex" }}>
        <Metric
          Icon={Repeat2}
          label="Reposts"
          count={count}
          onClick={(e) => { e?.stopPropagation?.(); setOpen((v) => !v); }}
          active={active}
          color="var(--green)"
          t={t}
        />
      </div>
      {menu}
    </>
  );
}

function menuItemStyle(t) {
  return {
    display: "flex", alignItems: "center", gap: 10,
    width: "100%", padding: "10px 12px",
    background: "transparent", border: "none",
    color: t.text, fontSize: 13, textAlign: "left",
    cursor: "pointer",
    transition: "background 100ms ease",
  };
}

// Tiny hover-aware menu button. Prevents the user wondering whether
// the row is interactive — the bg-shift on hover answers it.
function MenuItem({ t, onClick, children }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...menuItemStyle(t), background: hover ? "var(--bg-card-hover)" : "transparent" }}
    >
      {children}
    </button>
  );
}

/** Share button — Web Share API on mobile, clipboard fallback. Briefly
 *  swaps icon to a checkmark on success so the user has feedback. */
function ShareButton({ post, t }) {
  const [copied, setCopied] = useState(false);
  const url = useMemo(() => {
    if (typeof window === "undefined" || !post?.id) return "";
    return `${window.location.origin}/post?id=${encodeURIComponent(post.id)}`;
  }, [post?.id]);

  const onClick = useCallback(async (e) => {
    e?.stopPropagation?.();
    if (!url) return;
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: "IronShield post",
          text: post?.content ? String(post.content).slice(0, 120) : "",
          url,
        });
        return;
      } catch { /* user cancelled or share failed — fall through to clipboard */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard blocked — last resort: open the URL in a new tab */
      try { window.open(url, "_blank", "noopener"); } catch {}
    }
  }, [url, post?.content]);

  return (
    <Metric
      Icon={copied ? Check : Share2}
      label="Share"
      count={null}
      onClick={onClick}
      active={copied}
      color={t.accent}
      t={t}
    />
  );
}
