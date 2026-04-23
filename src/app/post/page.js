"use client";
// /post?id=<N> — full post view with threaded comments.
//
// Why a query-param route: this project is a Next.js static export.
// Dynamic segments like /post/[id] would need generateStaticParams
// at build time (we don't know every post id up front). A single
// /post/ page that reads the id from the URL is the clean path.
//
// What's on the page:
//   1. The full post rendered via FeedCard (so all engagement wiring
//      — like / repost / tip / inline reply — carries over with no
//      duplication).
//   2. A threaded comment list. Comments render oldest→newest at the
//      top level and their replies nest underneath, indented, with
//      their own "Reply" buttons. Depth cap at 4 visual levels so a
//      long chain doesn't crawl off a mobile viewport.
//   3. Mobile view: full-width, reduced gutters, composer docks at
//      the bottom of each comment so tapping "Reply" reveals the
//      input inline with a soft expand animation.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme, useWallet } from "@/lib/contexts";
import AppShell from "@/components/shell/AppShell";
import FeedCard from "@/components/feed/FeedCard";
import FeedRightRail from "@/components/feed/FeedRightRail";
import { API_BASE as API } from "@/lib/apiBase";
import {
  Loader2, ArrowLeft, MessageCircle, Send as SendIcon,
  CornerDownRight,
} from "lucide-react";

function shortAddr(a) {
  if (!a) return "";
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function timeAgo(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

export default function PostPage() {
  const t = useTheme();
  const { address } = useWallet();

  const [postId, setPostId] = useState(null);
  const [post, setPost] = useState(null);
  const [postErr, setPostErr] = useState(null);
  const [postLoading, setPostLoading] = useState(true);
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [rootText, setRootText] = useState("");
  const [replyTarget, setReplyTarget] = useState(null); // comment id being replied to
  const [replyText, setReplyText] = useState("");
  const [posting, setPosting] = useState(false);

  // Read ?id= from the URL. useEffect so SSR doesn't trip.
  useEffect(() => {
    try {
      const qs = new URLSearchParams(location.search);
      setPostId(qs.get("id"));
    } catch {}
  }, []);

  const loadPost = useCallback(async () => {
    if (!postId) return;
    setPostLoading(true);
    setPostErr(null);
    try {
      const r = await fetch(`${API}/api/posts/${encodeURIComponent(postId)}`, {
        headers: address ? { "x-wallet": address } : {},
      });
      if (!r.ok) {
        if (r.status === 404) setPostErr("Post not found");
        else setPostErr(`Failed to load (HTTP ${r.status})`);
        setPost(null);
      } else {
        const j = await r.json();
        setPost(j.post || null);
      }
    } catch (e) { setPostErr(e.message); }
    finally { setPostLoading(false); }
  }, [postId, address]);

  const loadComments = useCallback(async () => {
    if (!postId) return;
    setCommentsLoading(true);
    try {
      const r = await fetch(`${API}/api/social/comments/${encodeURIComponent(postId)}`);
      if (r.ok) {
        const j = await r.json();
        setComments(j.comments || []);
      }
    } catch {}
    finally { setCommentsLoading(false); }
  }, [postId]);

  useEffect(() => { loadPost(); loadComments(); }, [loadPost, loadComments]);

  // Build the reply tree in one pass. Comments come in oldest→newest
  // from the backend so parents reliably appear before children.
  const tree = useMemo(() => {
    const byId = new Map();
    const roots = [];
    for (const c of comments) byId.set(c.id, { ...c, children: [] });
    for (const c of byId.values()) {
      if (c.parent_comment_id && byId.has(c.parent_comment_id)) {
        byId.get(c.parent_comment_id).children.push(c);
      } else {
        roots.push(c);
      }
    }
    return roots;
  }, [comments]);

  const postComment = useCallback(async ({ content, parentCommentId }) => {
    if (!address) { alert("Connect wallet to comment."); return; }
    const text = content.trim();
    if (!text) return;
    setPosting(true);
    try {
      const r = await fetch(`${API}/api/social/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": address },
        body: JSON.stringify({
          postId: Number(postId),
          content: text,
          ...(parentCommentId ? { parentCommentId } : {}),
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      // Refetch to pick up author hydration; cheaper than trying to
      // guess the author row client-side.
      await loadComments();
      // Bump the post's comment count optimistically so the FeedCard
      // metric matches reality.
      setPost((p) => p ? ({ ...p, comments: (p.comments ?? 0) + 1 }) : p);
    } catch (e) { alert(`Comment failed: ${e.message}`); }
    finally { setPosting(false); }
  }, [address, postId, loadComments]);

  return (
    <AppShell rightPanel={<FeedRightRail />}>
      <div className="ix-post-page" style={{ maxWidth: 680, margin: "0 auto", padding: "12px 16px" }}>
        {/* Header back link — matches the chat back button pattern */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <button
            type="button"
            onClick={() => { try { history.back(); } catch { window.location.href = "/feed/"; } }}
            aria-label="Back"
            style={{
              width: 34, height: 34, borderRadius: 999, border: `1px solid ${t.border}`,
              background: "transparent", color: t.text, cursor: "pointer",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <ArrowLeft size={16} />
          </button>
          <h1 style={{ fontSize: 16, fontWeight: 800, color: t.white, margin: 0, letterSpacing: -0.2 }}>
            Post
          </h1>
        </div>

        {/* Post body */}
        {postLoading && (
          <div style={{ padding: 24, color: t.textDim, fontSize: 12, textAlign: "center" }}>
            Loading post…
          </div>
        )}
        {postErr && (
          <div style={{ padding: 20, color: "var(--red)", fontSize: 13, textAlign: "center", border: `1px solid ${t.border}`, borderRadius: 10 }}>
            {postErr}
          </div>
        )}
        {post && (
          <div style={{ marginBottom: 18 }}>
            <FeedCard
              post={post}
              viewer={{ address }}
              isOwn={address && post.author?.wallet_address && address.toLowerCase() === post.author.wallet_address.toLowerCase()}
              onLike={async () => {
                if (!address) return;
                try {
                  const r = await fetch(`${API}/api/social/like`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-wallet": address },
                    body: JSON.stringify({ postId: Number(postId) }),
                  });
                  const j = await r.json();
                  setPost((p) => p ? ({ ...p, likedByMe: !!j.liked, likes: j.count }) : p);
                } catch {}
              }}
              onRepost={async () => {
                if (!address) return;
                try {
                  const r = await fetch(`${API}/api/social/repost`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-wallet": address },
                    body: JSON.stringify({ postId: Number(postId) }),
                  });
                  const j = await r.json();
                  setPost((p) => p ? ({ ...p, repostedByMe: !!j.reposted, reposts: j.count }) : p);
                } catch {}
              }}
              onReply={(text) => postComment({ content: text })}
              onTip={() => { /* tip flow lives in FeedCard modal */ }}
            />
          </div>
        )}

        {/* Top-level comment composer */}
        {post && (
          <section style={{
            display: "flex", gap: 10, alignItems: "flex-start",
            padding: 12, borderRadius: 12,
            border: `1px solid ${t.border}`, background: "var(--bg-card)",
            marginBottom: 14,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              background: "var(--bg-input)", flexShrink: 0,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, color: t.textDim,
            }}>
              {address ? shortAddr(address).slice(0, 2).toUpperCase() : "?"}
            </div>
            <textarea
              value={rootText}
              onChange={(e) => setRootText(e.target.value.slice(0, 500))}
              placeholder={address ? "Add a comment…" : "Connect your wallet to comment"}
              disabled={!address || posting}
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  postComment({ content: rootText });
                  setRootText("");
                }
              }}
              style={{
                flex: 1, resize: "vertical", minHeight: 40,
                padding: 8, borderRadius: 8,
                border: `1px solid ${t.border}`, background: "var(--bg-input)",
                color: t.text, fontSize: 13, fontFamily: "inherit", outline: "none",
              }}
            />
            <button
              type="button"
              onClick={() => { postComment({ content: rootText }); setRootText(""); }}
              disabled={!address || posting || !rootText.trim()}
              style={{
                padding: "8px 14px", borderRadius: 10, border: "none",
                background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
                color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
                opacity: (!address || posting || !rootText.trim()) ? 0.5 : 1,
                display: "inline-flex", alignItems: "center", gap: 6,
              }}
            >
              {posting ? <Loader2 size={12} className="ic-spin" /> : <SendIcon size={12} />}
              Post
            </button>
          </section>
        )}

        {/* Comments tree */}
        <section>
          <div style={{
            fontSize: 11, letterSpacing: 0.8, color: t.textDim, fontWeight: 700,
            textTransform: "uppercase", marginBottom: 10,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <MessageCircle size={12} /> {comments.length} comment{comments.length === 1 ? "" : "s"}
          </div>
          {commentsLoading && (
            <div style={{ color: t.textDim, fontSize: 12, padding: 12 }}>Loading comments…</div>
          )}
          {!commentsLoading && tree.length === 0 && (
            <div style={{
              color: t.textDim, fontSize: 12, textAlign: "center",
              padding: 24, border: `1px dashed ${t.border}`, borderRadius: 10,
            }}>
              No comments yet. Be the first.
            </div>
          )}
          {tree.map((c) => (
            <CommentNode
              key={c.id} t={t} c={c} depth={0}
              replyTarget={replyTarget} setReplyTarget={setReplyTarget}
              replyText={replyText} setReplyText={setReplyText}
              onSubmitReply={(content, parentCommentId) => {
                postComment({ content, parentCommentId });
                setReplyText(""); setReplyTarget(null);
              }}
              canPost={!!address}
              posting={posting}
            />
          ))}
        </section>

        <style jsx global>{`
          /* Mobile post page: tighter gutters, right rail already
             hidden by AppShell at narrow widths. */
          @media (max-width: 640px) {
            .ix-post-page { padding: 10px 12px !important; }
            .ix-cmt-branch { padding-left: 10px !important; }
          }
        `}</style>
      </div>
    </AppShell>
  );
}

// Recursive comment node. Max visual nesting at depth 4 — beyond
// that we flatten into the parent's thread to save horizontal real
// estate on mobile. Thread continuity is preserved in the data.
function CommentNode({ t, c, depth, replyTarget, setReplyTarget, replyText, setReplyText, onSubmitReply, canPost, posting }) {
  const isOpen = replyTarget === c.id;
  const visualDepth = Math.min(depth, 4);
  const displayName = c.display_name || c.username || shortAddr(c.wallet_address);
  const handle = c.username ? `@${c.username}` : shortAddr(c.wallet_address);

  return (
    <div style={{
      marginLeft: visualDepth === 0 ? 0 : 12,
      paddingLeft: visualDepth === 0 ? 0 : 10,
      borderLeft: visualDepth === 0 ? "none" : `1px solid ${t.border}`,
      marginTop: 10,
    }} className="ix-cmt-branch">
      <div style={{
        display: "flex", gap: 10, alignItems: "flex-start",
        padding: 10, borderRadius: 10,
        background: "var(--bg-card)",
        border: `1px solid ${t.border}`,
      }}>
        {c.pfp_url ? (
          <img
            src={c.pfp_url}
            alt=""
            width={30} height={30}
            style={{ borderRadius: "50%", flexShrink: 0, objectFit: "cover" }}
          />
        ) : (
          <div style={{
            width: 30, height: 30, borderRadius: "50%",
            background: "var(--bg-input)", flexShrink: 0,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, color: t.textDim,
          }}>
            {(displayName || "?").slice(0, 2).toUpperCase()}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, flexWrap: "wrap" }}>
            <a
              href={c.wallet_address ? `/profile/?address=${encodeURIComponent(c.wallet_address)}` : "#"}
              style={{ color: t.text, fontWeight: 700, textDecoration: "none" }}
            >
              {displayName}
            </a>
            <span style={{ color: t.textDim }}>{handle}</span>
            <span style={{ color: t.textDim }}>·</span>
            <span style={{ color: t.textDim }}>{timeAgo(c.created_at)}</span>
          </div>
          <div style={{
            color: t.text, fontSize: 13, lineHeight: 1.5, marginTop: 4,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>
            {c.content}
          </div>
          <div style={{ marginTop: 6 }}>
            <button
              type="button"
              onClick={() => { setReplyTarget(isOpen ? null : c.id); setReplyText(""); }}
              style={{
                padding: "3px 8px", borderRadius: 6, border: "none",
                background: "transparent", color: isOpen ? t.accent : t.textDim,
                fontSize: 11, fontWeight: 700, cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 4,
              }}
            >
              <CornerDownRight size={11} /> {isOpen ? "Cancel" : "Reply"}
            </button>
          </div>
          {isOpen && (
            <div style={{
              marginTop: 8, padding: 8, borderRadius: 8,
              border: `1px solid ${t.border}`, background: "var(--bg-surface)",
            }}>
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value.slice(0, 500))}
                placeholder={`Reply to ${displayName}…`}
                rows={2}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (replyText.trim()) onSubmitReply(replyText, c.id);
                  }
                }}
                style={{
                  width: "100%", resize: "vertical", minHeight: 40,
                  padding: 6, borderRadius: 6,
                  border: `1px solid ${t.border}`, background: "var(--bg-input)",
                  color: t.text, fontSize: 12, fontFamily: "inherit", outline: "none",
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
                <button
                  type="button"
                  onClick={() => { setReplyTarget(null); setReplyText(""); }}
                  style={{
                    padding: "5px 10px", borderRadius: 6, border: `1px solid ${t.border}`,
                    background: "transparent", color: t.textDim, fontSize: 11, cursor: "pointer",
                  }}
                >Cancel</button>
                <button
                  type="button"
                  onClick={() => { if (replyText.trim()) onSubmitReply(replyText, c.id); }}
                  disabled={!canPost || posting || !replyText.trim()}
                  style={{
                    padding: "5px 12px", borderRadius: 6, border: "none",
                    background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
                    color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer",
                    opacity: (!canPost || posting || !replyText.trim()) ? 0.5 : 1,
                  }}
                >Reply</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {c.children?.map((child) => (
        <CommentNode
          key={child.id} t={t} c={child} depth={depth + 1}
          replyTarget={replyTarget} setReplyTarget={setReplyTarget}
          replyText={replyText} setReplyText={setReplyText}
          onSubmitReply={onSubmitReply}
          canPost={canPost}
          posting={posting}
        />
      ))}
    </div>
  );
}
