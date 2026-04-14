"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Heart, MessageCircle, Repeat2, Share2, Image as ImageIcon, Send, X,
  Search, Bell, User, Home as HomeIcon, MessageSquare, Sparkles, Star,
  Building2, Bot, Shield, Zap, Trash2, Copy, MoreHorizontal, Loader2
} from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import { Btn } from "@/components/Primitives";

function Card({ children, style = {} }) {
  const t = useTheme();
  return <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14, ...style }}>{children}</div>;
}

const API = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

/* ────────────────────────── tiny fetch helper ─────────────────────── */
function api(path, { method = "GET", body, wallet } = {}) {
  const headers = { "content-type": "application/json" };
  if (wallet) headers["x-wallet"] = wallet;
  return fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  }).then(async r => {
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data;
  });
}

/* ────────────────────────── helpers ───────────────────────────────── */
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

/* ────────────────────────── account-type chip ─────────────────────── */
function AccountChip({ type }) {
  const t = useTheme();
  if (!type || type === "HUMAN") {
    return <span style={chipStyle(t.accent)}><Shield size={10} /> Human</span>;
  }
  if (type === "AGENT") {
    return <span style={chipStyle("#a855f7")}><Bot size={10} /> Agent</span>;
  }
  return <span style={chipStyle("#eab308")}><Building2 size={10} /> Org</span>;
}
function chipStyle(color) {
  return {
    display: "inline-flex", alignItems: "center", gap: 4,
    padding: "2px 7px", borderRadius: 999,
    fontSize: 10, fontWeight: 700, color,
    background: `${color}18`, border: `1px solid ${color}44`,
  };
}

/* ────────────────────────── PostCard ──────────────────────────────── */
function PostCard({ post, viewerWallet, onRefresh, onOpenComments, onShare, onBoost }) {
  const t = useTheme();
  const [liked, setLiked] = useState(post.likedByMe);
  const [likes, setLikes] = useState(post.likes);
  const [reposted, setReposted] = useState(post.repostedByMe);
  const [reposts, setReposts] = useState(post.reposts);
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef(null);

  /* dwell tracking — intersection >5s */
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

  const toggleLike = async () => {
    if (!viewerWallet) return;
    setLiked(v => !v); setLikes(c => c + (liked ? -1 : 1)); // optimistic
    try {
      const r = await api("/api/social/like", { method: "POST", wallet: viewerWallet, body: { postId: post.id } });
      setLiked(r.liked); setLikes(r.count);
    } catch { setLiked(v => !v); setLikes(c => c + (liked ? 1 : -1)); }
  };
  const toggleRepost = async () => {
    if (!viewerWallet) return;
    setReposted(v => !v); setReposts(c => c + (reposted ? -1 : 1));
    try {
      const r = await api("/api/social/repost", { method: "POST", wallet: viewerWallet, body: { postId: post.id } });
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
    <div ref={ref} style={{
      borderBottom: `1px solid ${t.border}`, padding: "16px 18px",
      background: post._promoted ? `${t.amber}08` : "transparent",
      transition: "background .15s",
    }}>
      {post._promoted && (
        <div style={{ fontSize: 11, color: t.amber, fontWeight: 700, marginBottom: 8,
          display: "flex", alignItems: "center", gap: 4 }}>
          <Sparkles size={11} /> Promoted
        </div>
      )}
      <div style={{ display: "flex", gap: 12 }}>
        <Avatar user={author} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, color: t.white }}>{author.display_name || author.username || "anon"}</span>
            <span style={{ color: t.textDim, fontSize: 13 }}>@{author.username}</span>
            <AccountChip type={author.account_type} />
            <span style={{ color: t.textDim, fontSize: 13 }}>· {timeAgo(post.createdAt)}</span>
            <div style={{ marginLeft: "auto", position: "relative" }}>
              <button onClick={() => setMenuOpen(v => !v)} style={iconBtn(t)}><MoreHorizontal size={16} /></button>
              {menuOpen && (
                <div style={menuStyle(t)} onMouseLeave={() => setMenuOpen(false)}>
                  {isMine && <button style={menuItem(t)} onClick={onBoost}>$5 — Boost this post</button>}
                  {isMine && <button style={menuItem(t, t.red)} onClick={del}><Trash2 size={13} /> Delete</button>}
                  {!isMine && <button style={menuItem(t)}>Mute @{author.username}</button>}
                </div>
              )}
            </div>
          </div>

          <p style={{ color: t.text, fontSize: 15, lineHeight: 1.5, margin: "6px 0",
            whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{post.content}</p>

          {post.mediaUrls?.length > 0 && (
            <div style={{ marginTop: 10, borderRadius: 14, overflow: "hidden",
              border: `1px solid ${t.border}` }}>
              {post.mediaType === "VIDEO"
                ? <video src={post.mediaUrls[0]} controls style={{ width: "100%", display: "block" }} />
                : <img src={post.mediaUrls[0]} alt="" style={{ width: "100%", display: "block" }} />}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, maxWidth: 420 }}>
            <ActionBtn icon={MessageCircle} count={post.comments} onClick={onOpenComments} t={t} />
            <ActionBtn icon={Repeat2} count={reposts} active={reposted} activeColor={t.green} onClick={toggleRepost} t={t} />
            <ActionBtn icon={Heart} count={likes} active={liked} activeColor={t.red} onClick={toggleLike} t={t} fill={liked} />
            <ActionBtn icon={Share2} onClick={onShare} t={t} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionBtn({ icon: Icon, count, active, activeColor, onClick, fill, t }) {
  const color = active ? activeColor : t.textMuted;
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 6, background: "none",
      border: "none", color, cursor: "pointer", fontSize: 13, padding: "4px 8px",
      borderRadius: 999, transition: "background .15s",
    }}
      onMouseEnter={e => e.currentTarget.style.background = `${activeColor || t.accent}14`}
      onMouseLeave={e => e.currentTarget.style.background = "none"}>
      <Icon size={16} fill={fill ? color : "none"} />
      {count > 0 && <span>{count}</span>}
    </button>
  );
}
function iconBtn(t) {
  return { background: "none", border: "none", color: t.textMuted, cursor: "pointer", padding: 4 };
}
function menuStyle(t) {
  return { position: "absolute", right: 0, top: 24, background: t.bgCard, border: `1px solid ${t.border}`,
    borderRadius: 10, minWidth: 180, padding: 4, zIndex: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" };
}
function menuItem(t, color) {
  return { display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px",
    background: "none", border: "none", color: color || t.text, cursor: "pointer", fontSize: 13,
    textAlign: "left", borderRadius: 6 };
}

function Avatar({ user, size = 36 }) {
  const t = useTheme();
  if (user?.pfp_url) {
    return <img src={user.pfp_url} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover" }} />;
  }
  const initial = (user?.display_name || user?.username || "?")[0]?.toUpperCase();
  return (
    <div style={{ width: size, height: size, borderRadius: "50%",
      background: `linear-gradient(135deg, ${t.accent}, #0ea5e9)`,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#fff", fontWeight: 800, fontSize: size * 0.4, flexShrink: 0 }}>
      {initial}
    </div>
  );
}

/* ────────────────────────── ComposePost ───────────────────────────── */
function ComposePost({ wallet, onPosted, onClose }) {
  const t = useTheme();
  const [content, setContent] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [posting, setPosting] = useState(false);
  const left = 500 - content.length;

  const submit = async () => {
    if (!content.trim() || posting) return;
    setPosting(true);
    try {
      const body = { content };
      if (mediaUrl) { body.mediaUrls = [mediaUrl]; body.mediaType = mediaUrl.match(/\.(mp4|webm)$/i) ? "VIDEO" : "IMAGE"; }
      const r = await api("/api/posts", { method: "POST", wallet, body });
      onPosted?.(r.post);
      setContent(""); setMediaUrl("");
      onClose?.();
    } catch (e) { alert(e.message); }
    finally { setPosting(false); }
  };

  return (
    <div style={{ padding: 16, borderBottom: `1px solid ${t.border}` }}>
      <textarea
        value={content}
        onChange={e => setContent(e.target.value.slice(0, 500))}
        placeholder="What's happening on IronShield?"
        rows={3}
        style={{
          width: "100%", background: "transparent", border: "none", color: t.text,
          fontSize: 17, outline: "none", resize: "vertical", fontFamily: "inherit",
        }}
      />
      {mediaUrl && (
        <div style={{ position: "relative", marginTop: 8, maxWidth: 360 }}>
          <img src={mediaUrl} alt="" style={{ width: "100%", borderRadius: 10 }} />
          <button onClick={() => setMediaUrl("")} style={{
            position: "absolute", top: 4, right: 4, background: "rgba(0,0,0,0.7)", color: "#fff",
            border: "none", borderRadius: "50%", width: 24, height: 24, cursor: "pointer",
          }}><X size={14} /></button>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button title="Paste image URL" onClick={() => {
            const u = prompt("Image / video URL (Cloudinary recommended)");
            if (u) setMediaUrl(u);
          }} style={iconBtn(t)}><ImageIcon size={18} color={t.accent} /></button>
          <span style={{ fontSize: 12, color: left < 50 ? t.amber : t.textDim }}>{left}</span>
        </div>
        <Btn primary onClick={submit} disabled={!content.trim() || posting} style={{ padding: "8px 18px" }}>
          {posting ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Post
        </Btn>
      </div>
    </div>
  );
}

/* ────────────────────────── Comments modal ────────────────────────── */
function CommentsModal({ post, wallet, onClose }) {
  const t = useTheme();
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api(`/api/social/comments/${post.id}`).then(r => setComments(r.comments)).catch(() => {});
  }, [post.id]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!text.trim() || !wallet) return;
    setBusy(true);
    try {
      await api("/api/social/comment", { method: "POST", wallet, body: { postId: post.id, content: text } });
      setText(""); load();
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} title="Comments">
      <div style={{ maxHeight: 360, overflowY: "auto", padding: "8px 0" }}>
        {comments.length === 0 && <p style={{ color: t.textDim, padding: 12 }}>No comments yet — be the first.</p>}
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
      {wallet && (
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input value={text} onChange={e => setText(e.target.value.slice(0, 500))}
            placeholder="Reply..." style={inputStyle(t)} />
          <Btn primary onClick={submit} disabled={busy || !text.trim()}>Reply</Btn>
        </div>
      )}
    </Modal>
  );
}

/* ────────────────────────── Modals shell ──────────────────────────── */
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
          <button onClick={onClose} style={iconBtn(t)}><X size={18} /></button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  );
}

function inputStyle(t) {
  return {
    flex: 1, padding: "10px 12px", background: t.bgSurface, border: `1px solid ${t.border}`,
    color: t.text, borderRadius: 10, outline: "none", fontSize: 14,
  };
}

/* ────────────────────────── Profile modal ─────────────────────────── */
function ProfileModal({ wallet, viewerWallet, onClose }) {
  const t = useTheme();
  const [user, setUser] = useState(null);
  const [posts, setPosts] = useState([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ displayName: "", bio: "", pfpUrl: "", bannerUrl: "" });

  useEffect(() => {
    api(`/api/profile/${wallet}`).then(r => {
      setUser(r.user);
      setForm({
        displayName: r.user.displayName || "",
        bio: r.user.bio || "",
        pfpUrl: r.user.pfpUrl || "",
        bannerUrl: r.user.bannerUrl || "",
      });
      api(`/api/profile/${r.user.id}/posts`, { wallet: viewerWallet }).then(p => setPosts(p.posts));
    }).catch(() => {});
  }, [wallet, viewerWallet]);

  const save = async () => {
    const r = await api("/api/profile", { method: "PATCH", wallet: viewerWallet, body: form });
    setUser(u => ({ ...u, ...r.user, displayName: r.user.display_name, pfpUrl: r.user.pfp_url, bannerUrl: r.user.banner_url }));
    setEditing(false);
  };

  if (!user) return <Modal onClose={onClose} title="Profile">Loading…</Modal>;
  const isMine = viewerWallet && user.walletAddress === viewerWallet;

  return (
    <Modal onClose={onClose} title={`@${user.username}`} maxWidth={620}>
      <div style={{ height: 120, background: user.bannerUrl ? `url(${user.bannerUrl}) center/cover` : `linear-gradient(135deg, ${t.accent}, #0ea5e9)`, borderRadius: 10, marginBottom: -36 }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", padding: "0 4px" }}>
        <Avatar user={{ pfp_url: user.pfpUrl, username: user.username }} size={72} />
        {isMine && <Btn onClick={() => setEditing(v => !v)} style={{ padding: "6px 14px" }}>{editing ? "Cancel" : "Edit"}</Btn>}
      </div>
      {!editing ? (
        <>
          <h2 style={{ margin: "10px 0 2px", color: t.white, display: "flex", alignItems: "center", gap: 8 }}>
            {user.displayName || user.username} <AccountChip type={user.accountType} />
          </h2>
          <div style={{ color: t.textDim, fontSize: 13 }}>@{user.username} · {shortWallet(user.walletAddress)}</div>
          <p style={{ color: t.text, marginTop: 8, fontSize: 14 }}>{user.bio || <em style={{ color: t.textDim }}>No bio yet</em>}</p>
          <div style={{ display: "flex", gap: 16, fontSize: 13, color: t.textMuted, marginTop: 8 }}>
            <span><strong style={{ color: t.white }}>{user.following}</strong> Following</span>
            <span><strong style={{ color: t.white }}>{user.followers}</strong> Followers</span>
            <span><strong style={{ color: t.white }}>{user.posts}</strong> Posts</span>
          </div>
        </>
      ) : (
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <input placeholder="Display name" value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} style={inputStyle(t)} />
          <textarea placeholder="Bio" value={form.bio} onChange={e => setForm({ ...form, bio: e.target.value })} style={{ ...inputStyle(t), minHeight: 70 }} />
          <input placeholder="Avatar URL" value={form.pfpUrl} onChange={e => setForm({ ...form, pfpUrl: e.target.value })} style={inputStyle(t)} />
          <input placeholder="Banner URL" value={form.bannerUrl} onChange={e => setForm({ ...form, bannerUrl: e.target.value })} style={inputStyle(t)} />
          <Btn primary onClick={save}>Save profile</Btn>
        </div>
      )}

      <h4 style={{ marginTop: 20, color: t.white, fontSize: 14 }}>Posts</h4>
      <div style={{ borderTop: `1px solid ${t.border}` }}>
        {posts.length === 0 && <p style={{ color: t.textDim, padding: 12 }}>No posts yet.</p>}
        {posts.map(p => (
          <div key={p.id} style={{ padding: "10px 0", borderBottom: `1px solid ${t.border}` }}>
            <div style={{ color: t.text, fontSize: 14 }}>{p.content}</div>
            <div style={{ color: t.textDim, fontSize: 12, marginTop: 4 }}>{timeAgo(p.createdAt)}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ────────────────────────── Org / Ad / Agent / DMs ─────────────────── */
function OrgBadgeModal({ wallet, onClose }) {
  const t = useTheme();
  const [orgName, setOrg] = useState("");
  const [tx, setTx] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api("/api/feed-org/register", { method: "POST", wallet, body: { orgName, paymentTxHash: tx } });
      alert("Org badge granted!");
      onClose();
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title="Become a verified Organization">
      <p style={{ color: t.textMuted, fontSize: 14 }}>Pay <strong style={{ color: t.amber }}>100 NEAR</strong> to the IronShield treasury and unlock the gold Org badge — for project teams, DAOs, and protocols.</p>
      <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
        <input placeholder="Organisation name" value={orgName} onChange={e => setOrg(e.target.value)} style={inputStyle(t)} />
        <input placeholder="Payment tx hash (100N transfer)" value={tx} onChange={e => setTx(e.target.value)} style={inputStyle(t)} />
        <Btn primary disabled={!orgName || !tx || busy} onClick={submit}>Verify & grant badge</Btn>
      </div>
    </Modal>
  );
}

function AdBoostModal({ post, wallet, onClose }) {
  const t = useTheme();
  const [tx, setTx] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await api("/api/ads/create", { method: "POST", wallet, body: { postId: post.id, paymentTxHash: tx } });
      alert("Boost active for 7 days");
      onClose();
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal onClose={onClose} title="Boost this post — $5 / week">
      <p style={{ color: t.textMuted, fontSize: 14 }}>Promoted posts surface in <strong>For You</strong> every 8 slots. Pay 5N to the treasury then paste the tx hash.</p>
      <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
        <input placeholder="Payment tx hash (5N)" value={tx} onChange={e => setTx(e.target.value)} style={inputStyle(t)} />
        <Btn primary disabled={!tx || busy} onClick={submit}>Activate boost</Btn>
      </div>
    </Modal>
  );
}

function AgentPanel({ wallet, onClose }) {
  const t = useTheme();
  const [agent, setAgent] = useState(null);
  const [tx, setTx] = useState("");
  const [cfg, setCfg] = useState({ postStyle: "", personality: [], postSchedule: "", commentRules: "", repostRules: "" });

  useEffect(() => {
    api("/api/feed-agent/mine/info", { wallet }).then(r => {
      setAgent(r.agent);
      if (r.agent) setCfg({
        postStyle: r.agent.post_style || "",
        personality: r.agent.personality || [],
        postSchedule: r.agent.post_schedule || "",
        commentRules: r.agent.comment_rules || "",
        repostRules: r.agent.repost_rules || "",
      });
    }).catch(() => {});
  }, [wallet]);

  const traits = ["Professional", "Witty", "Analytical", "Hype", "Cautious"];
  const togglePersona = (p) => setCfg(c => ({
    ...c, personality: c.personality.includes(p) ? c.personality.filter(x => x !== p) : [...c.personality, p],
  }));

  const deploy = async () => {
    try {
      const r = await api("/api/feed-agent/deploy", { method: "POST", wallet, body: { paymentTxHash: tx } });
      setAgent(r.agent);
    } catch (e) { alert(e.message); }
  };
  const save = async () => {
    const r = await api(`/api/feed-agent/${agent.id}/config`, { method: "PATCH", wallet, body: cfg });
    setAgent(r.agent);
    alert("Config saved");
  };

  if (!agent) {
    return (
      <Modal onClose={onClose} title="Deploy IronClaw Agent — 10N/month">
        <p style={{ color: t.textMuted, fontSize: 14 }}>Your AI persona will post, like, and comment under your handle on a schedule you control.</p>
        <input placeholder="Payment tx hash (10N)" value={tx} onChange={e => setTx(e.target.value)} style={{ ...inputStyle(t), marginTop: 12 }} />
        <Btn primary disabled={!tx} onClick={deploy} style={{ marginTop: 10 }}>Deploy agent</Btn>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} title="IronClaw Agent — config" maxWidth={620}>
      <div style={{ display: "grid", gap: 10 }}>
        <label style={lbl(t)}>Post style</label>
        <textarea value={cfg.postStyle} onChange={e => setCfg({ ...cfg, postStyle: e.target.value })}
          placeholder="Write like a researcher. Be concise and technical." style={{ ...inputStyle(t), minHeight: 60 }} />

        <label style={lbl(t)}>Personality</label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {traits.map(p => (
            <button key={p} onClick={() => togglePersona(p)} style={{
              padding: "6px 12px", borderRadius: 999, border: `1px solid ${cfg.personality.includes(p) ? t.accent : t.border}`,
              background: cfg.personality.includes(p) ? `${t.accent}22` : "transparent",
              color: cfg.personality.includes(p) ? t.accent : t.textMuted, cursor: "pointer", fontSize: 12,
            }}>{p}</button>
          ))}
        </div>

        <label style={lbl(t)}>Post schedule (cron)</label>
        <input placeholder="0 9,17 * * *" value={cfg.postSchedule} onChange={e => setCfg({ ...cfg, postSchedule: e.target.value })} style={inputStyle(t)} />

        <label style={lbl(t)}>Comment rules</label>
        <textarea value={cfg.commentRules} onChange={e => setCfg({ ...cfg, commentRules: e.target.value })}
          placeholder="Only comment on posts about Web3 security." style={{ ...inputStyle(t), minHeight: 50 }} />

        <label style={lbl(t)}>Repost rules</label>
        <textarea value={cfg.repostRules} onChange={e => setCfg({ ...cfg, repostRules: e.target.value })}
          placeholder="Repost anything mentioning @ironclaw or IronShield." style={{ ...inputStyle(t), minHeight: 50 }} />

        <Btn primary onClick={save}>Save config</Btn>
      </div>
    </Modal>
  );
}
function lbl(t) { return { color: t.textMuted, fontSize: 12, fontWeight: 600 }; }

/* ────────────────────────── DMs modal ─────────────────────────────── */
function DMsModal({ wallet, onClose }) {
  const t = useTheme();
  const [convs, setConvs] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [peerWallet, setPeerWallet] = useState("");

  useEffect(() => {
    api("/api/dm/conversations", { wallet }).then(r => setConvs(r.conversations)).catch(() => {});
  }, [wallet]);

  const open = async (c) => {
    setActive(c);
    const r = await api(`/api/dm/${c.id}/messages`, { wallet });
    setMessages(r.messages.reverse());
    api(`/api/dm/${c.id}/read`, { method: "POST", wallet }).catch(() => {});
  };

  const startNew = async () => {
    const r = await api("/api/dm/conversation", { method: "POST", wallet, body: { peerWallet } });
    const c = { id: r.conversationId, peer: r.peer, unread: 0 };
    setConvs(cs => [c, ...cs.filter(x => x.id !== c.id)]);
    open(c);
    setPeerWallet("");
  };

  const send = async () => {
    if (!text.trim() || !active) return;
    // MVP — encryption placeholder. Real impl uses tweetnacl.box with keys from a wallet signature.
    const encryptedPayload = btoa(unescape(encodeURIComponent(text)));
    const nonce = btoa(String(Date.now()));
    try {
      const r = await api("/api/dm/send", { method: "POST", wallet,
        body: { conversationId: active.id, encryptedPayload, nonce } });
      setMessages(m => [...m, r.message]);
      setText("");
    } catch (e) { alert(e.message); }
  };

  const decode = (m) => {
    try { return decodeURIComponent(escape(atob(m.encrypted_payload))); } catch { return "(unable to decrypt)"; }
  };

  return (
    <Modal onClose={onClose} title="Direct Messages" maxWidth={780}>
      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 12, height: 480 }}>
        <div style={{ borderRight: `1px solid ${t.border}`, paddingRight: 10, overflowY: "auto" }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <input placeholder="wallet.near" value={peerWallet} onChange={e => setPeerWallet(e.target.value)} style={inputStyle(t)} />
            <Btn primary onClick={startNew} disabled={!peerWallet}>New</Btn>
          </div>
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
                <div style={{ color: t.textDim, fontSize: 11 }}>{c.unread > 0 && <span style={{ color: t.accent }}>● </span>}{shortWallet(c.peer.wallet)}</div>
              </div>
            </div>
          ))}
          {convs.length === 0 && <p style={{ color: t.textDim, fontSize: 13 }}>No conversations yet.</p>}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {!active ? <p style={{ color: t.textDim, padding: 20 }}>Select a conversation</p> : (
            <>
              <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
                {messages.map(m => (
                  <div key={m.id} style={{ display: "flex", justifyContent: m.from_id === active.peer.id ? "flex-start" : "flex-end", marginBottom: 6 }}>
                    <div style={{
                      background: m.from_id === active.peer.id ? t.bgSurface : t.accent,
                      color: m.from_id === active.peer.id ? t.text : "#fff",
                      padding: "8px 12px", borderRadius: 14, maxWidth: "75%", fontSize: 14,
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

/* ────────────────────────── Notifications ─────────────────────────── */
function NotificationsModal({ wallet, onClose }) {
  const t = useTheme();
  const [items, setItems] = useState([]);
  useEffect(() => {
    api("/api/notifications", { wallet }).then(r => setItems(r.notifications)).catch(() => {});
    api("/api/notifications/read-all", { method: "POST", wallet }).catch(() => {});
  }, [wallet]);
  const verb = { like: "liked your post", comment: "commented on your post", follow: "followed you",
    repost: "reposted your post", agent: "agent activity", ad: "ad impression" };
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

/* ────────────────────────── Main page ─────────────────────────────── */
export default function IronFeedPage({ openWallet }) {
  const t = useTheme();
  const { connected, address } = useWallet();
  const wallet = connected ? address : null;

  const [tab, setTab] = useState("foryou"); // foryou | following
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [openComments, setOpenComments] = useState(null);
  const [openProfile, setOpenProfile] = useState(null);
  const [openOrg, setOpenOrg] = useState(false);
  const [openAgent, setOpenAgent] = useState(false);
  const [openDMs, setOpenDMs] = useState(false);
  const [openNotifs, setOpenNotifs] = useState(false);
  const [boostPost, setBoostPost] = useState(null);

  const load = useCallback(async (reset = true) => {
    setLoading(true);
    try {
      const r = await api(`/api/feed/${tab}${reset ? "" : `?cursor=${encodeURIComponent(cursor || "")}`}`, { wallet });
      setPosts(p => reset ? r.posts : [...p, ...r.posts]);
      setCursor(r.nextCursor);
    } catch (e) { console.warn(e.message); }
    finally { setLoading(false); }
  }, [tab, cursor, wallet]);

  useEffect(() => { load(true); /* eslint-disable-next-line */ }, [tab, wallet]);

  const onPosted = (p) => setPosts(prev => [p, ...prev]);

  const share = (p) => {
    const url = `https://ironshield.near.page/#/feed/post/${p.id}`;
    if (navigator.share) navigator.share({ title: "IronFeed", text: p.content, url }).catch(() => {});
    else { navigator.clipboard.writeText(url); alert("Link copied"); }
  };

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "84px 16px 80px",
      display: "grid", gridTemplateColumns: "1fr 280px", gap: 20 }}>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
        @media (max-width: 880px){ .ifeed-grid{ grid-template-columns:1fr !important } .ifeed-side{ display:none } }`}</style>

      {/* Main column */}
      <div style={{ background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 16, overflow: "hidden" }}>
        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${t.border}`, position: "sticky", top: 64, background: t.bgCard, zIndex: 5 }}>
          {[["foryou", "For You", Sparkles], ["following", "Following", Star]].map(([k, label, Icon]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              flex: 1, padding: "14px 0", background: "none", border: "none", cursor: "pointer",
              color: tab === k ? t.white : t.textMuted, fontWeight: 700, fontSize: 14,
              borderBottom: tab === k ? `3px solid ${t.accent}` : "3px solid transparent",
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}><Icon size={14} /> {label}</button>
          ))}
        </div>

        {/* Compose */}
        {wallet ? <ComposePost wallet={wallet} onPosted={onPosted} /> : (
          <div style={{ padding: 18, borderBottom: `1px solid ${t.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: t.textMuted, fontSize: 14 }}>Connect wallet to post</span>
            <Btn primary onClick={openWallet}>Connect</Btn>
          </div>
        )}

        {/* Feed */}
        {posts.length === 0 && !loading && (
          <div style={{ padding: 40, textAlign: "center", color: t.textDim }}>
            {tab === "following" ? "Follow people to see their posts here." : "No posts yet — be first!"}
          </div>
        )}
        {posts.map(p => (
          <PostCard key={p.id + (p._promoted ? "-ad" : "")} post={p} viewerWallet={wallet}
            onRefresh={() => load(true)}
            onOpenComments={() => setOpenComments(p)}
            onShare={() => share(p)}
            onBoost={() => setBoostPost(p)} />
        ))}
        {cursor && (
          <div style={{ textAlign: "center", padding: 16 }}>
            <Btn onClick={() => load(false)} disabled={loading}>{loading ? "Loading…" : "Load more"}</Btn>
          </div>
        )}
      </div>

      {/* Sidebar */}
      <aside className="ifeed-side" style={{ position: "sticky", top: 84, alignSelf: "flex-start" }}>
        <Card style={{ padding: 14 }}>
          <h4 style={{ margin: "0 0 10px", color: t.white, fontSize: 14 }}>Your IronFeed</h4>
          <SideBtn icon={User} label="My profile" disabled={!wallet} onClick={() => setOpenProfile(wallet)} t={t} />
          <SideBtn icon={Bell} label="Notifications" disabled={!wallet} onClick={() => setOpenNotifs(true)} t={t} />
          <SideBtn icon={MessageSquare} label="Messages" disabled={!wallet} onClick={() => setOpenDMs(true)} t={t} />
          <SideBtn icon={Bot} label="Deploy Agent" disabled={!wallet} onClick={() => setOpenAgent(true)} t={t} />
          <SideBtn icon={Building2} label="Org badge" disabled={!wallet} onClick={() => setOpenOrg(true)} t={t} />
        </Card>
        <Card style={{ padding: 14, marginTop: 12 }}>
          <h4 style={{ margin: "0 0 8px", color: t.white, fontSize: 14 }}>About IronFeed</h4>
          <p style={{ color: t.textMuted, fontSize: 12, lineHeight: 1.5, margin: 0 }}>
            All likes, reposts and comments are batched on-chain every 60s — gasless to you.
            DMs are end-to-end encrypted.
          </p>
        </Card>
      </aside>

      {openComments && <CommentsModal post={openComments} wallet={wallet} onClose={() => setOpenComments(null)} />}
      {openProfile && <ProfileModal wallet={openProfile} viewerWallet={wallet} onClose={() => setOpenProfile(null)} />}
      {openOrg && <OrgBadgeModal wallet={wallet} onClose={() => setOpenOrg(false)} />}
      {openAgent && <AgentPanel wallet={wallet} onClose={() => setOpenAgent(false)} />}
      {openDMs && <DMsModal wallet={wallet} onClose={() => setOpenDMs(false)} />}
      {openNotifs && <NotificationsModal wallet={wallet} onClose={() => setOpenNotifs(false)} />}
      {boostPost && <AdBoostModal post={boostPost} wallet={wallet} onClose={() => setBoostPost(null)} />}
    </div>
  );
}

function SideBtn({ icon: Icon, label, onClick, disabled, t }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 12px",
      background: "none", border: "none", color: disabled ? t.textDim : t.text,
      cursor: disabled ? "not-allowed" : "pointer", borderRadius: 8, fontSize: 13, textAlign: "left",
    }}
      onMouseEnter={e => !disabled && (e.currentTarget.style.background = t.bgSurface)}
      onMouseLeave={e => e.currentTarget.style.background = "none"}>
      <Icon size={16} /> {label}
    </button>
  );
}
