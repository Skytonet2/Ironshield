"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Heart, MessageCircle, Repeat2, Share2, Image as ImageIcon, Send, X,
  Search, Bell, User, MessageSquare, Sparkles, Star, Building2, Bot, Shield,
  Trash2, MoreHorizontal, Loader2, UserPlus, UserMinus, UserCheck, Link as LinkIcon,
  Smile, MapPin, Calendar, BarChart3, Home as HomeIcon, ArrowLeft,
} from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import { Btn } from "@/components/Primitives";
import { payNear, getAvailableNear, PLATFORM_TREASURY } from "@/lib/payments";

const API = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

/* Brand swap: Follow → Recruit · Following → Squad · Unfollow → Retire */
const FOLLOW   = "Recruit";
const FOLLOWED = "In Squad";
const UNFOLLOW = "Retire";

function api(path, { method = "GET", body, wallet, raw } = {}) {
  const headers = {};
  if (!raw) headers["content-type"] = "application/json";
  if (wallet) headers["x-wallet"] = wallet;
  return fetch(`${API}${path}`, {
    method, headers,
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  }).then(async r => {
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data;
  });
}
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
function inputStyle(t) {
  return { flex: 1, padding: "10px 14px", background: t.bgSurface, border: `1px solid ${t.border}`,
    color: t.text, borderRadius: 10, outline: "none", fontSize: 14 };
}
function chipStyle(color) {
  return { display: "inline-flex", alignItems: "center", gap: 4,
    padding: "2px 7px", borderRadius: 999, fontSize: 10, fontWeight: 700, color,
    background: `${color}18`, border: `1px solid ${color}44` };
}

function AccountChip({ type }) {
  const t = useTheme();
  if (!type || type === "HUMAN") return <span style={chipStyle(t.accent)}><Shield size={10} /> Human</span>;
  if (type === "AGENT") return <span style={chipStyle("#a855f7")}><Bot size={10} /> Agent</span>;
  return <span style={chipStyle("#eab308")}><Building2 size={10} /> Org</span>;
}

function Avatar({ user, size = 40 }) {
  const t = useTheme();
  if (user?.pfp_url || user?.pfpUrl) {
    return <img src={user.pfp_url || user.pfpUrl} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />;
  }
  const initial = (user?.display_name || user?.displayName || user?.username || "?")[0]?.toUpperCase();
  return (
    <div style={{ width: size, height: size, borderRadius: "50%",
      background: `linear-gradient(135deg, ${t.accent}, #0ea5e9)`,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#fff", fontWeight: 800, fontSize: size * 0.4, flexShrink: 0 }}>
      {initial}
    </div>
  );
}

/* ───────────────────── Compose (file picker) ──────────────────── */
const COMMON_EMOJI = ["😀","😂","🤣","😊","😍","🤩","😎","🤔","😭","😡","🔥","💯","🚀","💎","🎯","👀","👍","👎","🙏","❤️","💔","⚡","🌙","☀️","💰","📈","📉","🤝","✅","❌","⭐"];

function ComposePost({ wallet, onPosted, placeholder = "What's happening in IronShield?" }) {
  const t = useTheme();
  const fileRef = useRef(null);
  const taRef = useRef(null);
  const [content, setContent] = useState("");
  const [media, setMedia] = useState(null); // { url, type }
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [err, setErr] = useState("");
  const left = 500 - content.length;

  const pick = () => fileRef.current?.click();

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch(`${API}/api/media/upload`, { method: "POST", body: fd, headers: { "x-wallet": wallet || "" } });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "upload failed");
      setMedia({ url: data.url, type: data.type });
    } catch (err2) { setErr(`Upload failed: ${err2.message}`); }
    finally { setUploading(false); e.target.value = ""; }
  };

  const insertEmoji = (emo) => {
    const ta = taRef.current;
    const next = (content + emo).slice(0, 500);
    setContent(next);
    setEmojiOpen(false);
    setTimeout(() => ta?.focus(), 0);
  };

  const submit = async () => {
    if (!content.trim() || posting || !wallet) return;
    setPosting(true);
    setErr("");
    try {
      const body = { content };
      if (media) { body.mediaUrls = [media.url]; body.mediaType = media.type; }
      const r = await api("/api/posts", { method: "POST", wallet, body });
      onPosted?.(r.post);
      setContent(""); setMedia(null);
    } catch (e) { setErr(e.message.includes("500") || /internal/i.test(e.message) ? "Server error — the backend database may be offline. Please retry in a moment." : e.message); }
    finally { setPosting(false); }
  };

  return (
    <div style={{ borderBottom: `1px solid ${t.border}`, padding: "14px 18px" }}>
      <div style={{ display: "flex", gap: 12 }}>
        <Avatar user={{ username: wallet?.[0] || "I" }} size={44} />
        <div style={{ flex: 1 }}>
          <textarea
            ref={taRef}
            value={content}
            onChange={e => setContent(e.target.value.slice(0, 500))}
            placeholder={placeholder}
            rows={2}
            style={{ width: "100%", background: "transparent", border: "none", color: t.text,
              fontSize: 19, outline: "none", resize: "none", fontFamily: "inherit", padding: "8px 0" }}
          />
          {media && (
            <div style={{ position: "relative", marginTop: 6, borderRadius: 14, overflow: "hidden", border: `1px solid ${t.border}` }}>
              {media.type === "VIDEO"
                ? <video src={media.url} controls style={{ width: "100%", display: "block", maxHeight: 400 }} />
                : <img src={media.url} alt="" style={{ width: "100%", display: "block", maxHeight: 400, objectFit: "cover" }} />}
              <button onClick={() => setMedia(null)} style={{
                position: "absolute", top: 8, right: 8, background: "rgba(15,20,25,0.85)", color: "#fff",
                border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}><X size={16} /></button>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${t.border}`, position: "relative" }}>
            <div style={{ display: "flex", gap: 4 }}>
              <IconBtn onClick={pick} disabled={uploading} t={t}><ImageIcon size={18} color={t.accent} /></IconBtn>
              <IconBtn onClick={() => setEmojiOpen(v => !v)} t={t}><Smile size={18} color={t.accent} /></IconBtn>
              <input ref={fileRef} type="file" accept="image/*,video/*" onChange={onFile} style={{ display: "none" }} />
            </div>
            {emojiOpen && (
              <div style={{ position: "absolute", top: 44, left: 0, zIndex: 10, background: t.bgCard,
                border: `1px solid ${t.border}`, borderRadius: 12, padding: 8,
                boxShadow: "0 10px 32px rgba(0,0,0,.5)", display: "grid",
                gridTemplateColumns: "repeat(8, 28px)", gap: 4 }}>
                {COMMON_EMOJI.map(e => (
                  <button key={e} onClick={() => insertEmoji(e)} style={{
                    width: 28, height: 28, border: "none", background: "transparent",
                    fontSize: 18, cursor: "pointer", borderRadius: 6,
                  }}
                    onMouseEnter={ev => ev.currentTarget.style.background = t.bgSurface}
                    onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}>
                    {e}
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 12, color: left < 50 ? t.amber : t.textDim }}>{left}</span>
              <button disabled={!content.trim() || posting || !wallet} onClick={submit} style={{
                padding: "8px 22px", borderRadius: 999, background: t.accent, color: "#fff", border: "none",
                fontWeight: 700, fontSize: 14, cursor: (!content.trim() || posting || !wallet) ? "not-allowed" : "pointer",
                opacity: (!content.trim() || posting || !wallet) ? 0.55 : 1,
              }}>{posting ? "Posting…" : uploading ? "Uploading…" : "Post"}</button>
            </div>
          </div>
          {err && (
            <p style={{ color: t.red || "#ef4444", fontSize: 12, marginTop: 8 }}>{err}</p>
          )}
          {!wallet && (
            <p style={{ color: t.textDim, fontSize: 12, marginTop: 8 }}>Connect a wallet to post.</p>
          )}
        </div>
      </div>
    </div>
  );
}
function IconBtn({ children, onClick, disabled, t }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      width: 34, height: 34, borderRadius: "50%", border: "none",
      background: "transparent", cursor: disabled ? "not-allowed" : "pointer",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      opacity: disabled ? 0.5 : 1,
    }}
      onMouseEnter={e => !disabled && (e.currentTarget.style.background = `${t.accent}14`)}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
      {children}
    </button>
  );
}

/* ───────────────────── PostCard ───────────────────── */
function PostCard({ post, viewerWallet, onRefresh, onOpenComments, onShare, onBoost, onOpenProfile, openWallet }) {
  const t = useTheme();
  const [liked, setLiked] = useState(post.likedByMe);
  const [likes, setLikes] = useState(post.likes);
  const [reposted, setReposted] = useState(post.repostedByMe);
  const [reposts, setReposts] = useState(post.reposts);
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!viewerWallet || !ref.current) return;
    let visibleSince = null, sent = false;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !visibleSince) visibleSince = Date.now();
      else if (!e.isIntersecting && visibleSince) {
        const dwell = Date.now() - visibleSince;
        visibleSince = null;
        if (dwell >= 5000 && !sent) {
          sent = true;
          api("/api/feed/engagement", { method: "POST", wallet: viewerWallet,
            body: { postId: post.id, dwellMs: dwell } }).catch(() => {});
        }
      }
    }, { threshold: 0.5 });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [post.id, viewerWallet]);

  const author = post.author || {};
  const gated = () => { if (!viewerWallet) { openWallet?.(); return true; } return false; };

  const toggleLike = async () => {
    if (gated()) return;
    setLiked(v => !v); setLikes(c => c + (liked ? -1 : 1));
    try { const r = await api("/api/social/like", { method: "POST", wallet: viewerWallet, body: { postId: post.id } });
      setLiked(r.liked); setLikes(r.count);
    } catch { setLiked(v => !v); setLikes(c => c + (liked ? 1 : -1)); }
  };
  const toggleRepost = async () => {
    if (gated()) return;
    setReposted(v => !v); setReposts(c => c + (reposted ? -1 : 1));
    try { const r = await api("/api/social/repost", { method: "POST", wallet: viewerWallet, body: { postId: post.id } });
      setReposted(r.reposted); setReposts(r.count);
    } catch { setReposted(v => !v); setReposts(c => c + (reposted ? 1 : -1)); }
  };
  const del = async () => {
    if (!confirm("Delete this post?")) return;
    await api(`/api/posts/${post.id}`, { method: "DELETE", wallet: viewerWallet });
    onRefresh?.();
  };
  const isMine = viewerWallet && author.wallet_address === viewerWallet;

  return (
    <article ref={ref} style={{
      borderBottom: `1px solid ${t.border}`, padding: "14px 18px",
      background: post._promoted ? `${t.amber}08` : "transparent", cursor: "pointer",
    }}
      onMouseEnter={e => e.currentTarget.style.background = post._promoted ? `${t.amber}10` : t.bgSurface + "44"}
      onMouseLeave={e => e.currentTarget.style.background = post._promoted ? `${t.amber}08` : "transparent"}>
      {post._promoted && (
        <div style={{ fontSize: 11, color: t.amber, fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
          <Sparkles size={11} /> Promoted
        </div>
      )}
      <div style={{ display: "flex", gap: 12 }}>
        <div onClick={e => { e.stopPropagation(); onOpenProfile?.(author.wallet_address); }}>
          <Avatar user={author} size={44} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span onClick={e => { e.stopPropagation(); onOpenProfile?.(author.wallet_address); }}
              style={{ fontWeight: 700, color: t.white, cursor: "pointer" }}>{author.display_name || author.username || "anon"}</span>
            <AccountChip type={author.account_type} />
            <span style={{ color: t.textDim, fontSize: 14 }}>@{author.username}</span>
            <span style={{ color: t.textDim, fontSize: 14 }}>·</span>
            <span style={{ color: t.textDim, fontSize: 14 }}>{timeAgo(post.createdAt)}</span>
            <div style={{ marginLeft: "auto", position: "relative" }} onClick={e => e.stopPropagation()}>
              <button onClick={() => setMenuOpen(v => !v)} style={{ background: "none", border: "none", color: t.textMuted, cursor: "pointer", padding: 4 }}>
                <MoreHorizontal size={16} />
              </button>
              {menuOpen && (
                <div style={{ position: "absolute", right: 0, top: 24, background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 10, minWidth: 200, padding: 4, zIndex: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
                  onMouseLeave={() => setMenuOpen(false)}>
                  {isMine && <MenuRow t={t} onClick={onBoost}><Sparkles size={13} /> Boost — $5/wk</MenuRow>}
                  {isMine && <MenuRow t={t} color={t.red} onClick={del}><Trash2 size={13} /> Delete</MenuRow>}
                  {!isMine && <MenuRow t={t}>Mute @{author.username}</MenuRow>}
                </div>
              )}
            </div>
          </div>

          <p style={{ color: t.text, fontSize: 15, lineHeight: 1.45, margin: "4px 0",
            whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{post.content}</p>

          {post.mediaUrls?.length > 0 && (
            <div style={{ marginTop: 8, borderRadius: 16, overflow: "hidden", border: `1px solid ${t.border}` }}
              onClick={e => e.stopPropagation()}>
              {post.mediaType === "VIDEO"
                ? <video src={post.mediaUrls[0]} controls style={{ width: "100%", display: "block", maxHeight: 520 }} />
                : <img src={post.mediaUrls[0]} alt="" style={{ width: "100%", display: "block", maxHeight: 520, objectFit: "cover" }} />}
            </div>
          )}

          <div onClick={e => e.stopPropagation()} style={{ display: "flex", justifyContent: "space-between", marginTop: 10, maxWidth: 440 }}>
            <Action icon={MessageCircle} count={post.comments} onClick={onOpenComments} t={t} hover={t.accent} />
            <Action icon={Repeat2} count={reposts} active={reposted} hover={t.green} onClick={toggleRepost} t={t} />
            <Action icon={Heart} count={likes} active={liked} hover={t.red} onClick={toggleLike} t={t} fill={liked} />
            <Action icon={Share2} onClick={onShare} t={t} hover={t.accent} />
          </div>
        </div>
      </div>
    </article>
  );
}
function Action({ icon: Icon, count, active, hover, onClick, fill, t }) {
  const color = active ? hover : t.textMuted;
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 4, background: "none",
      border: "none", color, cursor: "pointer", fontSize: 13, padding: "4px 8px",
      borderRadius: 999, transition: "background .15s",
    }}
      onMouseEnter={e => e.currentTarget.style.background = `${hover}14`}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
      <Icon size={17} fill={fill ? color : "none"} /> {count > 0 && <span>{count}</span>}
    </button>
  );
}
function MenuRow({ children, onClick, color, t }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px",
      background: "none", border: "none", color: color || t.text, cursor: "pointer", fontSize: 13,
      textAlign: "left", borderRadius: 6,
    }}
      onMouseEnter={e => e.currentTarget.style.background = t.bgSurface}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
      {children}
    </button>
  );
}

/* ───────────────────── Modal shell ───────────────────── */
function Modal({ children, onClose, title, maxWidth = 560 }) {
  const t = useTheme();
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)",
      zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 16,
        width: "100%", maxWidth, maxHeight: "90vh", overflow: "auto",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: `1px solid ${t.border}` }}>
          <h3 style={{ margin: 0, color: t.white, fontSize: 17 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: t.textMuted, cursor: "pointer" }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  );
}

/* ───────────────────── Comments ───────────────────── */
function CommentsModal({ post, wallet, onClose, openWallet }) {
  const t = useTheme();
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api(`/api/social/comments/${post.id}`).then(r => setComments(r.comments)).catch(() => {});
  }, [post.id]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!wallet) return openWallet?.();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api("/api/social/comment", { method: "POST", wallet, body: { postId: post.id, content: text } });
      setText(""); load();
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} title="Replies">
      <div style={{ maxHeight: 360, overflowY: "auto" }}>
        {comments.length === 0 && <p style={{ color: t.textDim, padding: 12 }}>No replies yet.</p>}
        {comments.map(c => (
          <div key={c.id} style={{ display: "flex", gap: 10, padding: "10px 0" }}>
            <Avatar user={c} size={32} />
            <div>
              <div style={{ fontSize: 13 }}>
                <strong style={{ color: t.white }}>{c.display_name || c.username}</strong>
                <span style={{ color: t.textDim, marginLeft: 6 }}>· {timeAgo(c.created_at)}</span>
              </div>
              <div style={{ color: t.text, fontSize: 14 }}>{c.content}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input value={text} onChange={e => setText(e.target.value.slice(0, 500))}
          placeholder={wallet ? "Post your reply" : "Connect wallet to reply"}
          onKeyDown={e => e.key === "Enter" && submit()}
          style={inputStyle(t)} />
        <Btn primary onClick={submit} disabled={busy || !text.trim()}>Reply</Btn>
      </div>
    </Modal>
  );
}

/* ───────────────────── Profile (X-style tabs) ───────────────────── */
function ProfileModal({ wallet, viewerWallet, viewerSelector, onClose, onOpenDM, openWallet }) {
  const t = useTheme();
  const [user, setUser] = useState(null);
  const [posts, setPosts] = useState([]);
  const [tab, setTab] = useState("posts");
  const [editing, setEditing] = useState(false);
  const [recruited, setRecruited] = useState(false);
  const [form, setForm] = useState({ displayName: "", bio: "", pfpUrl: "", bannerUrl: "" });

  useEffect(() => {
    api(`/api/profile/${wallet}`).then(r => {
      setUser(r.user);
      setForm({ displayName: r.user.displayName || "", bio: r.user.bio || "",
        pfpUrl: r.user.pfpUrl || "", bannerUrl: r.user.bannerUrl || "" });
      api(`/api/profile/${r.user.id}/posts`, { wallet: viewerWallet }).then(p => setPosts(p.posts));
    }).catch(() => {});
  }, [wallet, viewerWallet]);

  const save = async () => {
    const r = await api("/api/profile", { method: "PATCH", wallet: viewerWallet, body: form });
    setUser(u => ({ ...u, ...r.user, displayName: r.user.display_name, pfpUrl: r.user.pfp_url, bannerUrl: r.user.banner_url }));
    setEditing(false);
  };
  const recruit = async () => {
    if (!viewerWallet) return openWallet?.();
    const r = await api("/api/social/follow", { method: "POST", wallet: viewerWallet, body: { targetWallet: wallet } });
    setRecruited(r.following);
  };

  if (!user) return <Modal onClose={onClose} title="Profile">Loading…</Modal>;
  const isMine = viewerWallet && user.walletAddress === viewerWallet;

  return (
    <Modal onClose={onClose} title={`@${user.username}`} maxWidth={640}>
      <div style={{ height: 140, background: user.bannerUrl ? `url(${user.bannerUrl}) center/cover` : `linear-gradient(135deg, ${t.accent}, #0ea5e9)`, borderRadius: 10, marginBottom: -40 }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: "0 4px" }}>
        <div style={{ padding: 2, background: t.bgCard, borderRadius: "50%" }}>
          <Avatar user={{ pfp_url: user.pfpUrl, username: user.username }} size={80} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {isMine
            ? <Btn onClick={() => setEditing(v => !v)}>{editing ? "Cancel" : "Edit"}</Btn>
            : (<>
              <Btn onClick={() => onOpenDM?.(user.walletAddress)}><MessageSquare size={14} /></Btn>
              <Btn primary onClick={recruit}>{recruited ? <><UserCheck size={14}/> {FOLLOWED}</> : <><UserPlus size={14}/> {FOLLOW}</>}</Btn>
            </>)}
        </div>
      </div>
      {!editing ? (
        <>
          <h2 style={{ margin: "12px 0 0", color: t.white, fontSize: 20, display: "flex", alignItems: "center", gap: 8 }}>
            {user.displayName || user.username} <AccountChip type={user.accountType} />
          </h2>
          <div style={{ color: t.textDim, fontSize: 14 }}>@{user.username} · {shortWallet(user.walletAddress)}</div>
          <p style={{ color: t.text, marginTop: 8, fontSize: 14 }}>{user.bio || <em style={{ color: t.textDim }}>No bio yet</em>}</p>
          <div style={{ display: "flex", gap: 16, fontSize: 14, color: t.textMuted, marginTop: 8 }}>
            <span><strong style={{ color: t.white }}>{user.following}</strong> Squad</span>
            <span><strong style={{ color: t.white }}>{user.followers}</strong> Recruits</span>
            <span><strong style={{ color: t.white }}>{user.posts}</strong> Posts</span>
          </div>
        </>
      ) : (
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <input placeholder="Display name" value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} style={inputStyle(t)} />
          <textarea placeholder="Bio" value={form.bio} onChange={e => setForm({ ...form, bio: e.target.value })} style={{ ...inputStyle(t), minHeight: 70 }} />
          <input placeholder="Avatar URL" value={form.pfpUrl} onChange={e => setForm({ ...form, pfpUrl: e.target.value })} style={inputStyle(t)} />
          <input placeholder="Banner URL" value={form.bannerUrl} onChange={e => setForm({ ...form, bannerUrl: e.target.value })} style={inputStyle(t)} />
          <Btn primary onClick={save}>Save</Btn>
        </div>
      )}

      <div style={{ display: "flex", marginTop: 18, borderBottom: `1px solid ${t.border}` }}>
        {[["posts", "Posts"], ["replies", "Replies"], ["media", "Media"], ["likes", "Likes"]].map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, padding: "12px 0", background: "none", border: "none", cursor: "pointer",
            color: tab === k ? t.white : t.textMuted, fontWeight: 700,
            borderBottom: tab === k ? `3px solid ${t.accent}` : "3px solid transparent",
          }}>{label}</button>
        ))}
      </div>

      {tab === "posts" && (
        <div>
          {posts.length === 0 && <p style={{ color: t.textDim, padding: 12 }}>No posts yet.</p>}
          {posts.map(p => (
            <div key={p.id} style={{ padding: "10px 0", borderBottom: `1px solid ${t.border}` }}>
              <div style={{ color: t.text, fontSize: 14 }}>{p.content}</div>
              <div style={{ color: t.textDim, fontSize: 12, marginTop: 4 }}>{timeAgo(p.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
      {tab !== "posts" && (
        <p style={{ color: t.textDim, padding: 16, textAlign: "center" }}>
          {tab === "media" ? "No media posts." : tab === "likes" ? "No likes yet." : "No replies."}
        </p>
      )}
    </Modal>
  );
}

/* ───────────────────── Agent deploy (wallet-signed) ───────────────────── */
function AgentDeployModal({ wallet, selector, onClose }) {
  const t = useTheme();
  const [step, setStep] = useState("config"); // config -> confirm -> signing -> done
  const [cfg, setCfg] = useState({ postStyle: "", personality: [], postSchedule: "0 9,17 * * *", commentRules: "", repostRules: "" });
  const [balance, setBalance] = useState(null);
  const [err, setErr] = useState("");
  const [existing, setExisting] = useState(null);

  useEffect(() => {
    api("/api/feed-agent/mine/info", { wallet }).then(r => {
      setExisting(r.agent);
      if (r.agent) setCfg({
        postStyle: r.agent.post_style || "", personality: r.agent.personality || [],
        postSchedule: r.agent.post_schedule || "", commentRules: r.agent.comment_rules || "",
        repostRules: r.agent.repost_rules || "",
      });
    }).catch(() => {});
    getAvailableNear(wallet).then(setBalance).catch(() => setBalance(0));
  }, [wallet]);

  const traits = ["Professional", "Witty", "Analytical", "Hype", "Cautious"];
  const togglePersona = (p) => setCfg(c => ({ ...c, personality: c.personality.includes(p) ? c.personality.filter(x => x !== p) : [...c.personality, p] }));

  const saveConfig = async () => {
    const r = await api(`/api/feed-agent/${existing.id}/config`, { method: "PATCH", wallet, body: cfg });
    setExisting(r.agent);
    alert("Config saved");
  };

  const canDeploy = cfg.postStyle.trim() && cfg.personality.length && cfg.postSchedule.trim();

  const deploy = async () => {
    setErr("");
    if (!canDeploy) { setErr("Fill Post style, pick at least one personality trait, and set a schedule before deploying."); return; }
    if (balance !== null && balance < 10.05) { setErr(`Insufficient balance — you have ${balance.toFixed(2)} NEAR, need 10 NEAR (+ gas).`); return; }
    setStep("signing");
    try {
      const { txHash } = await payNear({ selector, accountId: wallet, amountNear: 10, memo: "IronFeed agent deploy" });
      await api("/api/feed-agent/deploy", { method: "POST", wallet, body: { paymentTxHash: txHash, ...cfg } });
      setStep("done");
    } catch (e) {
      setErr(e.message || "Payment failed");
      setStep("config");
    }
  };

  return (
    <Modal onClose={onClose} title={existing ? "IronClaw Agent" : "Deploy your Agent"} maxWidth={640}>
      {!existing && (
        <div style={{ background: `${t.accent}12`, border: `1px solid ${t.accent}44`, borderRadius: 14, padding: 14, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Bot size={18} color={t.accent} />
            <strong style={{ color: t.white, fontSize: 15 }}>Deploy your Agent</strong>
            <span style={{ marginLeft: "auto", background: "#10b98122", color: t.green, padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700 }}>10 NEAR / mo</span>
          </div>
          <p style={{ color: t.textMuted, fontSize: 13, margin: "6px 0 0" }}>
            Let your agent post, find alpha, and act even when you're not here. Deployed on IronClaw runtime,
            tweaked from this site. Platform fee is 10N — separate from IronClaw's compute fees.
          </p>
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        <label style={{ color: t.textMuted, fontSize: 12, fontWeight: 600 }}>Post style *</label>
        <textarea value={cfg.postStyle} onChange={e => setCfg({ ...cfg, postStyle: e.target.value })}
          placeholder="Write like a researcher. Be concise and technical."
          style={{ ...inputStyle(t), minHeight: 60 }} />

        <label style={{ color: t.textMuted, fontSize: 12, fontWeight: 600 }}>Personality *</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {traits.map(p => (
            <button key={p} onClick={() => togglePersona(p)} style={{
              padding: "6px 12px", borderRadius: 999,
              border: `1px solid ${cfg.personality.includes(p) ? t.accent : t.border}`,
              background: cfg.personality.includes(p) ? `${t.accent}22` : "transparent",
              color: cfg.personality.includes(p) ? t.accent : t.textMuted,
              cursor: "pointer", fontSize: 12,
            }}>{p}</button>
          ))}
        </div>

        <label style={{ color: t.textMuted, fontSize: 12, fontWeight: 600 }}>Post schedule (cron) *</label>
        <input value={cfg.postSchedule} onChange={e => setCfg({ ...cfg, postSchedule: e.target.value })} style={inputStyle(t)} />

        <label style={{ color: t.textMuted, fontSize: 12, fontWeight: 600 }}>Comment rules</label>
        <textarea value={cfg.commentRules} onChange={e => setCfg({ ...cfg, commentRules: e.target.value })}
          placeholder="Only comment on posts about Web3 security."
          style={{ ...inputStyle(t), minHeight: 50 }} />

        <label style={{ color: t.textMuted, fontSize: 12, fontWeight: 600 }}>Repost rules</label>
        <textarea value={cfg.repostRules} onChange={e => setCfg({ ...cfg, repostRules: e.target.value })}
          placeholder="Repost anything mentioning @ironclaw or IronShield."
          style={{ ...inputStyle(t), minHeight: 50 }} />
      </div>

      {err && <p style={{ color: t.red, fontSize: 13, marginTop: 12 }}>{err}</p>}
      {balance !== null && <p style={{ color: t.textDim, fontSize: 12, marginTop: 10 }}>Wallet: {balance.toFixed(2)} NEAR</p>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        {existing
          ? <Btn primary onClick={saveConfig}>Save config</Btn>
          : <Btn primary disabled={!canDeploy || step === "signing"} onClick={deploy}>
              {step === "signing" ? "Signing…" : step === "done" ? "Deployed ✓" : "Deploy — 10 NEAR"}
            </Btn>}
      </div>
    </Modal>
  );
}

/* ───────────────────── Org registration ───────────────────── */
function OrgBadgeModal({ wallet, selector, onClose }) {
  const t = useTheme();
  const [orgName, setOrg] = useState("");
  const [balance, setBalance] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { getAvailableNear(wallet).then(setBalance).catch(() => setBalance(0)); }, [wallet]);

  const submit = async () => {
    setErr("");
    if (!orgName.trim()) { setErr("Organisation name required"); return; }
    if (balance !== null && balance < 100.05) { setErr(`Insufficient balance — you have ${balance.toFixed(2)} NEAR, need 100 NEAR.`); return; }
    setBusy(true);
    try {
      const { txHash } = await payNear({ selector, accountId: wallet, amountNear: 100, memo: `Org badge ${orgName}` });
      await api("/api/feed-org/register", { method: "POST", wallet, body: { orgName, paymentTxHash: txHash } });
      alert("Org badge granted!");
      onClose();
    } catch (e) { setErr(e.message || "Payment failed"); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} title="Become a verified Organization">
      <p style={{ color: t.textMuted, fontSize: 14 }}>
        Pay <strong style={{ color: t.amber }}>100 NEAR</strong> to unlock the gold Org badge — for project
        teams, DAOs, and protocols.
      </p>
      <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
        <input placeholder="Organisation name" value={orgName} onChange={e => setOrg(e.target.value)} style={inputStyle(t)} />
        {balance !== null && <p style={{ color: t.textDim, fontSize: 12 }}>Wallet: {balance.toFixed(2)} NEAR</p>}
        {err && <p style={{ color: t.red, fontSize: 13 }}>{err}</p>}
        <Btn primary disabled={!orgName || busy} onClick={submit}>
          {busy ? "Signing…" : "Pay 100 NEAR & verify"}
        </Btn>
      </div>
    </Modal>
  );
}

/* ───────────────────── Ad boost ───────────────────── */
function AdBoostModal({ post, wallet, selector, onClose }) {
  const t = useTheme();
  const [balance, setBalance] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { getAvailableNear(wallet).then(setBalance).catch(() => setBalance(0)); }, [wallet]);

  const submit = async () => {
    setErr("");
    if (balance !== null && balance < 5.05) { setErr(`Insufficient balance — you have ${balance.toFixed(2)} NEAR, need 5 NEAR.`); return; }
    setBusy(true);
    try {
      const { txHash } = await payNear({ selector, accountId: wallet, amountNear: 5, memo: `Boost post ${post.id}` });
      await api("/api/ads/create", { method: "POST", wallet, body: { postId: post.id, paymentTxHash: txHash } });
      alert("Boost active for 7 days");
      onClose();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} title="Boost this post — $5 / week">
      <p style={{ color: t.textMuted, fontSize: 14 }}>Promoted posts surface in For You every 8 slots for 7 days.</p>
      {balance !== null && <p style={{ color: t.textDim, fontSize: 12, marginTop: 10 }}>Wallet: {balance.toFixed(2)} NEAR</p>}
      {err && <p style={{ color: t.red, fontSize: 13 }}>{err}</p>}
      <Btn primary disabled={busy} onClick={submit} style={{ marginTop: 12 }}>
        {busy ? "Signing…" : "Pay 5 NEAR & activate"}
      </Btn>
    </Modal>
  );
}

/* ───────────────────── DM (search + invite) ───────────────────── */
function DMsModal({ wallet, onClose, initialPeer }) {
  const t = useTheme();
  const [convs, setConvs] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [searchResult, setSearchResult] = useState(null);

  const refresh = useCallback(() => {
    api("/api/dm/conversations", { wallet }).then(r => setConvs(r.conversations)).catch(() => {});
  }, [wallet]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (active) {
      const poll = setInterval(async () => {
        try { const r = await api(`/api/dm/${active.id}/messages`, { wallet }); setMessages(r.messages.slice().reverse()); } catch {}
      }, 1200);
      return () => clearInterval(poll);
    }
  }, [active, wallet]);

  useEffect(() => { if (initialPeer) { startWith(initialPeer); } /* eslint-disable-next-line */ }, [initialPeer]);

  const open = async (c) => {
    setActive(c);
    const r = await api(`/api/dm/${c.id}/messages`, { wallet });
    setMessages(r.messages.slice().reverse());
    api(`/api/dm/${c.id}/read`, { method: "POST", wallet }).catch(() => {});
  };

  const lookup = async () => {
    if (!search.trim()) return;
    try { const r = await api(`/api/dm/search?q=${encodeURIComponent(search)}`, { wallet }); setSearchResult(r); }
    catch (e) { alert(e.message); }
  };

  const startWith = async (peerWallet) => {
    const r = await api("/api/dm/conversation", { method: "POST", wallet, body: { peerWallet } });
    const c = { id: r.conversationId, peer: r.peer, unread: 0 };
    setConvs(cs => [c, ...cs.filter(x => x.id !== c.id)]);
    open(c);
    setSearch(""); setSearchResult(null);
  };

  const inviteLink = (handleOrWallet) =>
    `https://ironshield.pages.dev/#/Feed?invite=${encodeURIComponent(handleOrWallet)}`;

  const shareInvite = async (handle) => {
    const url = inviteLink(handle);
    const shareText = `Join me on IronFeed — crypto-native social on NEAR. ${url}`;
    if (navigator.share) {
      try { await navigator.share({ text: shareText, url }); return; } catch {}
    }
    await navigator.clipboard.writeText(shareText);
    alert("Invite link copied — paste it into Telegram, X, Discord, etc.");
  };

  const send = async () => {
    if (!text.trim() || !active) return;
    // TODO: upgrade to tweetnacl E2E. For now, base64 payload only.
    const encryptedPayload = btoa(unescape(encodeURIComponent(text)));
    const nonce = btoa(String(Date.now()));
    // Optimistic append (sub-second UX)
    const tempId = "tmp-" + Date.now();
    const optimistic = { id: tempId, encrypted_payload: encryptedPayload, nonce, from_id: -1, to_id: active.peer.id, created_at: new Date().toISOString() };
    setMessages(m => [...m, optimistic]);
    setText("");
    try {
      const r = await api("/api/dm/send", { method: "POST", wallet,
        body: { conversationId: active.id, encryptedPayload, nonce } });
      setMessages(m => m.map(x => x.id === tempId ? r.message : x));
    } catch (e) {
      setMessages(m => m.filter(x => x.id !== tempId));
      alert(e.message);
    }
  };
  const decode = (m) => { try { return decodeURIComponent(escape(atob(m.encrypted_payload))); } catch { return "(message)"; } };

  return (
    <Modal onClose={onClose} title="Messages" maxWidth={820}>
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 12, height: 520 }}>
        <div style={{ borderRight: `1px solid ${t.border}`, paddingRight: 10, overflowY: "auto" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <input placeholder="search wallet / username" value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === "Enter" && lookup()} style={inputStyle(t)} />
            <Btn onClick={lookup} disabled={!search}><Search size={14} /></Btn>
          </div>

          {searchResult && (
            <div style={{ border: `1px solid ${t.border}`, borderRadius: 10, padding: 10, marginBottom: 10 }}>
              {searchResult.user ? (
                <>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Avatar user={searchResult.user} size={32} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: t.white, fontSize: 13, fontWeight: 700 }}>{searchResult.user.display_name || searchResult.user.username}</div>
                      <div style={{ color: t.textDim, fontSize: 11 }}>{shortWallet(searchResult.user.wallet_address)}</div>
                    </div>
                  </div>
                  <Btn primary style={{ marginTop: 8, width: "100%" }} onClick={() => startWith(searchResult.user.wallet_address)}>Message</Btn>
                </>
              ) : (
                <>
                  <p style={{ color: t.textMuted, fontSize: 13, margin: 0 }}>
                    <strong style={{ color: t.white }}>{search}</strong> isn't on IronFeed yet.
                  </p>
                  <Btn style={{ marginTop: 8, width: "100%" }} onClick={() => shareInvite(search)}>
                    <LinkIcon size={13} /> Send invite link
                  </Btn>
                </>
              )}
            </div>
          )}

          {convs.map(c => (
            <div key={c.id} onClick={() => open(c)} style={{
              display: "flex", gap: 8, padding: 8, borderRadius: 8, cursor: "pointer",
              background: active?.id === c.id ? `${t.accent}18` : "transparent",
            }}>
              <Avatar user={{ pfp_url: c.peer.pfpUrl, username: c.peer.username }} size={32} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ color: t.white, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.peer.displayName || c.peer.username}
                </div>
                <div style={{ color: t.textDim, fontSize: 11 }}>
                  {c.unread > 0 && <span style={{ color: t.accent }}>● </span>}{shortWallet(c.peer.wallet)}
                </div>
              </div>
            </div>
          ))}
          {convs.length === 0 && !searchResult && (
            <p style={{ color: t.textDim, fontSize: 13 }}>No conversations yet. Search for a wallet above.</p>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {!active ? <p style={{ color: t.textDim, padding: 20 }}>Select or start a conversation.</p> : (
            <>
              <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
                {messages.map(m => (
                  <div key={m.id} style={{ display: "flex", justifyContent: m.from_id === active.peer.id ? "flex-start" : "flex-end", marginBottom: 6 }}>
                    <div style={{
                      background: m.from_id === active.peer.id ? t.bgSurface : t.accent,
                      color: m.from_id === active.peer.id ? t.text : "#fff",
                      padding: "8px 12px", borderRadius: 14, maxWidth: "75%", fontSize: 14,
                      whiteSpace: "pre-wrap", wordBreak: "break-word",
                    }}>{decode(m)}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, paddingTop: 10, borderTop: `1px solid ${t.border}` }}>
                <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && send()}
                  placeholder="Encrypted message..." style={inputStyle(t)} />
                <Btn primary onClick={send} disabled={!text.trim()}><Send size={14} /></Btn>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ───────────────────── Notifications ───────────────────── */
function NotificationsModal({ wallet, onClose }) {
  const t = useTheme();
  const [items, setItems] = useState([]);
  useEffect(() => {
    api("/api/notifications", { wallet }).then(r => setItems(r.notifications)).catch(() => {});
    api("/api/notifications/read-all", { method: "POST", wallet }).catch(() => {});
  }, [wallet]);
  const verb = { like: "liked your post", comment: "commented on your post",
    follow: `recruited you to their Squad`, repost: "reposted your post",
    agent: "agent activity", ad: "ad impression" };
  return (
    <Modal onClose={onClose} title="Notifications">
      {items.length === 0 && <p style={{ color: t.textDim }}>Nothing here yet.</p>}
      {items.map(n => (
        <div key={n.id} style={{ display: "flex", gap: 10, padding: "10px 0", borderBottom: `1px solid ${t.border}` }}>
          <Avatar user={{ pfp_url: n.actor_pfp, username: n.actor_username }} size={32} />
          <div style={{ flex: 1 }}>
            <div style={{ color: t.text, fontSize: 14 }}>
              <strong>{n.actor_name || n.actor_username || "Someone"}</strong> {verb[n.type] || n.type}
            </div>
            <div style={{ color: t.textDim, fontSize: 11 }}>{timeAgo(n.created_at)}</div>
          </div>
        </div>
      ))}
    </Modal>
  );
}

/* ───────────────────── Right rail cards ───────────────────── */
function RightRail({ onDeployAgent, onOpenOrg, wallet, openWallet }) {
  const t = useTheme();
  const [news, setNews] = useState([]);
  const [ads, setAds]   = useState([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    api("/api/feed-news").then(r => setNews(r.news || [])).catch(() => {});
    api("/api/ads/active").then(r => setAds((r.campaigns || []).slice(0, 3))).catch(() => {});
  }, []);

  const card = (title, children) => (
    <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 16, marginBottom: 14, overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${t.border}` }}>
        <h3 style={{ margin: 0, color: t.white, fontSize: 17, fontWeight: 800 }}>{title}</h3>
      </div>
      <div>{children}</div>
    </div>
  );

  return (
    <aside style={{ padding: "8px 0" }}>
      {/* Search */}
      <div style={{ position: "sticky", top: 0, background: t.bg, padding: "6px 0 12px", zIndex: 3 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: t.bgSurface,
          border: `1px solid ${t.border}`, borderRadius: 999, padding: "8px 14px" }}>
          <Search size={16} color={t.textMuted} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search"
            style={{ flex: 1, border: "none", background: "transparent", color: t.text, outline: "none", fontSize: 14 }} />
        </div>
      </div>

      {/* Deploy your Agent (replaces X Premium) */}
      {card(
        <span>Deploy your Agent <span style={{ background: `${t.green}22`, color: t.green, padding: "2px 7px", borderRadius: 6, fontSize: 11, marginLeft: 6 }}>10N /mo</span></span>,
        <div style={{ padding: 16 }}>
          <p style={{ color: t.textMuted, fontSize: 13, margin: 0, lineHeight: 1.5 }}>
            Let your agent post, find alpha, and act — even when you're not here. Personality &amp; schedule
            configured on IronShield, runtime on IronClaw.
          </p>
          <button onClick={() => wallet ? onDeployAgent() : openWallet?.()} style={{
            marginTop: 12, width: "100%", padding: "10px 16px", borderRadius: 999,
            background: t.accent, color: "#fff", border: "none", fontWeight: 800, fontSize: 14, cursor: "pointer",
          }}>Deploy</button>
        </div>
      )}

      {/* Ads — only if active campaigns */}
      {ads.length > 0 && card("Sponsored",
        ads.map((a, i) => (
          <div key={a.id} style={{ padding: "10px 16px", borderTop: i ? `1px solid ${t.border}` : "none", cursor: "pointer" }}>
            <div style={{ fontSize: 11, color: t.amber, fontWeight: 700, marginBottom: 2 }}>
              <Sparkles size={10} style={{ verticalAlign: -1, marginRight: 3 }} />Promoted
            </div>
            <div style={{ color: t.white, fontSize: 14, fontWeight: 600 }}>Boost #{a.post_id}</div>
            <div style={{ color: t.textDim, fontSize: 12 }}>{a.impressions} impressions</div>
          </div>
        ))
      )}

      {/* Today's News from Alpha */}
      {card("Today's News",
        news.length === 0
          ? <p style={{ padding: 16, color: t.textDim, fontSize: 13, margin: 0 }}>Alpha feed warming up…</p>
          : news.map((n, i) => (
              <a key={i} href={n.url || "#"} target="_blank" rel="noopener noreferrer" style={{
                display: "block", padding: "10px 16px", borderTop: i ? `1px solid ${t.border}` : "none",
                textDecoration: "none", color: "inherit",
              }}>
                <div style={{ fontSize: 11, color: t.textDim }}>{n.source}</div>
                <div style={{ color: t.white, fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{n.title}</div>
                {n.posts > 0 && <div style={{ color: t.textDim, fontSize: 12, marginTop: 2 }}>{n.posts} posts</div>}
              </a>
            ))
      )}

      {/* Org badge */}
      {card("Verify your Organization",
        <div style={{ padding: 16 }}>
          <p style={{ color: t.textMuted, fontSize: 13, margin: 0 }}>Unlock the gold Org badge for teams and protocols — 100 NEAR one-time.</p>
          <button onClick={() => wallet ? onOpenOrg() : openWallet?.()} style={{
            marginTop: 10, padding: "8px 14px", borderRadius: 999, background: "transparent",
            border: `1px solid ${t.border}`, color: t.text, cursor: "pointer", fontWeight: 600, fontSize: 13,
          }}>Verify organization</button>
        </div>
      )}
    </aside>
  );
}

/* ───────────────────── Main page ───────────────────── */
export default function IronFeedPage({ openWallet }) {
  const t = useTheme();
  const { connected, address, selector } = useWallet();
  const wallet = connected ? address : null;

  const [tab, setTab] = useState("foryou");
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [openComments, setOpenComments] = useState(null);
  const [openProfile, setOpenProfile] = useState(null);
  const [openOrg, setOpenOrg] = useState(false);
  const [openAgent, setOpenAgent] = useState(false);
  const [openDMs, setOpenDMs] = useState(false);
  const [dmPeer, setDmPeer] = useState(null);
  const [openNotifs, setOpenNotifs] = useState(false);
  const [boostPost, setBoostPost] = useState(null);
  const [railOpen, setRailOpen] = useState(true);

  // Deep-link support: #/Feed?profile=alice.near  or  #/Feed?invite=bob.near
  useEffect(() => {
    const parse = () => {
      const hash = window.location.hash || "";
      const q = hash.includes("?") ? hash.split("?")[1] : "";
      const params = new URLSearchParams(q);
      const profile = params.get("profile");
      const invite = params.get("invite");
      if (profile) setOpenProfile(profile);
      if (invite && wallet) { setDmPeer(invite); setOpenDMs(true); }
    };
    parse();
    window.addEventListener("hashchange", parse);
    return () => window.removeEventListener("hashchange", parse);
  }, [wallet]);

  const load = useCallback(async (reset = true) => {
    setLoading(true);
    try {
      const base = `/api/feed/${tab}`;
      const q = (!reset && cursor) ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const r = await api(base + q, { wallet });
      setPosts(p => reset ? r.posts : [...p, ...r.posts]);
      setCursor(r.nextCursor);
    } catch (e) { console.warn(e.message); }
    finally { setLoading(false); }
  }, [tab, cursor, wallet]);

  useEffect(() => { load(true); /* eslint-disable-next-line */ }, [tab, wallet]);

  const onPosted = (p) => setPosts(prev => [p, ...prev]);
  const share = (p) => {
    const url = `https://ironshield.pages.dev/#/Feed?post=${p.id}`;
    if (navigator.share) navigator.share({ text: p.content, url }).catch(() => {});
    else { navigator.clipboard.writeText(url); alert("Link copied"); }
  };

  return (
    <div className={`ix-feed-wrap ${railOpen ? "rail-on" : "rail-off"}`} style={{ maxWidth: 1100, margin: "0 auto" }}>
      <style>{`
        .ix-feed-wrap { display: grid; gap: 0; }
        .ix-feed-wrap.rail-on  { grid-template-columns: minmax(0,1fr) 340px; }
        .ix-feed-wrap.rail-off { grid-template-columns: minmax(0,1fr); }
        .ix-feed-col { border-left: 1px solid ${t.border}; border-right: 1px solid ${t.border}; min-height: 100vh; }
        .ix-feed-header { position: sticky; top: 0; z-index: 5; background: ${t.bg}cc; backdrop-filter: blur(8px); border-bottom: 1px solid ${t.border}; }
        .ix-right-col { padding: 8px 16px 40px; }
        .ix-rail-toggle {
          position: fixed; top: 12px; right: 12px; z-index: 20;
          width: 40px; height: 40px; border-radius: 50%;
          background: ${t.bgCard}; border: 1px solid ${t.border};
          display: inline-flex; align-items: center; justify-content: center;
          cursor: pointer; color: ${t.text};
        }
        @media (max-width: 960px) {
          .ix-feed-wrap.rail-on, .ix-feed-wrap.rail-off { grid-template-columns: 1fr; }
          .ix-right-col { display: none; }
        }
        @media (max-width: 640px) {
          .ix-feed-col { border-left: none; border-right: none; }
          .ix-feed-wrap { margin: 0; }
        }
      `}</style>
      <button className="ix-rail-toggle" aria-label={railOpen ? "Hide sidebar" : "Show sidebar"}
        onClick={() => setRailOpen(v => !v)} title={railOpen ? "Hide right sidebar" : "Show right sidebar"}>
        {railOpen ? <X size={18} /> : <Sparkles size={18} color={t.accent} />}
      </button>

      {/* Center column */}
      <section className="ix-feed-col">
        <header className="ix-feed-header">
          <div style={{ padding: "14px 18px", borderBottom: `1px solid ${t.border}` }}>
            <h2 style={{ margin: 0, color: t.white, fontSize: 20, fontWeight: 800 }}>IronFeed</h2>
          </div>
          <div style={{ display: "flex" }}>
            {[["foryou", "For you"], ["following", "Squad"]].map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} style={{
                flex: 1, padding: "14px 0", background: "none", border: "none", cursor: "pointer",
                color: tab === k ? t.white : t.textMuted, fontWeight: 700, fontSize: 15,
                position: "relative",
              }}>
                {label}
                {tab === k && <span style={{ position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)", width: 56, height: 4, borderRadius: 4, background: t.accent }} />}
              </button>
            ))}
          </div>
        </header>

        <ComposePost wallet={wallet} onPosted={onPosted} />

        {posts.length === 0 && !loading && (
          <div style={{ padding: 40, textAlign: "center", color: t.textDim }}>
            {tab === "following" ? `${FOLLOW} people to fill your Squad feed.` : "No posts yet — be first!"}
          </div>
        )}
        {posts.map(p => (
          <PostCard key={p.id + (p._promoted ? "-ad" : "")} post={p} viewerWallet={wallet}
            onRefresh={() => load(true)}
            onOpenComments={() => setOpenComments(p)}
            onShare={() => share(p)}
            onBoost={() => setBoostPost(p)}
            onOpenProfile={(w) => setOpenProfile(w)}
            openWallet={openWallet} />
        ))}
        {cursor && (
          <div style={{ textAlign: "center", padding: 16 }}>
            <Btn onClick={() => load(false)} disabled={loading}>{loading ? "Loading…" : "Load more"}</Btn>
          </div>
        )}
      </section>

      {/* Right rail */}
      {railOpen && (
      <aside className="ix-right-col">
        <RightRail
          wallet={wallet}
          openWallet={openWallet}
          onDeployAgent={() => setOpenAgent(true)}
          onOpenOrg={() => setOpenOrg(true)}
        />
        <div style={{ display: "flex", gap: 10, flexDirection: "column" }}>
          <button onClick={() => wallet ? setOpenNotifs(true) : openWallet?.()}
            style={{ padding: "10px 14px", borderRadius: 999, background: t.bgCard, border: `1px solid ${t.border}`, color: t.text, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
            <Bell size={16} /> Notifications
          </button>
          <button onClick={() => wallet ? setOpenDMs(true) : openWallet?.()}
            style={{ padding: "10px 14px", borderRadius: 999, background: t.bgCard, border: `1px solid ${t.border}`, color: t.text, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
            <MessageSquare size={16} /> Messages
          </button>
          <button onClick={() => wallet && setOpenProfile(wallet)} disabled={!wallet}
            style={{ padding: "10px 14px", borderRadius: 999, background: t.bgCard, border: `1px solid ${t.border}`, color: t.text, cursor: wallet ? "pointer" : "not-allowed", textAlign: "left", display: "flex", alignItems: "center", gap: 8, opacity: wallet ? 1 : 0.5 }}>
            <User size={16} /> My profile
          </button>
        </div>
      </aside>
      )}

      {openComments && <CommentsModal post={openComments} wallet={wallet} openWallet={openWallet} onClose={() => setOpenComments(null)} />}
      {openProfile && <ProfileModal wallet={openProfile} viewerWallet={wallet} viewerSelector={selector} openWallet={openWallet}
        onOpenDM={(w) => { setOpenProfile(null); setDmPeer(w); setOpenDMs(true); }} onClose={() => setOpenProfile(null)} />}
      {openOrg && <OrgBadgeModal wallet={wallet} selector={selector} onClose={() => setOpenOrg(false)} />}
      {openAgent && <AgentDeployModal wallet={wallet} selector={selector} onClose={() => setOpenAgent(false)} />}
      {openDMs && <DMsModal wallet={wallet} initialPeer={dmPeer} onClose={() => { setOpenDMs(false); setDmPeer(null); }} />}
      {openNotifs && <NotificationsModal wallet={wallet} onClose={() => setOpenNotifs(false)} />}
      {boostPost && <AdBoostModal post={boostPost} wallet={wallet} selector={selector} onClose={() => setBoostPost(null)} />}
    </div>
  );
}
