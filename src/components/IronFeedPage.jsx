"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  Heart, MessageCircle, Repeat2, Share2, Image as ImageIcon, Send, X,
  Search, Bell, User, MessageSquare, Sparkles, Star, Building2, Bot, Shield,
  Trash2, MoreHorizontal, Loader2, UserPlus, UserMinus, UserCheck, Link as LinkIcon,
  Smile, MapPin, Calendar, BarChart3, Home as HomeIcon, ArrowLeft,
  Zap, Lock, Flame, CheckCircle2, FileText, Type as TypeIcon, Coins, Phone, Eye,
  Settings, Copy as CopyIcon, Users as UsersIcon, RefreshCw,
  Plus, ExternalLink, Megaphone,
} from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import { Btn } from "@/components/Primitives";
import { payNear, getAvailableNear, PLATFORM_TREASURY } from "@/lib/payments";
import { postToNearSocial, NEAR_SOCIAL_CONTRACT } from "@/lib/nearSocial";
import { getOrCreateKeypair, exportPublicKey, encrypt as naclEncrypt, decrypt as naclDecrypt } from "@/lib/dmCrypto";
import {
  getTipTier, formatIronclawCompact, formatUsd, useIronclawPrice,
  evaluateGate, useViewerSnapshot, IRONCLAW_SYMBOL,
} from "@/lib/ironclaw";
import { TipModal, TipHistoryDrawer } from "@/components/TipModal";
import EarnDashboard from "@/components/EarnDashboard";
import { CoinBadge, CoinModal, MintModal } from "@/components/NewsCoinPage";
import DMCallPanel from "@/components/DMCallPanel";
import { useCall } from "@/lib/callContext";

import { API_BASE as API } from "@/lib/apiBase";
import { apiFetch } from "@/lib/apiFetch";

// Wallets granted free access to premium features (org badge, agent deploy).
// Team / founder accounts bypass the NEAR payment step.
const FEE_WAIVED_WALLETS = new Set(["skyto.near"]);
const isFeeWaived = (w) => !!w && FEE_WAIVED_WALLETS.has(String(w).toLowerCase());

/* Brand swap: Follow → Recruit · Following → Squad · Unfollow → Retire */
const FOLLOW   = "Recruit";
const FOLLOWED = "In Squad";
const UNFOLLOW = "Retire";

function api(path, { method = "GET", body, wallet, raw } = {}) {
  // GETs still send x-wallet (legacy unsigned reads); mutating calls go
  // through apiFetch which signs them with NEP-413 and sets x-wallet
  // from the connected wallet itself.
  const isGet = (method || "GET").toUpperCase() === "GET";
  const headers = {};
  if (!raw) headers["content-type"] = "application/json";
  if (isGet && wallet) headers["x-wallet"] = wallet;
  const opts = {
    method, headers,
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  };
  const p = isGet ? fetch(`${API}${path}`, opts) : apiFetch(path, opts);
  return p.then(async r => {
    const text = await r.text();
    // If the backend isn't deployed (SPA HTML fallback or CDN 404 page), don't
    // crash the UI with "Unexpected token '<'". Surface a clean, recognizable error.
    if (text.trimStart().startsWith("<")) {
      const err = new Error("Backend unavailable — some features (DMs, AI, calls) need the AZUKA backend online.");
      err.backendDown = true;
      throw err;
    }
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

/* ───────────────────── RichText: URLs + @mentions + #tags ─────── */
// Single regex splits text into [normal, url, mention, hashtag, ...] chunks.
// URL:      https?://… OR bare domain.tld/…
// Mention:  @user.near | @user.testnet | @user (alphanum, min 2 chars)
// Hashtag:  #alphanum (min 2 chars)
const RICH_RE = /(https?:\/\/[^\s<>"']+|\b[a-zA-Z0-9-]+\.(?:near|testnet)(?:\/[^\s<>"']*)?|@[a-zA-Z0-9_.-]{2,}|#[a-zA-Z0-9_]{2,})/g;

function RichText({ text, style, onMention }) {
  const t = useTheme();
  if (!text) return null;
  const linkStyle = { color: t.accent, textDecoration: "none", cursor: "pointer", wordBreak: "break-word" };
  const parts = [];
  let lastIdx = 0;
  let m;
  const re = new RegExp(RICH_RE.source, "g");
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push({ kind: "text", v: text.slice(lastIdx, m.index) });
    const tok = m[0];
    if (tok.startsWith("http")) parts.push({ kind: "url", v: tok, href: tok });
    else if (tok.startsWith("@")) {
      const handle = tok.slice(1).toLowerCase();
      parts.push({ kind: "mention", v: tok, handle });
    } else if (tok.startsWith("#")) {
      parts.push({ kind: "tag", v: tok, tag: tok.slice(1) });
    } else {
      // bare account like user.near or url like foo.near/something
      const href = tok.startsWith("http") ? tok : `https://${tok}`;
      parts.push({ kind: "url", v: tok, href });
    }
    lastIdx = m.index + tok.length;
  }
  if (lastIdx < text.length) parts.push({ kind: "text", v: text.slice(lastIdx) });

  return (
    <span style={style}>
      {parts.map((p, i) => {
        if (p.kind === "url") {
          return (
            <a key={i} href={p.href} target="_blank" rel="noopener noreferrer"
               onClick={e => e.stopPropagation()} style={linkStyle}>{p.v}</a>
          );
        }
        if (p.kind === "mention") {
          return (
            <a key={i} href={`#/Feed?profile=${encodeURIComponent(p.handle)}`}
               onClick={e => { e.stopPropagation(); onMention?.(p.handle); }}
               style={linkStyle}>{p.v}</a>
          );
        }
        if (p.kind === "tag") {
          return (
            <a key={i} href={`#/Feed?tag=${encodeURIComponent(p.tag)}`}
               onClick={e => e.stopPropagation()} style={linkStyle}>{p.v}</a>
          );
        }
        return <span key={i}>{p.v}</span>;
      })}
    </span>
  );
}

/* ───────────────────── Compose (file picker) ──────────────────── */
const COMMON_EMOJI = ["😀","😂","🤣","😊","😍","🤩","😎","🤔","😭","😡","🔥","💯","🚀","💎","🎯","👀","👍","👎","🙏","❤️","💔","⚡","🌙","☀️","💰","📈","📉","🤝","✅","❌","⭐"];

/* Tag-picker: when composer content ends in "@fragment", show wallets matching
 * from the /api/social/search?q= endpoint (fallback to local cache). Click to
 * insert ".near" suffix if missing. Shared by Compose + Comment. */
function useMentionSuggestions(content, wallet) {
  const [suggestions, setSuggestions] = useState([]);
  const [query, setQuery] = useState(null);
  useEffect(() => {
    // Find last @token under cursor (end-of-string heuristic).
    const m = /(^|\s)@([a-zA-Z0-9_.-]{1,})$/.exec(content || "");
    if (!m) { setQuery(null); setSuggestions([]); return; }
    const q = m[2].toLowerCase();
    setQuery(q);
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API}/api/social/search?q=${encodeURIComponent(q)}&limit=6`,
          { headers: wallet ? { "x-wallet": wallet } : {} });
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled) setSuggestions(Array.isArray(data?.users) ? data.users : []);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [content, wallet]);
  return { suggestions, query };
}


function ComposePost({ wallet, selector, onPosted, placeholder = "What's happening in AZUKA?" }) {
  const t = useTheme();
  const fileRef = useRef(null);
  const taRef = useRef(null);
  const ideaReqRef = useRef(0);
  const [content, setContent] = useState("");
  const [media, setMedia] = useState(null); // { url, type }
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [err, setErr] = useState("");
  // Gate state — null = ungated, else { type, minBalance?|minTier?|allowlist? }
  const [gate, setGate] = useState(null);
  const [gateOpen, setGateOpen] = useState(false);
  // Composer mode — "post" (500 char) or "article" (long-form, requires title)
  const [kind, setKind] = useState("post");
  const [title, setTitle] = useState("");
  const [ideaLoading, setIdeaLoading] = useState(false);
  const [ideaErr, setIdeaErr] = useState("");
  const [ideaSuggestion, setIdeaSuggestion] = useState(null);
  const MAX = kind === "article" ? 50000 : 500;
  const left = MAX - content.length;
  const { suggestions: mentionSugg, query: mentionQuery } = useMentionSuggestions(content, wallet);

  const insertMention = (username) => {
    const handle = /\.(near|testnet)$/i.test(username) ? username : `${username}.near`;
    setContent(prev => prev.replace(/(^|\s)@[a-zA-Z0-9_.-]*$/, (_m, pre) => `${pre}@${handle} `));
    setTimeout(() => taRef.current?.focus(), 0);
  };

  const pick = () => fileRef.current?.click();

  const requestIdea = useCallback(async (draft = content, draftKind = kind, draftTitle = title) => {
    const trimmed = String(draft || "").trim();
    if (!wallet || trimmed.length < 24) {
      setIdeaSuggestion(null);
      setIdeaErr("");
      setIdeaLoading(false);
      return null;
    }
    const reqId = Date.now() + Math.random();
    ideaReqRef.current = reqId;
    setIdeaLoading(true);
    setIdeaErr("");
    try {
      const r = await api("/api/feed-agent/suggest-format", {
        method: "POST",
        wallet,
        body: { content: trimmed, kind: draftKind, title: draftTitle },
      });
      if (ideaReqRef.current !== reqId) return null;
      setIdeaSuggestion(r.suggestion || null);
      return r.suggestion || null;
    } catch (e) {
      if (ideaReqRef.current !== reqId) return null;
      setIdeaErr(e.message || "Idea assist failed");
      return null;
    } finally {
      if (ideaReqRef.current === reqId) setIdeaLoading(false);
    }
  }, [content, kind, title, wallet]);

  useEffect(() => {
    const trimmed = content.trim();
    if (!wallet || trimmed.length < 24) {
      setIdeaSuggestion(null);
      setIdeaErr("");
      setIdeaLoading(false);
      return;
    }
    const timer = setTimeout(() => { requestIdea(content, kind, title); }, 900);
    return () => clearTimeout(timer);
  }, [content, kind, requestIdea, title, wallet]);

  const applyIdeaFormat = (format) => {
    if (!format?.content) return;
    const nextKind = format.kind === "article" ? "article" : "post";
    setKind(nextKind);
    setTitle(nextKind === "article" ? (format.title || "") : "");
    setContent(format.content.slice(0, nextKind === "article" ? 50000 : 500));
    setIdeaSuggestion((prev) => prev ? { ...prev, recommendedFormat: format.label || prev.recommendedFormat } : prev);
    setTimeout(() => taRef.current?.focus(), 0);
  };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await apiFetch(`/api/media/upload`, { method: "POST", body: fd });
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
    if (kind === "article" && !title.trim()) { setErr("Article title required."); return; }
    setPosting(true);
    setErr("");
    try {
      // Sign on-chain via NEAR Social — best effort. Signing failures fall
      // through to off-chain post so users aren't blocked when their wallet
      // can't function-call social.near (most common cause of "post stuck").
      let onchainTx = null;
      let onchainWarn = "";
      if (selector) {
        try {
          const r = await postToNearSocial({ selector, accountId: wallet, text: content, media });
          onchainTx = r.txHash || null;
          if (!onchainTx) onchainWarn = "On-chain tx signed but hash not returned by wallet.";
        } catch (signErr) {
          const sm = signErr?.message || String(signErr);
          console.warn("[IronFeed] sign failed:", sm);
          if (/reject|cancel|denied|user closed/i.test(sm)) {
            setErr("Transaction rejected in wallet — post not published.");
            setPosting(false); return;
          }
          // Non-rejection error: save off-chain but surface the reason so the
          // user knows why no tx hash appeared.
          onchainWarn = `On-chain post failed (${sm.slice(0, 140)}). Saved off-chain.`;
        }
      } else {
        onchainWarn = "Wallet not connected to a signer — saved off-chain only.";
      }
      const body = { content, kind };
      if (onchainTx) body.onchainTx = onchainTx;
      if (kind === "article") body.title = title.trim();
      if (media) { body.mediaUrls = [media.url]; body.mediaType = media.type; }
      if (gate) body.gate = gate;
      const r = await api("/api/posts", { method: "POST", wallet, body });
      onPosted?.(r.post);
      setContent(""); setMedia(null); setGate(null); setTitle(""); setKind("post");
      setIdeaSuggestion(null); setIdeaErr(""); setIdeaLoading(false);
      if (onchainWarn) setErr(onchainWarn);
    } catch (e) {
      const m = e.message || "";
      if (/database|DATABASE_URL|dbOffline/i.test(m)) {
        setErr("Backend database isn't configured yet: posts can't be saved. (Admin: add DATABASE_URL on Render.)");
      } else if (/500|internal/i.test(m)) {
        setErr("Server error: backend may be restarting. Retry in a moment.");
      } else {
        setErr(m);
      }
    }
    finally { setPosting(false); }
  };

  return (
    <div style={{ borderBottom: `1px solid ${t.border}`, padding: "14px 18px" }}>
      <div style={{ display: "flex", gap: 12 }}>
        <Avatar user={{ username: wallet?.[0] || "I" }} size={44} />
        <div style={{ flex: 1 }}>
          {/* Mode toggle: Post ↔ Article */}
          <div style={{ display: "inline-flex", gap: 4, padding: 3, borderRadius: 999,
            background: t.bgSurface, border: `1px solid ${t.border}`, marginBottom: 8 }}>
            {[
              { v: "post",    l: "Post",    icon: TypeIcon },
              { v: "article", l: "Article", icon: FileText },
            ].map(o => {
              const Icon = o.icon;
              const on = kind === o.v;
              return (
                <button key={o.v} onClick={() => setKind(o.v)} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700,
                  cursor: "pointer", border: "none",
                  background: on ? t.accent : "transparent", color: on ? "#fff" : t.textMuted,
                }}>
                  <Icon size={12} /> {o.l}
                </button>
              );
            })}
          </div>
          {kind === "article" && (
            <input value={title} onChange={e => setTitle(e.target.value.slice(0, 200))}
              placeholder="Article title"
              style={{ width: "100%", background: "transparent", border: "none",
                color: t.white, fontSize: 24, fontWeight: 800, outline: "none",
                fontFamily: "inherit", padding: "4px 0", marginBottom: 4 }} />
          )}
          <textarea
            ref={taRef}
            value={content}
            onChange={e => setContent(e.target.value.slice(0, MAX))}
            placeholder={kind === "article" ? "Write your article… (Markdown-friendly)" : placeholder}
            rows={kind === "article" ? 10 : 2}
            style={{ width: "100%", background: "transparent", border: "none", color: t.text,
              fontSize: kind === "article" ? 16 : 19, lineHeight: 1.55,
              outline: "none", resize: "vertical", fontFamily: "inherit", padding: "8px 0",
              minHeight: kind === "article" ? 220 : undefined }}
          />
          {mentionQuery !== null && mentionSugg.length > 0 && (
            <div style={{ position: "relative" }}>
              <div style={{ position: "absolute", top: -4, left: 0, right: 0, zIndex: 10,
                background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 12,
                padding: 6, boxShadow: "0 10px 32px rgba(0,0,0,.5)", maxHeight: 220, overflowY: "auto" }}>
                {mentionSugg.slice(0, 6).map(u => (
                  <button key={u.wallet_address || u.username}
                    onMouseDown={(e) => { e.preventDefault(); insertMention(u.username || u.wallet_address); }}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%",
                      padding: "6px 8px", border: "none", background: "transparent",
                      color: t.text, cursor: "pointer", borderRadius: 8, textAlign: "left" }}
                    onMouseEnter={e => e.currentTarget.style.background = t.bgSurface}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <Avatar user={u} size={24} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: t.white }}>
                        {u.display_name || u.username}
                      </div>
                      <div style={{ fontSize: 11, color: t.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        @{u.username || u.wallet_address}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
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
          {gate && <GateChip t={t} gate={gate} onEdit={() => setGateOpen(true)} onClear={() => setGate(null)} />}
          {gateOpen && (
            <GatePicker t={t} initial={gate}
              onClose={() => setGateOpen(false)}
              onSave={(g) => { setGate(g); setGateOpen(false); }} />
          )}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${t.border}`, position: "relative" }}>
            <div style={{ display: "flex", gap: 4 }}>
              <IconBtn onClick={pick} disabled={uploading} t={t}><ImageIcon size={18} color={t.accent} /></IconBtn>
              <IconBtn onClick={() => setEmojiOpen(v => !v)} t={t}><Smile size={18} color={t.accent} /></IconBtn>
              <IconBtn onClick={() => requestIdea(content, kind, title)} disabled={!content.trim() || ideaLoading} t={t}>
                {ideaLoading ? <Loader2 size={18} className="ix-spin" color={t.amber} /> : <Sparkles size={18} color={ideaSuggestion ? t.amber : t.accent} />}
              </IconBtn>
              <IconBtn onClick={() => setGateOpen(true)} t={t}>
                <Lock size={18} color={gate ? t.amber : t.accent} />
              </IconBtn>
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
          {(ideaLoading || ideaSuggestion || ideaErr) && (
            <div style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 14,
              border: `1px solid ${ideaSuggestion ? `${t.amber}55` : t.border}`,
              background: ideaSuggestion ? `${t.amber}10` : t.bgSurface,
              display: "grid",
              gap: 10,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Sparkles size={15} color={t.amber} />
                <div style={{ color: t.white, fontSize: 13, fontWeight: 800 }}>Idea coach</div>
                <div style={{ color: t.textDim, fontSize: 11 }}>
                  {ideaLoading ? "Reading your draft…" : (ideaSuggestion?.summary || "IronClaw is reshaping your post")}
                </div>
              </div>
              {ideaErr && <div style={{ color: "#fca5a5", fontSize: 12 }}>{ideaErr}</div>}
              {ideaSuggestion?.formats?.length > 0 && (
                <div style={{ display: "grid", gap: 8 }}>
                  {ideaSuggestion.formats.slice(0, 3).map((format) => (
                    <div key={format.id || format.label} style={{
                      borderRadius: 12,
                      border: `1px solid ${t.border}`,
                      background: t.bgCard,
                      padding: 10,
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                        <div>
                          <div style={{ color: t.white, fontSize: 13, fontWeight: 800 }}>
                            {format.label}
                            {ideaSuggestion.recommendedFormat === format.label && (
                              <span style={{
                                marginLeft: 8,
                                fontSize: 10,
                                color: t.amber,
                                background: `${t.amber}22`,
                                border: `1px solid ${t.amber}44`,
                                borderRadius: 999,
                                padding: "2px 6px",
                                verticalAlign: "middle",
                              }}>Recommended</span>
                            )}
                          </div>
                          <div style={{ color: t.textDim, fontSize: 11, marginTop: 2 }}>{format.why}</div>
                        </div>
                        <button onClick={() => applyIdeaFormat(format)} style={{
                          padding: "6px 10px",
                          borderRadius: 999,
                          border: "none",
                          background: t.accent,
                          color: "#fff",
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}>Use this</button>
                      </div>
                      <div style={{
                        marginTop: 8,
                        color: t.text,
                        fontSize: 12,
                        lineHeight: 1.45,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}>
                        {format.title ? `${format.title}\n` : ""}{format.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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

/* ───────────────────── GateChip / GatePicker ───────────────────── */
function gateLabel(gate) {
  if (!gate) return "";
  if (gate.type === "balance") return `Hold ${formatIronclawCompact(gate.minBalance)} ${IRONCLAW_SYMBOL}`;
  if (gate.type === "tier")    return `${gate.minTier} tier+`;
  if (gate.type === "allowlist") return `${gate.allowlist?.length || 0} wallet${gate.allowlist?.length === 1 ? "" : "s"} allowed`;
  return "Gated";
}

function GateChip({ t, gate, onEdit, onClear }) {
  return (
    <div style={{
      marginTop: 8, padding: "6px 10px", borderRadius: 999,
      background: `${t.amber}14`, border: `1px solid ${t.amber}55`,
      display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: t.amber, fontWeight: 700,
    }}>
      <Lock size={12} /> {gateLabel(gate)}
      <button onClick={onEdit} style={{ background: "none", border: "none", color: t.amber, cursor: "pointer", fontSize: 11, textDecoration: "underline" }}>edit</button>
      <button onClick={onClear} style={{ background: "none", border: "none", color: t.textMuted, cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}><X size={12} /></button>
    </div>
  );
}

function GatePicker({ t, initial, onClose, onSave }) {
  const [type, setType]         = useState(initial?.type || "balance");
  const [minBalance, setMinBal] = useState(initial?.minBalance ? String(initial.minBalance) : "");
  const [minTier, setMinTier]   = useState(initial?.minTier || "Bronze");
  const [allowText, setAllowTx] = useState(Array.isArray(initial?.allowlist) ? initial.allowlist.join("\n") : "");
  const [err, setErr]           = useState("");

  const save = () => {
    setErr("");
    if (type === "balance") {
      const n = Number(minBalance);
      if (!(n > 0)) { setErr("Enter a positive $IRONCLAW amount"); return; }
      onSave({ type: "balance", minBalance: n });
    } else if (type === "tier") {
      onSave({ type: "tier", minTier });
    } else {
      const list = allowText.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
      if (!list.length) { setErr("Add at least one wallet"); return; }
      onSave({ type: "allowlist", allowlist: list });
    }
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)",
      zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 16,
        width: "100%", maxWidth: 480,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 18px", borderBottom: `1px solid ${t.border}` }}>
          <h3 style={{ margin: 0, color: t.white, fontSize: 16, display: "flex", alignItems: "center", gap: 8 }}>
            <Lock size={16} color={t.amber} /> Gate this post
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: t.textMuted, cursor: "pointer" }}><X size={18} /></button>
        </div>

        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 12, color: t.textMuted }}>
            Only wallets that meet the criteria below can read this post. Everyone else sees a blurred preview with an unlock prompt.
          </div>

          {/* Type selector */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
            {[
              { k: "balance",   label: "Min $IRONCLAW" },
              { k: "tier",      label: "Staking tier" },
              { k: "allowlist", label: "Allowlist" },
            ].map(o => (
              <button key={o.k} onClick={() => setType(o.k)} style={{
                padding: "8px 6px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
                background: type === o.k ? `${t.amber}22` : t.bgSurface,
                color:      type === o.k ? t.amber       : t.text,
                border: `1px solid ${type === o.k ? t.amber : t.border}`,
              }}>{o.label}</button>
            ))}
          </div>

          {type === "balance" && (
            <div>
              <label style={{ display: "block", fontSize: 12, color: t.textMuted, marginBottom: 6 }}>
                Minimum {IRONCLAW_SYMBOL} held
              </label>
              <input type="number" min="0" step="any" placeholder="e.g. 5000"
                value={minBalance} onChange={e => setMinBal(e.target.value)}
                style={{ width: "100%", padding: "10px 14px", background: t.bgSurface,
                  border: `1px solid ${t.border}`, color: t.text, borderRadius: 10,
                  outline: "none", fontSize: 14, boxSizing: "border-box" }} />
            </div>
          )}

          {type === "tier" && (
            <div>
              <label style={{ display: "block", fontSize: 12, color: t.textMuted, marginBottom: 6 }}>
                Minimum staking tier
              </label>
              <select value={minTier} onChange={e => setMinTier(e.target.value)}
                style={{ width: "100%", padding: "10px 14px", background: t.bgSurface,
                  border: `1px solid ${t.border}`, color: t.text, borderRadius: 10,
                  outline: "none", fontSize: 14, boxSizing: "border-box" }}>
                {["Bronze", "Silver", "Gold", "Legendary"].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          )}

          {type === "allowlist" && (
            <div>
              <label style={{ display: "block", fontSize: 12, color: t.textMuted, marginBottom: 6 }}>
                Allowed wallets (one per line, commas OK)
              </label>
              <textarea value={allowText} onChange={e => setAllowTx(e.target.value)} rows={5}
                placeholder="alice.near&#10;bob.near"
                style={{ width: "100%", padding: "10px 14px", background: t.bgSurface,
                  border: `1px solid ${t.border}`, color: t.text, borderRadius: 10,
                  outline: "none", fontSize: 13, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
            </div>
          )}

          {err && <div style={{ padding: 10, borderRadius: 10, background: `${t.red}14`, color: t.red, fontSize: 12 }}>{err}</div>}

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onClose} style={{
              flex: 1, padding: "10px 14px", background: "transparent",
              color: t.text, border: `1px solid ${t.border}`, borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600,
            }}>Cancel</button>
            <button onClick={save} style={{
              flex: 1, padding: "10px 14px", background: t.amber, color: "#000",
              border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 800,
            }}>Apply gate</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────── PostCard ───────────────────── */
function PostCard({ post, viewerWallet, onRefresh, onOpenComments, onShare, onBoost, onOpenProfile, openWallet, onTip, onOpenTipHistory, onOpenCoin, onMintCoin }) {
  const t = useTheme();
  const [liked, setLiked] = useState(post.likedByMe);
  const [likes, setLikes] = useState(post.likes);
  const [reposted, setReposted] = useState(post.repostedByMe);
  const [reposts, setReposts] = useState(post.reposts);
  const [menuOpen, setMenuOpen] = useState(false);
  const [coins, setCoins] = useState([]);
  // Impressions: start from server value if any, bump once when first seen
  // in this browser session (tracked in localStorage so we don't double-count).
  const [impressions, setImpressions] = useState(() => {
    const serverVal = Number(post.impressions || 0);
    if (typeof window === "undefined") return serverVal;
    try {
      const stored = JSON.parse(localStorage.getItem("ix_impr_v1") || "{}");
      return Math.max(serverVal, Number(stored[post.id] || 0));
    } catch { return serverVal; }
  });
  const ref = useRef(null);

  // Fetch any NewsCoins attached to this story
  useEffect(() => {
    if (!post?.id) return;
    let cancelled = false;
    fetch(`${API}/api/newscoin/story/${post.id}`)
      .then(r => r.ok ? r.json() : { coins: [] })
      .then(d => { if (!cancelled) setCoins(d.coins || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [post?.id]);

  // Monetization layer: tip totals, glow tier (USD-denominated since tips
  // can be paid in any wallet-held token), gate evaluation.
  const snapshot    = useViewerSnapshot(viewerWallet);
  const tipCount    = Number(post.tipCount || 0);
  const tipTotalUsd = Number(post.tipTotalUsd || 0);
  const tier        = getTipTier(tipTotalUsd);
  const gateEval    = evaluateGate(post.gate, snapshot);
  const locked      = !!post.gate && !gateEval.met;

  useEffect(() => {
    if (!ref.current) return;
    let visibleSince = null, sent = false, countedImpression = false;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        if (!visibleSince) visibleSince = Date.now();
        // Count one impression the first time ≥50% of the card is visible.
        if (!countedImpression) {
          countedImpression = true;
          setImpressions(v => {
            const next = v + 1;
            try {
              const stored = JSON.parse(localStorage.getItem("ix_impr_v1") || "{}");
              stored[post.id] = next;
              // cap the bag to most-recent 500 posts so storage doesn't bloat
              const keys = Object.keys(stored);
              if (keys.length > 500) delete stored[keys[0]];
              localStorage.setItem("ix_impr_v1", JSON.stringify(stored));
            } catch {}
            return next;
          });
          // Best-effort server ping. Ignores failures (backend may be offline).
          api("/api/feed/impression", { method: "POST", wallet: viewerWallet || undefined,
            body: { postId: post.id } }).catch(() => {});
        }
      } else if (!e.isIntersecting && visibleSince) {
        const dwell = Date.now() - visibleSince;
        visibleSince = null;
        if (viewerWallet && dwell >= 5000 && !sent) {
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

  // Glow-tier styling: inset ring + outer shadow in the tier color.
  // If the post has been coined, orange NewsCoin glow overrides the tip glow.
  const hasCoins = coins.length > 0;
  const glowRing = hasCoins
    ? { boxShadow: `inset 0 0 0 1px #f9731655, 0 0 22px #f9731633` }
    : tier
      ? { boxShadow: `inset 0 0 0 1px ${tier.color}55, 0 0 18px ${tier.color}22` }
      : {};

  return (
    <article ref={ref} onClick={locked ? undefined : onOpenComments} style={{
      position: "relative",
      borderBottom: `1px solid ${t.border}`, padding: "14px 18px",
      background: post._promoted ? `${t.amber}08` : "transparent",
      cursor: locked ? "default" : "pointer",
      ...glowRing,
    }}
      onMouseEnter={e => e.currentTarget.style.background = post._promoted ? `${t.amber}10` : t.bgSurface + "44"}
      onMouseLeave={e => e.currentTarget.style.background = post._promoted ? `${t.amber}08` : "transparent"}>
      {post._promoted && (
        <div style={{ fontSize: 11, color: t.amber, fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
          <Sparkles size={11} /> Promoted
        </div>
      )}
      {tier?.label && (
        <div style={{ fontSize: 11, color: tier.color, fontWeight: 800, marginBottom: 6,
          display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px",
          borderRadius: 999, background: `${tier.color}18`, border: `1px solid ${tier.color}44` }}>
          <Flame size={11} /> {tier.label}
        </div>
      )}
      {post.gate && gateEval.met && (
        <div style={{ fontSize: 10, color: t.green, fontWeight: 700, marginBottom: 6,
          display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px",
          borderRadius: 999, background: `${t.green}15`, border: `1px solid ${t.green}44`,
          marginLeft: tier?.label ? 6 : 0 }}>
          <CheckCircle2 size={10} /> Unlocked
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
            {post.onchainTx && (
              <a href={`https://nearblocks.io/txns/${post.onchainTx}`} target="_blank" rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                title={`On-chain: ${post.onchainTx}`}
                style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 700,
                  color: t.green, background: `${t.green}18`, border: `1px solid ${t.green}44`,
                  padding: "2px 6px", borderRadius: 999, textDecoration: "none" }}>
                <LinkIcon size={9} /> on-chain
              </a>
            )}
            {hasCoins && (
              <div onClick={e => { e.stopPropagation(); onOpenCoin?.(post, coins); }}>
                <CoinBadge coins={coins} />
                <span style={{ fontSize: 10, color: "#f97316", marginLeft: 4, fontWeight: 700 }}>
                  {coins.length}/3
                </span>
              </div>
            )}
            <div style={{ marginLeft: "auto", position: "relative" }} onClick={e => e.stopPropagation()}>
              <button onClick={() => setMenuOpen(v => !v)} style={{ background: "none", border: "none", color: t.textMuted, cursor: "pointer", padding: 4 }}>
                <MoreHorizontal size={16} />
              </button>
              {menuOpen && (
                <div style={{ position: "absolute", right: 0, top: 24, background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 10, minWidth: 200, padding: 4, zIndex: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
                  onMouseLeave={() => setMenuOpen(false)}>
                  {isMine && <MenuRow t={t} onClick={onBoost}><Sparkles size={13} /> Boost: $5/wk</MenuRow>}
                  {coins.length < 3 && (
                    <MenuRow t={t} color="#f97316" onClick={() => { setMenuOpen(false); onMintCoin?.(post); }}>
                      <Coins size={13} /> {coins.length === 0 ? "Coin this story" : `Add coin (${coins.length}/3)`}
                    </MenuRow>
                  )}
                  {isMine && <MenuRow t={t} color={t.red} onClick={del}><Trash2 size={13} /> Delete</MenuRow>}
                  {!isMine && <MenuRow t={t}>Mute @{author.username}</MenuRow>}
                </div>
              )}
            </div>
          </div>

          {/* Content — blurred if gate not met */}
          <div style={{ position: "relative" }}>
            <div style={{
              filter: locked ? "blur(8px)" : "none",
              userSelect: locked ? "none" : "auto",
              pointerEvents: locked ? "none" : "auto",
            }}>
              {post.kind === "article" && post.title && (
                <h3 style={{ color: t.white, fontSize: 18, fontWeight: 800, margin: "6px 0 4px",
                  lineHeight: 1.3, display: "flex", alignItems: "center", gap: 6 }}>
                  <FileText size={14} color={t.amber} /> {post.title}
                </h3>
              )}
              <p style={{ color: t.text, fontSize: 15, lineHeight: 1.45, margin: "4px 0",
                whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                <RichText
                  text={post.kind === "article" && post.content.length > 320
                    ? post.content.slice(0, 320) + "…"
                    : post.content}
                  onMention={(h) => onOpenProfile?.(h)}
                />
              </p>
              {post.kind === "article" && post.content.length > 320 && (
                <span style={{ color: t.accent, fontSize: 12, fontWeight: 700 }}>Read article →</span>
              )}

              {post.mediaUrls?.length > 0 && (
                <div style={{ marginTop: 8, borderRadius: 16, overflow: "hidden", border: `1px solid ${t.border}` }}
                  onClick={e => e.stopPropagation()}>
                  {post.mediaType === "VIDEO"
                    ? <video src={post.mediaUrls[0]} controls style={{ width: "100%", display: "block", maxHeight: 520 }} />
                    : <img src={post.mediaUrls[0]} alt="" style={{ width: "100%", display: "block", maxHeight: 520, objectFit: "cover" }} />}
                </div>
              )}
            </div>

            {locked && (
              <div onClick={e => { e.stopPropagation(); openWallet?.(); }} style={{
                position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 8, padding: 18,
                background: `${t.bg}aa`, borderRadius: 12, cursor: "pointer",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6,
                  color: t.amber, fontSize: 13, fontWeight: 700 }}>
                  <Lock size={14} /> {gateEval.reason}
                </div>
                {gateEval.almostThere && gateEval.needed != null && (
                  <div style={{ color: t.textMuted, fontSize: 12 }}>
                    Almost there — {formatIronclawCompact(gateEval.needed)} {IRONCLAW_SYMBOL} more needed
                  </div>
                )}
              </div>
            )}
          </div>

          <div onClick={e => e.stopPropagation()} style={{ display: "flex", justifyContent: "space-between", marginTop: 10, maxWidth: 480 }}>
            <Action icon={MessageCircle} count={post.comments} onClick={onOpenComments} t={t} hover={t.accent} />
            <Action icon={Repeat2} count={reposts} active={reposted} hover={t.green} onClick={toggleRepost} t={t} />
            <Action icon={Heart} count={likes} active={liked} hover={t.red} onClick={toggleLike} t={t} fill={liked} />
            <TipAction
              t={t}
              tipCount={tipCount}
              tipTotalUsd={tipTotalUsd}
              tier={tier}
              onTip={() => onTip?.(post)}
              onOpenHistory={() => onOpenTipHistory?.(post)}
            />
            <Action icon={Share2} onClick={onShare} t={t} hover={t.accent} />
            <Action
              icon={Coins}
              onClick={() => hasCoins ? onOpenCoin?.(post) : onMintCoin?.(post)}
              t={t}
              hover="#f97316"
              count={hasCoins ? coins.length : undefined}
              active={hasCoins}
              fill={hasCoins}
              title={hasCoins ? `${coins.length}/3 coins • view/trade` : "Coin this story"}
            />
            <Action
              icon={Eye}
              count={impressions}
              t={t}
              hover={t.accent}
              onClick={(e) => e.stopPropagation()}
              title={`${impressions} impressions`}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

/* TipAction — lightning bolt with total tip count + aggregate USD value.
   Click bolt → open tip modal. Click USD → open tip history drawer. */
function TipAction({ t, tipCount, tipTotalUsd, tier, onTip, onOpenHistory }) {
  const color = tier?.color || t.amber;
  const hasTips = tipCount > 0;
  const usdLabel = tipTotalUsd >= 1000
    ? `$${(tipTotalUsd / 1000).toFixed(1)}K`
    : tipTotalUsd >= 1
      ? `$${tipTotalUsd.toFixed(0)}`
      : `$${tipTotalUsd.toFixed(2)}`;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
      <button onClick={onTip} title="Send tip" style={{
        display: "inline-flex", alignItems: "center", gap: 4, background: "none",
        border: "none", color: hasTips ? color : t.textMuted, cursor: "pointer",
        fontSize: 13, padding: "4px 8px", borderRadius: 999, transition: "background .15s",
      }}
        onMouseEnter={e => e.currentTarget.style.background = `${color}14`}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
        <Zap size={17} fill={hasTips ? color : "none"} />
        {hasTips && <span style={{ fontSize: 12, fontWeight: 600 }}>{tipCount}</span>}
      </button>
      {hasTips && (
        <button onClick={onOpenHistory} title="Tip history" style={{
          background: "none", border: "none", color, cursor: "pointer",
          fontSize: 11, padding: "2px 6px", borderRadius: 6, fontWeight: 700,
        }}>
          {usdLabel}
        </button>
      )}
    </div>
  );
}
function Action({ icon: Icon, count, active, hover, onClick, fill, t, title }) {
  const color = active ? hover : t.textMuted;
  return (
    <button onClick={onClick} title={title} style={{
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

/* NewsCoinSidebar — desktop-only left column showing recent coins, with a
   compact row per coin (ticker, name, mcap, 24h change). Click → jump to
   NewsCoin page. Refreshes every 20s. */
function NewsCoinSidebar({ t }) {
  const [coins, setCoins] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      let list = [];
      try {
        const data = await api("/api/newscoin/list?filter=trending&from=0&limit=8");
        list = data?.coins || data || [];
      } catch (_) { /* backend offline or returning HTML — fall through */ }
      // Always merge in on-chain coins so the sidebar populates even without
      // a backend (production deploys don't ship one).
      try {
        const { getAllCoinsOnChain } = await import("@/lib/newscoin");
        const onchain = await getAllCoinsOnChain({ fromIndex: 0, limit: 8 });
        const seen = new Set(list.map(c => c.coinAddress || c.contract_address).filter(Boolean));
        for (const c of onchain) {
          if (!seen.has(c.coinAddress)) list.push({ ...c, contract_address: c.coinAddress });
        }
      } catch (_) {}
      if (alive) {
        setCoins(list.slice(0, 8));
        setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 20000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 6px 10px", marginBottom: 6 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: t.white, fontWeight: 800, fontSize: 14 }}>
          <Coins size={16} color="#f97316" /> NewsCoin
        </div>
        <span style={{ fontSize: 10, color: "#f97316", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Live</span>
      </div>
      <div style={{ border: `1px solid ${t.border}`, borderRadius: 12, background: t.bgCard, overflow: "hidden" }}>
        {loading && <div style={{ padding: 12, fontSize: 12, color: t.textMuted }}>Loading…</div>}
        {!loading && coins.length === 0 && (
          <div style={{ padding: 12, fontSize: 12, color: t.textMuted }}>No coined stories yet. Be first — tap the Coins icon under any post.</div>
        )}
        {coins.map((c, i) => (
          <button key={c.contract_address || c.address || i}
            onClick={() => { try { window.dispatchEvent(new CustomEvent("ironshield:navigate", { detail: "NewsCoin" })); } catch (_) {} }}
            style={{
              display: "flex", alignItems: "center", gap: 8, width: "100%",
              padding: "10px 12px", background: "none", border: "none",
              borderBottom: i < coins.length - 1 ? `1px solid ${t.border}` : "none",
              cursor: "pointer", color: t.text, textAlign: "left",
            }}
            onMouseEnter={e => e.currentTarget.style.background = t.bgSurface}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#f9731622", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#f97316", fontWeight: 800, fontSize: 11, flexShrink: 0 }}>
              ${(c.ticker || "?").slice(0, 3)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.white, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.name || c.ticker || "Untitled"}
              </div>
              <div style={{ fontSize: 11, color: t.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.mcap_usd ? `$${Number(c.mcap_usd).toLocaleString()}` : "—"}
                {c.change_24h != null && (
                  <span style={{ marginLeft: 6, color: c.change_24h >= 0 ? "#22c55e" : t.red }}>
                    {c.change_24h >= 0 ? "+" : ""}{Number(c.change_24h).toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
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

  const copyLink = async () => {
    const origin = (typeof window !== "undefined" && window.location.origin) || "https://ironshield.pages.dev";
    const url = `${origin}/#/Feed?post=${post.id}`;
    try { await navigator.clipboard.writeText(url); alert("Post link copied"); }
    catch { prompt("Copy this link:", url); }
  };

  return (
    <Modal onClose={onClose} title="Post">
      {/* Parent post */}
      <div style={{ display: "flex", gap: 10, paddingBottom: 12, borderBottom: `1px solid ${t.border}` }}>
        <Avatar user={post.author || {}} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: t.white, fontWeight: 700 }}>
            {post.author?.display_name || post.author?.username || "anon"}
            <span style={{ color: t.textDim, fontWeight: 400, marginLeft: 6 }}>· {timeAgo(post.createdAt)}</span>
          </div>
          <div style={{ color: t.text, fontSize: 15, marginTop: 4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}><RichText text={post.content} /></div>
          {post.mediaUrls?.[0] && (
            <div style={{ marginTop: 8, borderRadius: 12, overflow: "hidden", border: `1px solid ${t.border}` }}>
              {post.mediaType === "VIDEO"
                ? <video src={post.mediaUrls[0]} controls style={{ width: "100%", maxHeight: 360 }} />
                : <img src={post.mediaUrls[0]} alt="" style={{ width: "100%", maxHeight: 360, objectFit: "cover" }} />}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "center" }}>
            {post.onchainTx && (
              <a href={`https://nearblocks.io/txns/${post.onchainTx}`} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, color: t.green, textDecoration: "none" }}>
                on-chain ↗
              </a>
            )}
            <button onClick={copyLink} style={{ fontSize: 11, color: t.accent, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              Copy link
            </button>
          </div>
        </div>
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto", marginTop: 10 }}>
        {comments.length === 0 && <p style={{ color: t.textDim, padding: 12 }}>No replies yet.</p>}
        {comments.map(c => (
          <div key={c.id} style={{ display: "flex", gap: 10, padding: "10px 0" }}>
            <Avatar user={c} size={32} />
            <div>
              <div style={{ fontSize: 13 }}>
                <strong style={{ color: t.white }}>{c.display_name || c.username}</strong>
                <span style={{ color: t.textDim, marginLeft: 6 }}>· {timeAgo(c.created_at)}</span>
              </div>
              <div style={{ color: t.text, fontSize: 14 }}><RichText text={c.content} /></div>
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
  const [uploadKind, setUploadKind] = useState(null); // "pfp" | "banner" | null
  const pfpFileRef = useRef(null);
  const bannerFileRef = useRef(null);

  const uploadImage = async (e, kind) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploadKind(kind);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await apiFetch(`/api/media/upload`, { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "upload failed");
      setForm(fm => ({ ...fm, [kind === "pfp" ? "pfpUrl" : "bannerUrl"]: d.url }));
    } catch (err) { alert(`Upload failed: ${err.message}`); }
    finally { setUploadKind(null); e.target.value = ""; }
  };

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
          <input ref={pfpFileRef} type="file" accept="image/*" onChange={e => uploadImage(e, "pfp")} style={{ display: "none" }} />
          <input ref={bannerFileRef} type="file" accept="image/*" onChange={e => uploadImage(e, "banner")} style={{ display: "none" }} />
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Avatar user={{ pfp_url: form.pfpUrl, username: "?" }} size={48} />
            <Btn onClick={() => pfpFileRef.current?.click()} disabled={uploadKind === "pfp"}>
              {uploadKind === "pfp" ? "Uploading..." : "Choose avatar"}
            </Btn>
            {form.pfpUrl && <Btn onClick={() => setForm(f => ({ ...f, pfpUrl: "" }))}>Clear</Btn>}
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ width: 80, height: 40, borderRadius: 6, background: form.bannerUrl ? `url(${form.bannerUrl}) center/cover` : t.bgSurface, border: `1px solid ${t.border}` }} />
            <Btn onClick={() => bannerFileRef.current?.click()} disabled={uploadKind === "banner"}>
              {uploadKind === "banner" ? "Uploading..." : "Choose banner"}
            </Btn>
            {form.bannerUrl && <Btn onClick={() => setForm(f => ({ ...f, bannerUrl: "" }))}>Clear</Btn>}
          </div>
          <Btn primary onClick={save}>Save</Btn>
        </div>
      )}

      <div style={{ display: "flex", marginTop: 18, borderBottom: `1px solid ${t.border}` }}>
        {[["posts", "Posts"], ["replies", "Replies"], ["media", "Media"], ["likes", "Likes"], ["earn", "Earn"]].map(([k, label]) => (
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
              <div style={{ color: t.text, fontSize: 14 }}><RichText text={p.content} /></div>
              <div style={{ color: t.textDim, fontSize: 12, marginTop: 4 }}>{timeAgo(p.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
      {tab === "earn" && (
        <EarnDashboard wallet={user.walletAddress} isMine={isMine} />
      )}
      {tab !== "posts" && tab !== "earn" && (
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

  const waived = isFeeWaived(wallet);
  const deploy = async () => {
    setErr("");
    if (!canDeploy) { setErr("Fill Post style, pick at least one personality trait, and set a schedule before deploying."); return; }
    if (!waived && balance !== null && balance < 10.05) { setErr(`Insufficient balance: you have ${balance.toFixed(2)} NEAR, need 10 NEAR (+ gas).`); return; }
    setStep("signing");
    try {
      let txHash = null;
      if (!waived) {
        const pay = await payNear({ selector, accountId: wallet, amountNear: 10, memo: "IronFeed agent deploy" });
        txHash = pay.txHash;
      } else {
        txHash = `waived_${wallet}_${Date.now().toString(36)}`;
      }
      await api("/api/feed-agent/deploy", { method: "POST", wallet, body: { paymentTxHash: txHash, waived, ...cfg } });
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
            tweaked from this site. Platform fee is 10N: separate from IronClaw's compute fees.
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
          placeholder="Repost anything mentioning @ironclaw or AZUKA."
          style={{ ...inputStyle(t), minHeight: 50 }} />
      </div>

      {err && <p style={{ color: t.red, fontSize: 13, marginTop: 12 }}>{err}</p>}
      {balance !== null && <p style={{ color: t.textDim, fontSize: 12, marginTop: 10 }}>Wallet: {balance.toFixed(2)} NEAR</p>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        {existing
          ? <Btn primary onClick={saveConfig}>Save config</Btn>
          : <Btn primary disabled={!canDeploy || step === "signing"} onClick={deploy}>
              {step === "signing" ? "Signing…" : step === "done" ? "Deployed ✓" : waived ? "Deploy (fee waived)" : "Deploy: 10 NEAR"}
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

  const waived = isFeeWaived(wallet);
  const submit = async () => {
    setErr("");
    if (!orgName.trim()) { setErr("Organisation name required"); return; }
    if (!waived && balance !== null && balance < 100.05) { setErr(`Insufficient balance: you have ${balance.toFixed(2)} NEAR, need 100 NEAR.`); return; }
    setBusy(true);
    try {
      let txHash = null;
      if (!waived) {
        const pay = await payNear({ selector, accountId: wallet, amountNear: 100, memo: `Org badge ${orgName}` });
        txHash = pay.txHash;
      } else {
        txHash = `waived_${wallet}_${Date.now().toString(36)}`;
      }
      await api("/api/feed-org/register", { method: "POST", wallet, body: { orgName, paymentTxHash: txHash, waived } });
      alert(waived ? "Org badge granted (fee waived)." : "Org badge granted!");
      onClose();
    } catch (e) { setErr(e.message || "Payment failed"); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} title="Become a verified Organization">
      <p style={{ color: t.textMuted, fontSize: 14 }}>
        Pay <strong style={{ color: t.amber }}>100 NEAR</strong> to unlock the gold Org badge: for project
        teams, DAOs, and protocols.
      </p>
      <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
        <input placeholder="Organisation name" value={orgName} onChange={e => setOrg(e.target.value)} style={inputStyle(t)} />
        {balance !== null && <p style={{ color: t.textDim, fontSize: 12 }}>Wallet: {balance.toFixed(2)} NEAR</p>}
        {err && <p style={{ color: t.red, fontSize: 13 }}>{err}</p>}
        <Btn primary disabled={!orgName || busy} onClick={submit}>
          {busy ? "Signing…" : waived ? "Claim Org badge (fee waived)" : "Pay 100 NEAR & verify"}
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
    if (balance !== null && balance < 5.05) { setErr(`Insufficient balance: you have ${balance.toFixed(2)} NEAR, need 5 NEAR.`); return; }
    setBusy(true);
    try {
      const { txHash } = await payNear({ selector, accountId: wallet, amountNear: 5, memo: `Boost post ${post.id}` });
      await api("/api/ads/create", { method: "POST", wallet, body: { postId: post.id, paymentTxHash: txHash } });
      alert("Boost active for 7 days");
      onClose();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} title="Boost this post: $5 / week">
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
function buildDmCallInvite(conversationId) {
  return `[[IRONCALL:${conversationId}:${Date.now().toString(36)}]] Join me in a secure AZUKA voice call.`;
}

function parseSpecialDmMessage(text = "") {
  const match = /^\[\[IRONCALL:(\d+):([a-z0-9]+)\]\]\s*(.*)$/i.exec(String(text).trim());
  if (!match) return null;
  return {
    type: "call_invite",
    conversationId: Number(match[1]),
    note: match[3] || "Join me in a secure AZUKA voice call.",
  };
}

function DMsModal({ wallet, onClose, initialPeer, initialConvId, onJoinCall }) {
  const t = useTheme();
  const [convs, setConvs] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [groupConvs, setGroupConvs] = useState([]);
  const [groupMessages, setGroupMessages] = useState([]);
  const [assistantMessages, setAssistantMessages] = useState([
    {
      id: "ironclaw-welcome",
      role: "assistant",
      content: "I'm your IronClaw personal AI. Ask me to draft replies, reshape a post, research a token, or think through a launch idea.",
      created_at: new Date().toISOString(),
    },
  ]);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [searchResult, setSearchResult] = useState(null);
  const [kp, setKp] = useState(null);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [groupSettingsFor, setGroupSettingsFor] = useState(null);
  // Call state is lifted to App-level context so switching pages doesn't drop the LiveKit connection.
  const { openCall: openGlobalCall } = useCall();

  const assistantConversation = {
    id: "ironclaw-assistant",
    kind: "assistant",
    peer: {
      id: "ironclaw-assistant",
      wallet: "ironclaw.ai",
      username: "ironclaw_ai",
      displayName: "IronClaw AI",
    },
  };

  // Local keypair + register pubkey with backend once
  useEffect(() => {
    if (!wallet) return;
    const k = getOrCreateKeypair(wallet);
    setKp(k);
    const pub = exportPublicKey(k);
    if (pub) {
      api("/api/profile/dm-pubkey", { method: "POST", wallet, body: { pubkey: pub } }).catch(() => {});
    }
  }, [wallet]);

  const refresh = useCallback(() => {
    api("/api/dm/conversations", { wallet }).then(r => setConvs((r.conversations || []).map(c => ({ ...c, kind: "direct" })))).catch(() => {});
    api("/api/dm/groups", { wallet }).then(r => setGroupConvs(r.groups || [])).catch(() => {});
  }, [wallet]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (active && active.kind === "direct") {
      const poll = setInterval(async () => {
        try { const r = await api(`/api/dm/${active.id}/messages`, { wallet }); setMessages(r.messages.slice().reverse()); } catch {}
      }, 1200);
      return () => clearInterval(poll);
    }
  }, [active, wallet]);

  useEffect(() => {
    if (active && active.kind === "group") {
      const poll = setInterval(async () => {
        try {
          const r = await api(`/api/dm/groups/${active.id}/messages`, { wallet });
          setGroupMessages(r.messages || []);
        } catch {}
      }, 1500);
      return () => clearInterval(poll);
    }
  }, [active, wallet]);

  useEffect(() => { if (initialPeer) { startWith(initialPeer); } /* eslint-disable-next-line */ }, [initialPeer]);
  // When we're deep-linked to a specific conversation (e.g. from a call
  // notification tap), find it in the loaded list and open it.
  useEffect(() => {
    if (!initialConvId || !convs.length) return;
    const hit = convs.find(c => String(c.id) === String(initialConvId));
    if (hit && (!active || String(active.id) !== String(hit.id))) open(hit);
    /* eslint-disable-next-line */
  }, [initialConvId, convs]);

  // Open a specific group after a successful invite-link join.
  useEffect(() => {
    const onOpenGroup = async (e) => {
      const g = e?.detail?.group;
      if (!g) return;
      refresh();
      const active = { ...g, kind: "group" };
      setActive(active);
      try {
        const r = await api(`/api/dm/groups/${g.id}/messages`, { wallet });
        setGroupMessages(r.messages || []);
      } catch {}
    };
    window.addEventListener("ix-open-group", onOpenGroup);
    return () => window.removeEventListener("ix-open-group", onOpenGroup);
  }, [refresh, wallet]);

  const open = async (c) => {
    setActive(c);
    if (c.kind === "assistant") return;
    if (c.kind === "group") {
      const r = await api(`/api/dm/groups/${c.id}/messages`, { wallet });
      setGroupMessages(r.messages || []);
      return;
    }
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
    const c = { id: r.conversationId, kind: "direct", peer: r.peer, unread: 0 };
    setConvs(cs => [c, ...cs.filter(x => x.id !== c.id)]);
    open(c);
    setSearch(""); setSearchResult(null);
  };

  const inviteLink = (handleOrWallet) =>
    `https://ironshield.pages.dev/#/Feed?invite=${encodeURIComponent(handleOrWallet)}`;

  const shareInvite = async (handle) => {
    const url = inviteLink(handle);
    const shareText = `Join me on IronFeed: crypto-native social on NEAR. ${url}`;
    if (navigator.share) {
      try { await navigator.share({ text: shareText, url }); return; } catch {}
    }
    await navigator.clipboard.writeText(shareText);
    alert("Invite link copied: paste it into Telegram, X, Discord, etc.");
  };

  const encodeForPeer = (plainText, peerPub) => {
    if (kp && peerPub) {
      try {
        return naclEncrypt(plainText, peerPub, kp);
      } catch {}
    }
    return {
      encryptedPayload: btoa(unescape(encodeURIComponent(plainText))),
      nonce: btoa(String(Date.now())),
    };
  };

  const sendCallInvite = async (conversation) => {
    if (!conversation || conversation.kind !== "direct") return;
    const enc = encodeForPeer(buildDmCallInvite(conversation.id), conversation.peer?.dmPubkey);
    await api("/api/dm/send", {
      method: "POST",
      wallet,
      body: { conversationId: conversation.id, encryptedPayload: enc.encryptedPayload, nonce: enc.nonce, type: "call_invite" },
    });
  };

  const joinCall = async (conversation, { announce = false } = {}) => {
    if (!conversation || conversation.kind !== "direct") return;
    if (announce) {
      try { await sendCallInvite(conversation); } catch {}
    }
    openGlobalCall({ kind: "dm", conversationId: conversation.id, peer: conversation.peer });
    onJoinCall?.({ conversationId: conversation.id, peer: conversation.peer });
  };

  const createGroup = () => setShowNewGroup(true);

  const handleGroupCreated = async (group) => {
    setShowNewGroup(false);
    refresh();
    setActive({ ...group, kind: "group" });
    try {
      const msg = await api(`/api/dm/groups/${group.id}/messages`, { wallet });
      setGroupMessages(msg.messages || []);
    } catch {}
  };

  const handleGroupUpdated = (updated) => {
    setGroupConvs(gs => gs.map(g => g.id === updated.id ? { ...g, ...updated } : g));
    setActive(a => a && a.kind === "group" && a.id === updated.id ? { ...a, ...updated } : a);
  };

  const send = async () => {
    const bodyText = text.trim();
    if (!bodyText || !active) return;
    if (active.kind === "assistant") {
      setAssistantMessages(m => [...m, { id: `assistant-user-${Date.now()}`, role: "user", content: bodyText, created_at: new Date().toISOString() }]);
      setText("");
      setAssistantBusy(true);
      try {
        const r = await api("/api/dm/assistant", { method: "POST", wallet, body: { message: bodyText } });
        setAssistantMessages(m => [...m, { id: `assistant-reply-${Date.now()}`, role: "assistant", content: r.reply, created_at: new Date().toISOString() }]);
      } catch (e) {
        setAssistantMessages(m => [...m, { id: `assistant-error-${Date.now()}`, role: "assistant", content: `I hit an error: ${e.message}`, created_at: new Date().toISOString() }]);
      } finally {
        setAssistantBusy(false);
      }
      return;
    }
    if (active.kind === "group") {
      const optimistic = {
        id: "tmp-g-" + Date.now(),
        content: bodyText,
        from_wallet: wallet,
        from_display: "You",
        created_at: new Date().toISOString(),
      };
      setGroupMessages(m => [...m, optimistic]);
      setText("");
      try {
        const r = await api(`/api/dm/groups/${active.id}/send`, { method: "POST", wallet, body: { content: bodyText } });
        setGroupMessages(m => m.map(x => x.id === optimistic.id ? r.message : x));
      } catch (e) {
        setGroupMessages(m => m.filter(x => x.id !== optimistic.id));
        alert(e.message);
      }
      return;
    }
    const enc = encodeForPeer(bodyText, active.peer?.dmPubkey);
    const tempId = "tmp-" + Date.now();
    const optimistic = { id: tempId, encrypted_payload: enc.encryptedPayload, nonce: enc.nonce, from_id: -1, to_id: active.peer.id, created_at: new Date().toISOString(), _plain: bodyText };
    setMessages(m => [...m, optimistic]);
    setText("");
    try {
      const r = await api("/api/dm/send", { method: "POST", wallet,
        body: { conversationId: active.id, encryptedPayload: enc.encryptedPayload, nonce: enc.nonce } });
      setMessages(m => m.map(x => x.id === tempId ? { ...r.message, _plain: bodyText } : x));
    } catch (e) {
      setMessages(m => m.filter(x => x.id !== tempId));
      alert(e.message);
    }
  };
  const decode = (m) => {
    if (m._plain) return m._plain;
    const peerPub = active?.peer?.dmPubkey;
    if (kp && peerPub) {
      const p = naclDecrypt(m.encrypted_payload, m.nonce, peerPub, kp);
      if (p) return p;
    }
    // Legacy base64 fallback
    try { return decodeURIComponent(escape(atob(m.encrypted_payload))); } catch { return "(encrypted)"; }
  };

  const renderBubble = (message, decodedText, mine) => {
    const special = parseSpecialDmMessage(decodedText);
    if (special?.type === "call_invite") {
      return (
        <div style={{
          background: `${t.accent}14`,
          color: t.text,
          padding: "10px 12px",
          borderRadius: 16,
          maxWidth: "82%",
          border: `1px solid ${t.accent}44`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Phone size={14} color={t.accent} />
            <div style={{ color: t.white, fontSize: 13, fontWeight: 800 }}>Voice call invite</div>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.45 }}>{special.note}</div>
          <button onClick={() => joinCall(active)} style={{
            marginTop: 10,
            padding: "7px 12px",
            borderRadius: 999,
            border: "none",
            background: t.accent,
            color: "#fff",
            fontWeight: 800,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}>
            <Phone size={13} /> Join call
          </button>
        </div>
      );
    }
    return (
      <div style={{
        background: mine ? t.accent : t.bgSurface,
        color: mine ? "#fff" : t.text,
        padding: "8px 12px",
        borderRadius: 14,
        maxWidth: "75%",
        fontSize: 14,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}>{decodedText}</div>
    );
  };

  const currentMessages = active?.kind === "assistant" ? assistantMessages : active?.kind === "group" ? groupMessages : messages;
  const activeSubtitle = active?.kind === "assistant"
    ? "Powered by the IRONCLAW backend"
    : active?.kind === "group"
      ? `${active?.handle ? `@${active.handle} · ` : ""}${active?.memberCount || 0} members`
      : shortWallet(active?.peer?.wallet || "");

  return (
    <Modal onClose={onClose} title="Messages" maxWidth={820}>
      <style>{`
        .ix-dm-grid { display: grid; grid-template-columns: 260px 1fr; gap: 12px; height: min(70vh, 560px); }
        .ix-dm-list { border-right: 1px solid ${t.border}; padding-right: 10px; overflow-y: auto; }
        .ix-dm-chat { display: flex; flex-direction: column; min-height: 0; }
        .ix-dm-back { display: none; }
        @media (max-width: 640px) {
          .ix-dm-grid { grid-template-columns: 1fr; height: 75vh; }
          .ix-dm-list { ${active ? "display: none;" : "border-right: none; padding-right: 0;"} }
          .ix-dm-chat { ${active ? "" : "display: none;"} }
          .ix-dm-back { display: inline-flex; margin-bottom: 8px; }
        }
      `}</style>
      <div className="ix-dm-grid">
        <div className="ix-dm-list">
          <button onClick={() => open(assistantConversation)} style={{
            width: "100%",
            display: "flex",
            gap: 10,
            alignItems: "center",
            padding: 10,
            borderRadius: 12,
            border: `1px solid ${active?.kind === "assistant" ? `${t.accent}55` : t.border}`,
            background: active?.kind === "assistant" ? `${t.accent}18` : t.bgSurface,
            color: t.text,
            cursor: "pointer",
            textAlign: "left",
            marginBottom: 10,
          }}>
            <div style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: `${t.accent}22`,
              display: "grid",
              placeItems: "center",
              color: t.accent,
              flexShrink: 0,
            }}>
              <Bot size={16} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ color: t.white, fontSize: 13, fontWeight: 800 }}>IronClaw AI</div>
              <div style={{ color: t.textDim, fontSize: 11 }}>Personal agent in your message box</div>
            </div>
          </button>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <input placeholder="search wallet / username" value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === "Enter" && lookup()} style={inputStyle(t)} />
            <Btn onClick={lookup} disabled={!search}><Search size={14} /></Btn>
          </div>
          <Btn style={{ width: "100%", marginBottom: 10 }} onClick={createGroup}>
            <UserPlus size={13} /> New group
          </Btn>

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
          {groupConvs.map(g => (
            <div key={`g-${g.id}`} onClick={() => open({ ...g, kind: "group" })} style={{
              display: "flex", gap: 8, padding: 8, borderRadius: 8, cursor: "pointer",
              background: active?.kind === "group" && active?.id === g.id ? `${t.accent}18` : "transparent",
            }}>
              <GroupAvatar group={g} size={32} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ color: t.white, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {g.name || "Group chat"}
                </div>
                <div style={{ color: t.textDim, fontSize: 11 }}>
                  {g.handle ? `@${g.handle} · ` : ""}{g.memberCount || 0} members
                </div>
              </div>
            </div>
          ))}
          {convs.length === 0 && !searchResult && (
            <p style={{ color: t.textDim, fontSize: 13 }}>No conversations yet. Search for a wallet above.</p>
          )}
        </div>

        <div className="ix-dm-chat">
          {!active ? <p style={{ color: t.textDim, padding: 20 }}>Select or start a conversation.</p> : (
            <>
              <button className="ix-dm-back" onClick={() => setActive(null)} style={{
                alignItems: "center", gap: 6, background: "none", border: "none",
                color: t.accent, cursor: "pointer", fontSize: 14, padding: "4px 0",
              }}><ArrowLeft size={16} /> Back</button>
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                paddingBottom: 10,
                marginBottom: 10,
                borderBottom: `1px solid ${t.border}`,
              }}>
                {active.kind === "assistant"
                  ? (
                    <div style={{
                      width: 38,
                      height: 38,
                      borderRadius: "50%",
                      display: "grid",
                      placeItems: "center",
                      background: `${t.accent}22`,
                      color: t.accent,
                      flexShrink: 0,
                    }}><Bot size={18} /></div>
                  )
                  : active.kind === "group"
                    ? <GroupAvatar group={active} size={38} />
                    : <Avatar user={{ pfp_url: active.peer?.pfpUrl, username: active.peer?.username }} size={38} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: t.white, fontSize: 14, fontWeight: 800 }}>
                    {active.kind === "assistant"
                      ? "IronClaw AI"
                      : active.kind === "group"
                        ? (active.name || "Group chat")
                        : (active.peer?.displayName || active.peer?.username || "Conversation")}
                  </div>
                  <div style={{ color: t.textDim, fontSize: 11 }}>{activeSubtitle}</div>
                </div>
                {active.kind === "direct" && (
                  <button onClick={() => joinCall(active, { announce: true })} style={{
                    padding: "8px 12px",
                    borderRadius: 999,
                    border: "none",
                    background: t.accent,
                    color: "#fff",
                    fontWeight: 800,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}>
                    <Phone size={14} /> Call
                  </button>
                )}
                {active.kind === "group" && (
                  <button onClick={() => setGroupSettingsFor(active)} title="Group settings" style={{
                    padding: 8, borderRadius: 999, border: `1px solid ${t.border}`,
                    background: t.bgSurface, color: t.text, cursor: "pointer",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Settings size={14} />
                  </button>
                )}
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
                {currentMessages.map(m => {
                  const mine = active.kind === "assistant"
                    ? m.role === "user"
                    : active.kind === "group"
                      ? String(m.from_wallet || "").toLowerCase() === String(wallet || "").toLowerCase()
                      : m.from_id !== active.peer.id;
                  const decodedText = active.kind === "assistant" ? m.content : active.kind === "group" ? m.content : decode(m);
                  const ts = m.created_at ? new Date(m.created_at) : null;
                  const timeStr = ts ? ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
                  return (
                    <div key={m.id} style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", marginBottom: 8 }}>
                      {renderBubble(m, decodedText, mine)}
                      <div style={{ fontSize: 10, color: t.textDim, marginTop: 2, padding: "0 4px" }}>
                        {active.kind === "group" && !mine ? `${m.from_display || shortWallet(m.from_wallet || "")} · ` : ""}{timeStr}{mine ? " · sent" : ""}
                      </div>
                    </div>
                  );
                })}
                {assistantBusy && active.kind === "assistant" && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", marginBottom: 8 }}>
                    <div style={{
                      background: t.bgSurface,
                      color: t.text,
                      padding: "10px 12px",
                      borderRadius: 14,
                      fontSize: 13,
                    }}>
                      IronClaw is thinking…
                    </div>
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, paddingTop: 10, borderTop: `1px solid ${t.border}` }}>
                <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && send()}
                  placeholder={active.kind === "assistant" ? "Ask IronClaw anything…" : "Encrypted message..."} style={inputStyle(t)} />
                <Btn primary onClick={send} disabled={!text.trim()}><Send size={14} /></Btn>
              </div>
              {active.kind === "assistant" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  {[
                    "Turn this idea into a launch post",
                    "Draft a reply to a skeptical investor",
                    "Summarize the value prop in 3 bullets",
                  ].map((prompt) => (
                    <button key={prompt} onClick={() => setText(prompt)} style={{
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: `1px solid ${t.border}`,
                      background: t.bgSurface,
                      color: t.text,
                      fontSize: 11,
                      cursor: "pointer",
                    }}>{prompt}</button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {/* DMCallPanel is now mounted globally in src/app/page.js so the call
          persists when the user navigates to other pages. */}
      {showNewGroup && (
        <NewGroupModal
          wallet={wallet}
          onClose={() => setShowNewGroup(false)}
          onCreated={handleGroupCreated}
        />
      )}
      {groupSettingsFor && (
        <GroupSettingsModal
          wallet={wallet}
          group={groupSettingsFor}
          onClose={() => setGroupSettingsFor(null)}
          onUpdated={handleGroupUpdated}
        />
      )}
    </Modal>
  );
}

/* ───────────────────── Group avatar / new group / settings ───────────────────── */
function GroupAvatar({ group, size = 38 }) {
  const t = useTheme();
  if (group?.pfpUrl || group?.pfp_url) {
    return <img src={group.pfpUrl || group.pfp_url} alt="" style={{
      width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0,
    }} />;
  }
  const initial = (group?.name || group?.handle || "G")[0]?.toUpperCase() || "G";
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", display: "grid", placeItems: "center",
      background: `linear-gradient(135deg, ${t.accent}, #0ea5e9)`, color: "#fff",
      fontWeight: 800, fontSize: size * 0.4, flexShrink: 0,
    }}>{initial}</div>
  );
}

function uploadGroupImage(file, _wallet) {
  const fd = new FormData();
  fd.append("file", file);
  return apiFetch(`/api/media/upload`, {
    method: "POST", body: fd,
  }).then(async r => {
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d?.error || "upload failed");
    return d.url;
  });
}

function NewGroupModal({ wallet, onClose, onCreated }) {
  const t = useTheme();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [membersText, setMembersText] = useState("");
  const [pfpUrl, setPfpUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef(null);

  const onPickImage = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true); setErr("");
    try {
      const url = await uploadGroupImage(f, wallet);
      setPfpUrl(url);
    } catch (ex) { setErr(ex.message); }
    finally { setUploading(false); e.target.value = ""; }
  };

  const submit = async () => {
    setErr("");
    if (!name.trim()) { setErr("Group name is required"); return; }
    const h = handle.trim().replace(/^@/, "").toLowerCase();
    if (h && !/^[a-z0-9_]{3,24}$/.test(h)) {
      setErr("Handle must be 3-24 chars: a-z, 0-9, or _");
      return;
    }
    const members = membersText.split(",").map(s => s.trim()).filter(Boolean);
    setBusy(true);
    try {
      const r = await api("/api/dm/groups", {
        method: "POST", wallet,
        body: { name: name.trim(), handle: h || null, pfpUrl: pfpUrl || null, members },
      });
      onCreated?.(r.group);
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} title="New group" maxWidth={480}>
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <GroupAvatar group={{ pfpUrl, name: name || "G" }} size={56} />
          <input ref={fileRef} type="file" accept="image/*" onChange={onPickImage} style={{ display: "none" }} />
          <Btn onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? "Uploading…" : pfpUrl ? "Change photo" : "Add photo"}
          </Btn>
          {pfpUrl && <Btn onClick={() => setPfpUrl("")}>Clear</Btn>}
        </div>
        <label style={{ fontSize: 12, color: t.textMuted }}>Group name
          <input value={name} onChange={e => setName(e.target.value)} maxLength={80}
            placeholder="IronClaw insiders" style={{ ...inputStyle(t), width: "100%", marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 12, color: t.textMuted }}>Public handle (optional)
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
            <span style={{ color: t.textDim, fontSize: 14 }}>@</span>
            <input value={handle} onChange={e => setHandle(e.target.value)} maxLength={24}
              placeholder="ironclaw_insiders" style={inputStyle(t)} />
          </div>
          <div style={{ color: t.textDim, fontSize: 11, marginTop: 4 }}>
            3-24 chars · a-z, 0-9, _ · must be unique
          </div>
        </label>
        <label style={{ fontSize: 12, color: t.textMuted }}>Add members (comma-separated wallets or @usernames)
          <textarea value={membersText} onChange={e => setMembersText(e.target.value)}
            placeholder="alice.near, bob.near, charlie"
            style={{ ...inputStyle(t), width: "100%", marginTop: 4, minHeight: 60 }} />
        </label>
        {err && <div style={{ color: t.red, fontSize: 12 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn primary onClick={submit} disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create group"}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

function GroupSettingsModal({ wallet, group, onClose, onUpdated }) {
  const t = useTheme();
  const [detail, setDetail] = useState(null);
  const [name, setName] = useState(group.name || "");
  const [handle, setHandle] = useState(group.handle || "");
  const [pfpUrl, setPfpUrl] = useState(group.pfpUrl || group.pfp_url || "");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const fileRef = useRef(null);

  useEffect(() => {
    api(`/api/dm/groups/${group.id}`, { wallet })
      .then(r => {
        setDetail(r.group);
        setName(r.group.name || "");
        setHandle(r.group.handle || "");
        setPfpUrl(r.group.pfpUrl || "");
      })
      .catch(e => setErr(e.message));
  }, [group.id, wallet]);

  const isOwner = !!detail?.isOwner;
  const inviteUrl = detail?.inviteToken
    ? `${typeof window !== "undefined" ? window.location.origin : "https://ironshield.near.page"}/#/Feed?joinGroup=${detail.inviteToken}`
    : null;

  const onPickImage = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true); setErr("");
    try {
      const url = await uploadGroupImage(f, wallet);
      setPfpUrl(url);
    } catch (ex) { setErr(ex.message); }
    finally { setUploading(false); e.target.value = ""; }
  };

  const save = async () => {
    setErr(""); setMsg("");
    if (!name.trim()) { setErr("Name is required"); return; }
    const h = handle.trim().replace(/^@/, "").toLowerCase();
    if (h && !/^[a-z0-9_]{3,24}$/.test(h)) {
      setErr("Handle must be 3-24 chars: a-z, 0-9, or _"); return;
    }
    setBusy(true);
    try {
      const r = await api(`/api/dm/groups/${group.id}`, {
        method: "PATCH", wallet,
        body: { name: name.trim(), handle: h || null, pfpUrl: pfpUrl || null },
      });
      onUpdated?.(r.group);
      setMsg("Saved");
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };

  const rotateInvite = async () => {
    setErr(""); setMsg("");
    try {
      const r = await api(`/api/dm/groups/${group.id}/invite`, {
        method: "POST", wallet, body: { rotate: true },
      });
      setDetail(d => ({ ...d, inviteToken: r.inviteToken }));
      setMsg("New invite link generated");
    } catch (ex) { setErr(ex.message); }
  };

  const copyInvite = async () => {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setMsg("Invite link copied");
    } catch { window.prompt("Copy this link:", inviteUrl); }
  };

  return (
    <Modal onClose={onClose} title="Group settings" maxWidth={520}>
      {!detail ? (
        <p style={{ color: t.textDim }}>Loading…</p>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <GroupAvatar group={{ pfpUrl, name }} size={64} />
            {isOwner && (
              <>
                <input ref={fileRef} type="file" accept="image/*" onChange={onPickImage} style={{ display: "none" }} />
                <Btn onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? "Uploading…" : pfpUrl ? "Change photo" : "Add photo"}
                </Btn>
                {pfpUrl && <Btn onClick={() => setPfpUrl("")}>Clear</Btn>}
              </>
            )}
          </div>

          <label style={{ fontSize: 12, color: t.textMuted }}>Name
            <input value={name} onChange={e => setName(e.target.value)} disabled={!isOwner} maxLength={80}
              style={{ ...inputStyle(t), width: "100%", marginTop: 4 }} />
          </label>

          <label style={{ fontSize: 12, color: t.textMuted }}>Public handle
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
              <span style={{ color: t.textDim, fontSize: 14 }}>@</span>
              <input value={handle} onChange={e => setHandle(e.target.value)} disabled={!isOwner} maxLength={24}
                placeholder="unique_handle" style={inputStyle(t)} />
            </div>
          </label>

          <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 12 }}>
            <div style={{ color: t.white, fontSize: 14, fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <LinkIcon size={14} /> Invite link
            </div>
            {isOwner ? (
              inviteUrl ? (
                <>
                  <div style={{
                    background: t.bgSurface, border: `1px solid ${t.border}`,
                    borderRadius: 10, padding: "8px 10px", fontSize: 12, color: t.text,
                    wordBreak: "break-all",
                  }}>{inviteUrl}</div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <Btn onClick={copyInvite}><CopyIcon size={13} /> Copy</Btn>
                    <Btn onClick={rotateInvite}><RefreshCw size={13} /> Rotate</Btn>
                  </div>
                </>
              ) : (
                <Btn onClick={rotateInvite}><LinkIcon size={13} /> Generate invite link</Btn>
              )
            ) : (
              <div style={{ color: t.textDim, fontSize: 12 }}>Only the group owner can share invite links.</div>
            )}
          </div>

          <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 12 }}>
            <div style={{ color: t.white, fontSize: 14, fontWeight: 700, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <UsersIcon size={14} /> Members ({detail.memberCount})
            </div>
            <div style={{ display: "grid", gap: 6, maxHeight: 180, overflowY: "auto" }}>
              {detail.members.map(m => (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Avatar user={{ pfp_url: m.pfpUrl, username: m.username }} size={28} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ color: t.white, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.displayName || m.username || shortWallet(m.wallet)}
                    </div>
                    <div style={{ color: t.textDim, fontSize: 11 }}>{shortWallet(m.wallet)}</div>
                  </div>
                  {m.id === detail.createdBy && (
                    <span style={chipStyle(t.accent)}>Owner</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {err && <div style={{ color: t.red, fontSize: 12 }}>{err}</div>}
          {msg && <div style={{ color: t.green, fontSize: 12 }}>{msg}</div>}

          {isOwner && (
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Btn onClick={onClose}>Close</Btn>
              <Btn primary onClick={save} disabled={busy || !name.trim()}>
                {busy ? "Saving…" : "Save changes"}
              </Btn>
            </div>
          )}
        </div>
      )}
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
function RightRail({ onDeployAgent, onOpenOrg, wallet, openWallet, onOpenProfile }) {
  const t = useTheme();
  const [news, setNews] = useState([]);
  const [ads, setAds]   = useState([]);
  const [coins, setCoins] = useState([]);
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    api("/api/feed-news").then(r => setNews(r.news || [])).catch(() => {});
    api("/api/ads/active").then(r => setAds((r.campaigns || []).slice(0, 3))).catch(() => {});
    // Live NewsCoin list. Refreshes every 30s so the sidebar reflects
    // mcap/volume changes without reloading the feed.
    const loadCoins = () => api("/api/newscoin/list?filter=trending&limit=6")
      .then(r => setCoins(Array.isArray(r?.coins) ? r.coins : Array.isArray(r) ? r : []))
      .catch(() => {});
    loadCoins();
    const id = setInterval(loadCoins, 30000);
    return () => clearInterval(id);
  }, []);

  const fmtUsdShort = (v) => {
    const n = Number(v || 0);
    if (!Number.isFinite(n) || n === 0) return "—";
    if (n < 1000) return `$${n.toFixed(0)}`;
    if (n < 1_000_000) return `$${(n / 1000).toFixed(1)}k`;
    return `$${(n / 1_000_000).toFixed(2)}M`;
  };
  const fmtAge = (d) => {
    if (!d) return "";
    const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  };
  const openTerminal = (coin) => {
    // Deep-link into the NewsCoin nav terminal. The nav router watches
    // the hash route, and NewsCoinPage reads the `id` query on mount.
    const id = coin.id || coin.coinAddress;
    if (!id) return;
    try {
      window.location.hash = `#/NewsCoin?id=${encodeURIComponent(id)}`;
    } catch {}
  };

  // Debounced user search via the same endpoint that powers @-mentions.
  useEffect(() => {
    const query = q.trim();
    if (!query) { setResults([]); return; }
    let cancelled = false;
    const id = setTimeout(() => {
      fetch(`${API}/api/social/search?q=${encodeURIComponent(query)}&limit=8`, {
        headers: wallet ? { "x-wallet": wallet } : {},
      })
        .then(r => r.ok ? r.json() : { users: [] })
        .then(d => { if (!cancelled) setResults(Array.isArray(d?.users) ? d.users : []); })
        .catch(() => {});
    }, 180);
    return () => { cancelled = true; clearTimeout(id); };
  }, [q, wallet]);

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
      {/* Search users */}
      <div style={{ position: "sticky", top: 0, background: t.bg, padding: "6px 0 12px", zIndex: 3 }}>
        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: t.bgSurface,
            border: `1px solid ${t.border}`, borderRadius: 999, padding: "8px 14px" }}>
            <Search size={16} color={t.textMuted} />
            <input value={q}
              onChange={e => setQ(e.target.value)}
              onFocus={() => setShowResults(true)}
              onBlur={() => setTimeout(() => setShowResults(false), 150)}
              placeholder="Search users"
              style={{ flex: 1, border: "none", background: "transparent", color: t.text, outline: "none", fontSize: 14 }} />
          </div>
          {showResults && q.trim() && (
            <div style={{
              position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
              background: t.bgCard, border: `1px solid ${t.border}`, borderRadius: 14,
              maxHeight: 340, overflowY: "auto", zIndex: 20,
              boxShadow: "0 12px 36px rgba(0,0,0,.45)",
            }}>
              {results.length === 0 ? (
                <div style={{ padding: "14px 16px", color: t.textDim, fontSize: 13 }}>No users found</div>
              ) : results.map((u, i) => (
                <button key={u.id || u.wallet || i}
                  onMouseDown={(e) => { e.preventDefault(); onOpenProfile?.(u); setShowResults(false); setQ(""); }}
                  style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 14px", border: "none",
                    borderTop: i ? `1px solid ${t.border}` : "none",
                    background: "transparent", color: t.text, cursor: "pointer", textAlign: "left",
                  }}>
                  {u.pfp_url
                    ? <img src={u.pfp_url} alt="" style={{ width: 34, height: 34, borderRadius: "50%", objectFit: "cover" }} />
                    : <div style={{ width: 34, height: 34, borderRadius: "50%", background: `${t.accent}22`, display: "grid", placeItems: "center", color: t.accent, fontWeight: 800 }}>
                        {(u.display_name || u.username || u.wallet || "?")[0]?.toUpperCase()}
                      </div>}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ color: t.white, fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {u.display_name || u.username || u.wallet}
                    </div>
                    <div style={{ color: t.textDim, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {u.username ? `@${u.username}` : u.wallet}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* NewsCoin — live token list, click to open full terminal */}
      {coins.length > 0 && card(
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Coins size={14} color="#f97316" /> NewsCoin
          <span style={{ background: "#f9731622", color: "#f97316", padding: "1px 7px", borderRadius: 6, fontSize: 10, marginLeft: 2, fontWeight: 700 }}>LIVE</span>
        </span>,
        <>
          {coins.map((c, i) => {
            const change = Number(c.change_24h || 0);
            const isUp = change >= 0;
            return (
              <button
                key={c.id || c.coinAddress || i}
                onClick={() => openTerminal(c)}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 14px", border: "none",
                  borderTop: i ? `1px solid ${t.border}` : "none",
                  background: "transparent", color: t.text, cursor: "pointer", textAlign: "left",
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: "#f97316" }}>${c.ticker}</span>
                    <span style={{ fontSize: 10, color: t.textDim }}>{fmtAge(c.created_at || c.timestamp)}</span>
                    {c.lifecycle?.label && (
                      <span style={{
                        fontSize: 9, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
                        padding: "1px 5px", borderRadius: 5,
                        background: `${c.lifecycle.color}18`, color: c.lifecycle.color,
                        border: `1px solid ${c.lifecycle.color}44`,
                      }}>{c.lifecycle.label}</span>
                    )}
                  </div>
                  <div style={{
                    color: t.textMuted, fontSize: 11, whiteSpace: "nowrap",
                    overflow: "hidden", textOverflow: "ellipsis", marginTop: 1,
                  }}>
                    {c.name || c.headline || "—"}
                  </div>
                </div>
                <div style={{ textAlign: "right", minWidth: 56 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: t.white }}>{fmtUsdShort(c.mcap_usd)}</div>
                  <div style={{ fontSize: 10, color: t.textDim }}>mcap</div>
                </div>
                <div style={{ textAlign: "right", minWidth: 46 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: isUp ? t.green : t.red }}>
                    {Number.isFinite(change) ? `${change >= 0 ? "+" : ""}${change.toFixed(1)}%` : "—"}
                  </div>
                  <div style={{ fontSize: 10, color: t.textDim }}>{fmtUsdShort(c.volume_24h)}</div>
                </div>
              </button>
            );
          })}
          <a
            href="#/NewsCoin"
            style={{
              display: "block", padding: "10px 14px", borderTop: `1px solid ${t.border}`,
              textAlign: "center", textDecoration: "none", color: "#f97316",
              fontSize: 12, fontWeight: 700,
            }}
          >
            View all coins →
          </a>
        </>
      )}

      {/* Deploy your Agent (replaces X Premium) */}
      {card(
        <span>Deploy your Agent <span style={{ background: `${t.green}22`, color: t.green, padding: "2px 7px", borderRadius: 6, fontSize: 11, marginLeft: 6 }}>10N /mo</span></span>,
        <div style={{ padding: 16 }}>
          <p style={{ color: t.textMuted, fontSize: 13, margin: 0, lineHeight: 1.5 }}>
            Let your agent post, find alpha, and act: even when you're not here. Personality &amp; schedule
            configured on AZUKA, runtime on IronClaw.
          </p>
          <button onClick={() => wallet ? onDeployAgent() : openWallet?.()} style={{
            marginTop: 12, width: "100%", padding: "10px 16px", borderRadius: 999,
            background: t.accent, color: "#fff", border: "none", fontWeight: 800, fontSize: 14, cursor: "pointer",
          }}>Deploy</button>
        </div>
      )}

      {/* Ads: only if active campaigns */}
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
          <p style={{ color: t.textMuted, fontSize: 13, margin: 0 }}>Unlock the gold Org badge for teams and protocols: 100 NEAR one-time.</p>
          <button onClick={() => wallet ? onOpenOrg() : openWallet?.()} style={{
            marginTop: 10, padding: "8px 14px", borderRadius: 999, background: "transparent",
            border: `1px solid ${t.border}`, color: t.text, cursor: "pointer", fontWeight: 600, fontSize: 13,
          }}>Verify organization</button>
        </div>
      )}
    </aside>
  );
}

/* ───────────────────── Voices tab (X/Twitter aggregator) ─────────────────────

Inspired by Uxento's watchlist-feed surface. IronFeed used to be post-only;
this tab adds a second mode that pulls tweets from X accounts curated by
the user (or, if they haven't customised, a CT preset served by the
backend). The backend handles Nitter/RSS fallback and caching — the UI
stays dumb: fetch → render tweet cards → "Manage" button to edit the list.

*/
function TweetCard({ tweet, t }) {
  const handle = tweet.handle || "x";
  const avatar = `https://unavatar.io/twitter/${handle}`;
  const ago    = tweet.createdAt ? timeAgo(tweet.createdAt) : "";
  const tUrl   = tweet.url || `https://x.com/${handle}`;
  return (
    <article style={{
      display: "flex", gap: 12, padding: "14px 18px",
      borderBottom: `1px solid ${t.border}`,
    }}>
      <a href={`https://x.com/${handle}`} target="_blank" rel="noreferrer"
         style={{ flexShrink: 0 }}>
        <img src={avatar} alt={handle} width={40} height={40}
          style={{ borderRadius: "50%", background: t.bgSurface }}
          onError={(e) => { e.currentTarget.style.background = t.accent + "22"; e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"; }}
        />
      </a>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ color: t.white, fontWeight: 700 }}>@{handle}</span>
          <span style={{
            ...chipStyle("#1D9BF0"), fontSize: 9, padding: "1px 6px",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}>
            𝕏
          </span>
          <span style={{ color: t.textDim, fontSize: 13 }}>· {ago}</span>
          <a href={tUrl} target="_blank" rel="noreferrer"
             style={{ marginLeft: "auto", color: t.textMuted, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, textDecoration: "none" }}>
            Open <ExternalLink size={12} />
          </a>
        </div>
        <div style={{ color: t.text, fontSize: 15, lineHeight: 1.45, marginTop: 4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {tweet.text}
        </div>
        {Array.isArray(tweet.media) && tweet.media.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: tweet.media.length === 1 ? "1fr" : "1fr 1fr", gap: 6, marginTop: 10 }}>
            {tweet.media.slice(0, 4).map((src, i) => (
              <img key={i} src={src} alt="" loading="lazy"
                style={{ width: "100%", maxHeight: 340, objectFit: "cover", borderRadius: 12, border: `1px solid ${t.border}` }}
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
            ))}
          </div>
        )}
        {tweet.quoted && (tweet.quoted.text || (tweet.quoted.media && tweet.quoted.media.length > 0)) && (
          <a
            href={tweet.quoted.url || `https://x.com/${tweet.quoted.handle}`}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "block",
              marginTop: 10,
              padding: "10px 12px",
              border: `1px solid ${t.border}`,
              borderRadius: 12,
              background: t.bgSurface,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <img
                src={`https://unavatar.io/twitter/${tweet.quoted.handle}`}
                alt={tweet.quoted.handle}
                width={16}
                height={16}
                style={{ borderRadius: "50%", background: t.accent + "22" }}
                onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
              />
              <span style={{ color: t.white, fontWeight: 600, fontSize: 13 }}>
                @{tweet.quoted.handle}
              </span>
            </div>
            {tweet.quoted.text && (
              <div style={{ color: t.text, fontSize: 14, lineHeight: 1.4, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {tweet.quoted.text}
              </div>
            )}
            {Array.isArray(tweet.quoted.media) && tweet.quoted.media.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: tweet.quoted.media.length === 1 ? "1fr" : "1fr 1fr", gap: 6, marginTop: 8 }}>
                {tweet.quoted.media.slice(0, 4).map((src, i) => (
                  <img key={i} src={src} alt="" loading="lazy"
                    style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 10, border: `1px solid ${t.border}` }}
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                ))}
              </div>
            )}
          </a>
        )}
      </div>
    </article>
  );
}

function ManageHandlesModal({ wallet, onClose, onChanged }) {
  const t = useTheme();
  const [handles, setHandles] = useState([]);
  const [preset, setPreset]   = useState([]);
  const [custom, setCustom]   = useState(false);
  const [input, setInput]     = useState("");
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api(`/api/xfeed/follows?wallet=${encodeURIComponent(wallet || "")}`);
      setHandles(r.handles || []);
      setPreset(r.preset || []);
      setCustom(!!r.custom);
    } catch (e) { setErr(e.message); }
  }, [wallet]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!wallet) return;
    const h = input.trim().replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) { setErr("Invalid X handle"); return; }
    setBusy(true); setErr("");
    try {
      const r = await api("/api/xfeed/follows", { method: "POST", body: { wallet, handle: h } });
      setHandles(r.handles || []);
      setCustom(true);
      setInput("");
      onChanged?.();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const remove = async (h) => {
    if (!wallet) return;
    setBusy(true); setErr("");
    try {
      const r = await api("/api/xfeed/follows", { method: "DELETE", body: { wallet, handle: h } });
      setHandles(r.handles || []);
      setCustom((r.handles || []).length > 0);
      onChanged?.();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal onClose={onClose} title="Manage X accounts" maxWidth={520}>
      {!wallet && (
        <div style={{ padding: 10, background: t.bgSurface, borderRadius: 10, color: t.textDim, marginBottom: 12, fontSize: 13 }}>
          Connect a wallet to save your own list. The CT preset below will keep rendering for now.
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="@handle e.g. cobie"
          style={{ ...inputStyle(t), flex: 1 }}
          disabled={!wallet || busy}
        />
        <Btn onClick={add} disabled={!wallet || busy || !input.trim()}>
          <Plus size={14} /> Add
        </Btn>
      </div>
      {err && <div style={{ color: "#F87171", fontSize: 13, marginBottom: 10 }}>{err}</div>}

      <div style={{ fontSize: 12, color: t.textDim, marginBottom: 6 }}>
        {custom
          ? `Your list (${handles.length})`
          : `Default CT preset (${handles.length}) — add a handle to start your own list`}
      </div>
      <div style={{ maxHeight: 320, overflowY: "auto", border: `1px solid ${t.border}`, borderRadius: 10 }}>
        {handles.map((h) => (
          <div key={h} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: `1px solid ${t.border}` }}>
            <img src={`https://unavatar.io/twitter/${h}`} alt=""
              width={28} height={28} style={{ borderRadius: "50%", background: t.bgSurface }}
              onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
            />
            <a href={`https://x.com/${h}`} target="_blank" rel="noreferrer"
               style={{ color: t.text, fontWeight: 600, textDecoration: "none", flex: 1 }}>
              @{h}
            </a>
            {wallet && (
              <button
                onClick={() => remove(h)}
                disabled={busy}
                title="Remove"
                style={{ background: "none", border: "none", cursor: "pointer", color: t.textMuted }}>
                <X size={16} />
              </button>
            )}
          </div>
        ))}
        {handles.length === 0 && (
          <div style={{ padding: 16, textAlign: "center", color: t.textDim, fontSize: 13 }}>No handles yet.</div>
        )}
      </div>

      {custom && preset.length > 0 && (
        <div style={{ marginTop: 14, fontSize: 12, color: t.textDim }}>
          CT preset available to re-add: {preset.filter((p) => !handles.map(h => h.toLowerCase()).includes(p.toLowerCase())).slice(0, 10).map((p) => (
            <button key={p} onClick={() => { setInput(p); }} style={{
              display: "inline-block", margin: "0 4px 4px 0", padding: "2px 8px",
              borderRadius: 999, background: t.bgSurface, border: `1px solid ${t.border}`,
              color: t.text, fontSize: 11, cursor: "pointer",
            }}>@{p}</button>
          ))}
        </div>
      )}
    </Modal>
  );
}

function VoicesFeed({ wallet, t, onManage }) {
  const [tweets, setTweets]         = useState([]);
  const [handles, setHandles]       = useState([]);
  const [loading, setLoading]       = useState(false);
  const [err, setErr]               = useState("");
  const [notConfigured, setNC]      = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const q = wallet ? `?wallet=${encodeURIComponent(wallet)}` : "";
      const r = await api(`/api/xfeed/timeline${q}`);
      setTweets(r.tweets || []);
      setHandles(r.handles || []);
      setNC(!!r.notConfigured);
    } catch (e) {
      setErr(e.message);
    } finally { setLoading(false); }
  }, [wallet]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 18px",
        borderBottom: `1px solid ${t.border}`, background: t.bgCard,
      }}>
        <Megaphone size={16} color={t.accent} />
        <div style={{ fontSize: 13, color: t.text, flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          Watching <strong>{handles.length}</strong> voice{handles.length === 1 ? "" : "s"}
          {handles.length > 0 && <span style={{ color: t.textDim }}> · @{handles.slice(0, 3).join(", @")}{handles.length > 3 ? "…" : ""}</span>}
        </div>
        <button
          onClick={load}
          title="Refresh"
          disabled={loading}
          style={{ background: "none", border: `1px solid ${t.border}`, borderRadius: 8, padding: "4px 8px", color: t.text, cursor: "pointer" }}>
          <RefreshCw size={13} className={loading ? "ix-spin" : ""} />
        </button>
        <Btn onClick={onManage}>
          <Settings size={14} /> Manage
        </Btn>
      </div>

      {notConfigured && (
        <div style={{ padding: 20, color: t.textDim, fontSize: 13, borderBottom: `1px solid ${t.border}`, background: t.bgSurface }}>
          The X feed aggregator isn't configured on this deployment. Admin: set
          <code style={{ margin: "0 4px", padding: "1px 6px", background: t.bgCard, borderRadius: 4, color: t.text }}>NITTER_BASE_URL</code>
          in the backend .env to enable live tweets. In the meantime, your
          watchlist below is still editable and will populate once configured.
          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {handles.slice(0, 12).map((h) => (
              <a key={h} href={`https://x.com/${h}`} target="_blank" rel="noreferrer"
                 style={{ color: t.accent, textDecoration: "none", padding: "2px 8px", borderRadius: 999, border: `1px solid ${t.border}`, fontSize: 12 }}>
                @{h}
              </a>
            ))}
          </div>
        </div>
      )}
      {err && !notConfigured && (
        <div style={{ padding: 20, color: "#F87171", fontSize: 13 }}>{err}</div>
      )}
      {tweets.map((tw) => (
        <TweetCard key={tw.id} tweet={tw} t={t} />
      ))}
      {!loading && !err && !notConfigured && tweets.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: t.textDim, fontSize: 14 }}>
          No tweets right now. Try refreshing in a minute — upstream may be cold.
        </div>
      )}
      {loading && (
        <div style={{ padding: 20, textAlign: "center", color: t.textDim }}>
          <Loader2 size={16} className="ix-spin" />
          <style>{`.ix-spin { animation: ixSpin 1s linear infinite; } @keyframes ixSpin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
    </div>
  );
}

/* ───────────────────── Infinite scroll sentinel ───────────────────── */
function InfiniteScrollSentinel({ cursor, loading, onMore, t }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!cursor || !ref.current) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !loading) onMore();
    }, { rootMargin: "600px" });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [cursor, loading, onMore]);

  if (!cursor && !loading) {
    return <div style={{ textAlign: "center", padding: 24, color: t.textDim, fontSize: 13 }}>You're all caught up ✨</div>;
  }
  return (
    <div ref={ref} style={{ textAlign: "center", padding: 20, color: t.textDim, fontSize: 13 }}>
      {loading ? <Loader2 size={16} className="ix-spin" /> : "Loading more…"}
      <style>{`.ix-spin { animation: ixSpin 1s linear infinite; } @keyframes ixSpin { to { transform: rotate(360deg); } }`}</style>
    </div>
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
  const [dmConvId, setDmConvId] = useState(null);
  const [dmCall, setDmCall] = useState({ open: false, minimized: false, conversationId: null, peer: null });
  const [openNotifs, setOpenNotifs] = useState(false);
  const [boostPost, setBoostPost] = useState(null);
  const [tipPost, setTipPost] = useState(null);
  const [tipHistoryPost, setTipHistoryPost] = useState(null);
  const [coinPost, setCoinPost] = useState(null);   // { post, coins } for CoinModal
  const [mintPost, setMintPost] = useState(null);   // post for MintModal
  const [railOpen, setRailOpen] = useState(true);
  const [manageVoices, setManageVoices] = useState(false);
  const [voicesRefreshKey, setVoicesRefreshKey] = useState(0);

  // Deep-link support: #/Feed?profile=alice.near  or  #/Feed?invite=bob.near
  //                    #/Feed?joinGroup=<token>   (opens DMs + joins that group)
  useEffect(() => {
    const parse = () => {
      const hash = window.location.hash || "";
      const q = hash.includes("?") ? hash.split("?")[1] : "";
      const params = new URLSearchParams(q);
      const profile = params.get("profile");
      const invite = params.get("invite");
      const dms = params.get("dms");
      const dmId = params.get("dm");
      const notifs = params.get("notifs");
      const postId = params.get("post");
      const joinGroup = params.get("joinGroup");
      if (profile) setOpenProfile(profile);
      if (invite && wallet) { setDmPeer(invite); setOpenDMs(true); }
      if (dms && wallet) setOpenDMs(true);
      if (dmId && wallet) { setDmConvId(dmId); setOpenDMs(true); }
      if (notifs && wallet) setOpenNotifs(true);
      if (postId) {
        api(`/api/posts/${postId}`, { wallet }).then(r => r.post && setOpenComments(r.post)).catch(() => {});
      }
      if (joinGroup) {
        if (!wallet) { openWallet?.(); return; }
        api(`/api/dm/groups/join/${encodeURIComponent(joinGroup)}`, { method: "POST", wallet })
          .then(r => {
            setOpenDMs(true);
            try {
              window.dispatchEvent(new CustomEvent("ix-open-group", { detail: { group: r.group } }));
            } catch {}
            // Strip the query param so a page refresh doesn't re-trigger the join.
            try {
              params.delete("joinGroup");
              const nextQ = params.toString();
              const base = hash.split("?")[0] || "#/Feed";
              window.history.replaceState(null, "", nextQ ? `${base}?${nextQ}` : base);
            } catch {}
          })
          .catch(e => alert(e.message));
      }
    };
    parse();
    window.addEventListener("hashchange", parse);
    const onOpenDM = (e) => {
      const d = e?.detail || {};
      if (d.peer) setDmPeer(d.peer.wallet || d.peer.username || d.peer);
      setOpenDMs(true);
    };
    window.addEventListener("ix-open-dm", onOpenDM);
    return () => {
      window.removeEventListener("hashchange", parse);
      window.removeEventListener("ix-open-dm", onOpenDM);
    };
  }, [wallet]);

  const load = useCallback(async (reset = true) => {
    // "voices" tab isn't a post feed — it's an X aggregator handled by VoicesFeed.
    if (tab === "voices") return;
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

  useEffect(() => { if (tab !== "voices") load(true); /* eslint-disable-next-line */ }, [tab, wallet]);

  const onPosted = (p) => setPosts(prev => [p, ...prev]);
  const share = async (p) => {
    const origin = (typeof window !== "undefined" && window.location.origin) || "https://ironshield.pages.dev";
    const url = `${origin}/#/Feed?post=${p.id}`;
    const text = p.content?.slice(0, 120) || "Check this out on IronFeed";
    try {
      if (navigator.share) { await navigator.share({ text, url }); return; }
    } catch { /* user cancelled */ return; }
    try { await navigator.clipboard.writeText(url); alert("Link copied to clipboard"); }
    catch { prompt("Copy this link:", url); }
  };

  return (
    <div className={`ix-feed-wrap ${railOpen ? "rail-on" : "rail-off"}`} style={{ maxWidth: 1400, margin: "0 auto" }}>
      <style>{`
        .ix-feed-wrap { display: grid; gap: 0; }
        .ix-feed-wrap.rail-on  { grid-template-columns: 280px minmax(0,1fr) 340px; }
        .ix-feed-wrap.rail-off { grid-template-columns: 280px minmax(0,1fr); }
        .ix-feed-col { border-left: 1px solid ${t.border}; border-right: 1px solid ${t.border}; min-height: 100vh; min-width: 0; }
        .ix-feed-header { position: sticky; top: 0; z-index: 5; background: ${t.bg}cc; backdrop-filter: blur(8px); border-bottom: 1px solid ${t.border}; }
        .ix-left-col {
          padding: 12px 12px 40px;
          position: sticky; top: 0; align-self: start;
          max-height: 100vh; overflow-y: auto;
        }
        .ix-right-col {
          padding: 8px 16px 40px;
          position: sticky; top: 0; align-self: start;
          max-height: 100vh; overflow-y: auto;
        }
        .ix-rail-toggle {
          position: absolute; top: 10px; right: 10px; z-index: 6;
          width: 34px; height: 34px; border-radius: 50%;
          background: ${t.bgCard}; border: 1px solid ${t.border};
          display: inline-flex; align-items: center; justify-content: center;
          cursor: pointer; color: ${t.text};
        }
        @media (max-width: 1200px) {
          .ix-feed-wrap.rail-on  { grid-template-columns: minmax(0,1fr) 340px; }
          .ix-feed-wrap.rail-off { grid-template-columns: minmax(0,1fr); }
          .ix-left-col { display: none; }
        }
        @media (max-width: 960px) {
          .ix-feed-wrap.rail-on, .ix-feed-wrap.rail-off { grid-template-columns: 1fr; }
          .ix-right-col, .ix-rail-toggle { display: none; }
        }
        @media (max-width: 640px) {
          .ix-feed-col { border-left: none; border-right: none; }
          .ix-feed-wrap { margin: 0; }
        }
      `}</style>
      {/* Left column — NewsCoin live feed (desktop only) */}
      <aside className="ix-left-col">
        <NewsCoinSidebar t={t} openWallet={openWallet} />
      </aside>
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
            {[["foryou", "For you"], ["following", "Squad"], ["voices", "Voices"]].map(([k, label]) => (
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

        {tab === "voices" ? (
          <VoicesFeed
            key={voicesRefreshKey}
            wallet={wallet}
            t={t}
            onManage={() => setManageVoices(true)}
          />
        ) : (
          <>
            <ComposePost wallet={wallet} selector={selector} onPosted={onPosted} />

            {posts.length === 0 && !loading && (
              <div style={{ padding: 40, textAlign: "center", color: t.textDim }}>
                {tab === "following" ? `${FOLLOW} people to fill your Squad feed.` : "No posts yet: be first!"}
              </div>
            )}
            {posts.map(p => (
              <PostCard key={p.id + (p._promoted ? "-ad" : "")} post={p} viewerWallet={wallet}
                onRefresh={() => load(true)}
                onOpenComments={() => setOpenComments(p)}
                onShare={() => share(p)}
                onBoost={() => setBoostPost(p)}
                onOpenProfile={(w) => setOpenProfile(w)}
                onTip={(post) => wallet ? setTipPost(post) : openWallet?.()}
                onOpenTipHistory={(post) => setTipHistoryPost(post)}
                onOpenCoin={(post, coins) => setCoinPost({ post, coins })}
                onMintCoin={(post) => wallet ? setMintPost(post) : openWallet?.()}
                openWallet={openWallet} />
            ))}
            <InfiniteScrollSentinel cursor={cursor} loading={loading} onMore={() => load(false)} t={t} />
          </>
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
          onOpenProfile={(u) => setOpenProfile(u.wallet || u.username)}
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

      {manageVoices && (
        <ManageHandlesModal
          wallet={wallet}
          onClose={() => setManageVoices(false)}
          onChanged={() => setVoicesRefreshKey(k => k + 1)}
        />
      )}
      {openComments && <CommentsModal post={openComments} wallet={wallet} openWallet={openWallet} onClose={() => setOpenComments(null)} />}
      {openProfile && <ProfileModal wallet={openProfile} viewerWallet={wallet} viewerSelector={selector} openWallet={openWallet}
        onOpenDM={(w) => { setOpenProfile(null); setDmPeer(w); setOpenDMs(true); }} onClose={() => setOpenProfile(null)} />}
      {openOrg && <OrgBadgeModal wallet={wallet} selector={selector} onClose={() => setOpenOrg(false)} />}
      {openAgent && <AgentDeployModal wallet={wallet} selector={selector} onClose={() => setOpenAgent(false)} />}
      {openDMs && (
        <DMsModal
          wallet={wallet}
          initialPeer={dmPeer}
          initialConvId={dmConvId}
          onClose={() => { setOpenDMs(false); setDmPeer(null); setDmConvId(null); }}
          onJoinCall={({ conversationId, peer }) => setDmCall({ open: true, minimized: false, conversationId, peer })}
        />
      )}
      {openNotifs && <NotificationsModal wallet={wallet} onClose={() => setOpenNotifs(false)} />}
      {boostPost && <AdBoostModal post={boostPost} wallet={wallet} selector={selector} onClose={() => setBoostPost(null)} />}
      {tipPost && <TipModal post={tipPost} wallet={wallet} selector={selector} openWallet={openWallet}
        onClose={() => setTipPost(null)}
        onTipped={() => { setTipPost(null); load(true); }} />}
      {tipHistoryPost && <TipHistoryDrawer post={tipHistoryPost}
        onClose={() => setTipHistoryPost(null)}
        openTipModal={() => { setTipPost(tipHistoryPost); setTipHistoryPost(null); }} />}
      {coinPost && (
        <CoinModal
          coin={coinPost.coins[0]}
          post={{ ...coinPost.post, coins: coinPost.coins }}
          wallet={wallet}
          selector={selector}
          onClose={() => setCoinPost(null)}
        />
      )}
      {mintPost && (
        <MintModal
          post={mintPost}
          wallet={wallet}
          selector={selector}
          onClose={() => setMintPost(null)}
          onMinted={() => { setMintPost(null); load(true); }}
        />
      )}
      <DMCallPanel
        open={dmCall.open}
        minimized={dmCall.minimized}
        t={t}
        wallet={wallet}
        conversationId={dmCall.conversationId}
        peer={dmCall.peer}
        onMinimize={() => setDmCall(s => ({ ...s, minimized: true }))}
        onResume={() => setDmCall(s => ({ ...s, minimized: false }))}
        onEnd={() => setDmCall({ open: false, minimized: false, conversationId: null, peer: null })}
      />
    </div>
  );
}
