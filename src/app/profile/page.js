"use client";
// /profile — user profile with four tabs (Posts / Reposts / Likes /
// Deployed), a banner + pfp header, and an "Edit profile" modal for
// the viewer's own profile.
//
// Accepts ?address=<wallet> or ?username=<handle> to view someone
// else's profile. When empty, shows the connected wallet.

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useTheme, useWallet } from "@/lib/contexts";
import AppShell from "@/components/shell/AppShell";
import FeedCard from "@/components/feed/FeedCard";
import YourDeploysPanel from "@/components/feed/YourDeploysPanel";
import { Coins, Camera, X as XIcon, Loader2 } from "lucide-react";

const BACKEND_BASE = (() => {
  if (typeof window === "undefined") return "";
  const explicit = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3001";
  return "https://ironclaw-backend.onrender.com";
})();

const TABS = [
  { key: "posts",    label: "Posts",    endpoint: (a) => `/api/users/${encodeURIComponent(a)}/posts` },
  { key: "reposts",  label: "Reposts",  endpoint: (a) => `/api/users/${encodeURIComponent(a)}/reposts` },
  { key: "likes",    label: "Likes",    endpoint: (a) => `/api/users/${encodeURIComponent(a)}/likes` },
  { key: "deployed", label: "Deployed", endpoint: null },
];

export default function ProfilePage() {
  const t = useTheme();
  const { address: viewerAddress, showModal } = useWallet();

  const [targetKey, setTargetKey] = useState(null);        // address OR username passed to the backend
  const [targetAddress, setTargetAddress] = useState(null); // wallet for self-profile detection
  useEffect(() => {
    try {
      const qs = new URLSearchParams(location.search);
      const addr = qs.get("address");
      const uname = qs.get("username");
      if (addr) { setTargetKey(addr); setTargetAddress(addr); return; }
      if (uname) { setTargetKey(uname); setTargetAddress(null); return; }
      if (viewerAddress) { setTargetKey(viewerAddress); setTargetAddress(viewerAddress); }
    } catch {}
  }, [viewerAddress]);

  const isSelf = !!(viewerAddress && targetAddress &&
    viewerAddress.toLowerCase() === targetAddress.toLowerCase());

  const [tab, setTab] = useState("posts");
  const [posts, setPosts] = useState([]);
  const [profile, setProfile] = useState(null);
  const [deploys, setDeploys] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!targetKey) return;
    try {
      const r = await fetch(`${BACKEND_BASE}/api/profile/${encodeURIComponent(targetKey)}`);
      if (!r.ok) { setProfile(null); return; }
      const j = await r.json();
      setProfile(j?.user || null);
      if (j?.user?.walletAddress) setTargetAddress(j.user.walletAddress);
    } catch { /* keep previous */ }
  }, [targetKey]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  useEffect(() => {
    if (!targetKey) return;
    const keyForApi = targetAddress || targetKey;
    const target = TABS.find((x) => x.key === tab);
    if (tab === "deployed") {
      const ctl = new AbortController();
      setLoading(true);
      fetch(`${BACKEND_BASE}/api/newscoin/by-creator?creator=${encodeURIComponent(keyForApi)}`, { signal: ctl.signal })
        .then(r => r.ok ? r.json() : { coins: [] })
        .then(j => setDeploys(j.coins || []))
        .catch(() => {})
        .finally(() => setLoading(false));
      return () => ctl.abort();
    }
    if (!target?.endpoint) return;
    const ctl = new AbortController();
    setLoading(true);
    fetch(`${BACKEND_BASE}${target.endpoint(keyForApi)}?limit=30`, {
      headers: viewerAddress ? { "x-wallet": viewerAddress } : {},
      signal: ctl.signal,
    })
      .then(r => r.ok ? r.json() : { posts: [] })
      .then(j => setPosts(j.posts || []))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => ctl.abort();
  }, [targetKey, targetAddress, tab, viewerAddress]);

  const short = useMemo(() => {
    const s = profile?.walletAddress || targetAddress;
    if (!s) return null;
    return s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
  }, [profile, targetAddress]);

  if (!targetKey) {
    return (
      <AppShell>
        <div style={{
          maxWidth: 520, margin: "80px auto", padding: 24,
          border: `1px dashed ${t.border}`, borderRadius: 12,
          textAlign: "center", color: t.textMuted,
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: t.text, marginBottom: 6 }}>
            No wallet connected
          </div>
          <div style={{ fontSize: 13, marginBottom: 14 }}>
            Connect to see your profile — posts, reposts, likes, and tokens you've deployed.
          </div>
          <button
            type="button"
            onClick={() => showModal?.()}
            style={{
              padding: "8px 16px", borderRadius: 8, border: "none",
              background: t.accent, color: "#fff", fontWeight: 700, cursor: "pointer",
            }}
          >
            Connect wallet
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell rightPanel={<YourDeploysPanel />}>
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 0 16px" }}>
        {/* Banner */}
        <div style={{
          position: "relative",
          height: 160,
          background: profile?.bannerUrl
            ? `url("${profile.bannerUrl}") center/cover no-repeat`
            : `linear-gradient(120deg, ${t.accent}, #0ea5e9)`,
          borderBottom: `1px solid ${t.border}`,
        }}>
          {/* Pfp anchored at the bottom so it overlaps both banner and
              header section. Classic Twitter positioning. */}
          <div style={{
            position: "absolute",
            left: 16,
            bottom: -36,
            width: 78, height: 78, borderRadius: "50%",
            background: "var(--bg-card)",
            border: `3px solid var(--bg-app)`,
            overflow: "hidden",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontWeight: 800, fontSize: 30,
            backgroundImage: profile?.pfpUrl ? `url("${profile.pfpUrl}")` : `linear-gradient(135deg, ${t.accent}, #0ea5e9)`,
            backgroundSize: "cover", backgroundPosition: "center",
          }}>
            {!profile?.pfpUrl && ((profile?.displayName || short || "?")[0]?.toUpperCase())}
          </div>
          {isSelf && (
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              style={{
                position: "absolute", top: 12, right: 12,
                padding: "6px 12px", borderRadius: 999,
                border: `1px solid rgba(255,255,255,0.3)`,
                background: "rgba(0,0,0,0.5)", color: "#fff",
                fontSize: 12, fontWeight: 700, cursor: "pointer",
                backdropFilter: "blur(6px)",
              }}
            >
              Edit profile
            </button>
          )}
        </div>

        {/* Header meta — sits below the banner, pfp overlaps it. */}
        <div style={{
          padding: "48px 16px 12px",
          borderBottom: `1px solid ${t.border}`,
          marginBottom: 12,
        }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: t.white }}>
            {profile?.displayName || short || "anon"}
          </div>
          <div style={{ fontSize: 13, color: t.textDim }}>
            @{profile?.username || short} · {profile?.followers ?? 0} followers · {profile?.posts ?? 0} posts
          </div>
          {profile?.bio && (
            <div style={{ fontSize: 14, color: t.text, marginTop: 8, whiteSpace: "pre-wrap" }}>
              {profile.bio}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex", gap: 2, borderBottom: `1px solid ${t.border}`, marginBottom: 12,
          overflowX: "auto", padding: "0 16px",
        }}>
          {TABS.map((x) => {
            const active = x.key === tab;
            return (
              <button
                key={x.key}
                type="button"
                onClick={() => setTab(x.key)}
                style={{
                  padding: "10px 14px", background: "transparent", border: "none",
                  fontSize: 13, fontWeight: active ? 700 : 500,
                  color: active ? t.text : t.textDim,
                  borderBottom: `2px solid ${active ? t.accent : "transparent"}`,
                  cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                {x.label}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div style={{ padding: "0 16px" }}>
          {loading && (
            <div style={{ padding: 24, color: t.textDim, fontSize: 12, textAlign: "center" }}>Loading…</div>
          )}

          {!loading && tab !== "deployed" && posts.length === 0 && (
            <EmptyPanel t={t} label="Nothing here yet." />
          )}

          {!loading && tab !== "deployed" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {posts.map((p) => (
                <FeedCard key={p.id} post={p} viewer={{ wallet_address: viewerAddress }} />
              ))}
            </div>
          )}

          {!loading && tab === "deployed" && (
            deploys.length === 0 ? (
              <EmptyPanel t={t} label="No coins deployed yet." />
            ) : (
              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
                {deploys.map((c) => (
                  <a
                    key={c.id || c.ticker}
                    href={`/newscoin?token=${encodeURIComponent(c.ticker || c.id)}`}
                    style={{
                      display: "block", padding: 12, borderRadius: 10,
                      border: `1px solid ${t.border}`, background: "var(--bg-card)",
                      textDecoration: "none", color: "inherit",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                      <Coins size={14} color={t.accent} />
                      <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>
                        {c.name || c.ticker}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: t.textDim }}>
                      ${c.ticker || "?"} · {c.chain || "near"}
                    </div>
                  </a>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      {editOpen && (
        <ProfileEditor
          initial={profile}
          wallet={viewerAddress}
          onClose={() => setEditOpen(false)}
          onSaved={(next) => { setProfile(next); setEditOpen(false); }}
        />
      )}
    </AppShell>
  );
}

function EmptyPanel({ t, label }) {
  return (
    <div style={{
      padding: 40, color: t.textDim, fontSize: 13, textAlign: "center",
      border: `1px dashed ${t.border}`, borderRadius: 10,
    }}>
      {label}
    </div>
  );
}

// Profile edit modal — lets the viewer change display name, username,
// bio, pfp, and banner. Images upload through Cloudinary's signed
// direct-upload flow (POST /api/profile/upload returns the signature),
// then we PATCH /api/profile with the resulting URLs.
function ProfileEditor({ initial, wallet, onClose, onSaved }) {
  const t = useTheme();
  const [form, setForm] = useState({
    displayName: initial?.displayName || "",
    username:    initial?.username || "",
    bio:         initial?.bio || "",
    pfpUrl:      initial?.pfpUrl || "",
    bannerUrl:   initial?.bannerUrl || "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [busyKind, setBusyKind] = useState(null);  // "pfp" | "banner" | null
  const pfpInput = useRef(null);
  const bannerInput = useRef(null);

  const upload = useCallback(async (file, kind) => {
    if (!file) return;
    setErr(null);
    setBusyKind(kind);
    try {
      const sigRes = await fetch(`${BACKEND_BASE}/api/profile/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": wallet },
      });
      if (!sigRes.ok) {
        const j = await sigRes.json().catch(() => ({}));
        throw new Error(j?.hint || j?.error || `upload-signature ${sigRes.status}`);
      }
      const sig = await sigRes.json();
      const fd = new FormData();
      fd.append("file", file);
      fd.append("api_key", sig.apiKey);
      fd.append("timestamp", String(sig.timestamp));
      fd.append("signature", sig.signature);
      fd.append("folder", sig.folder);
      const up = await fetch(sig.uploadUrl, { method: "POST", body: fd });
      if (!up.ok) throw new Error(`cloudinary ${up.status}`);
      const j = await up.json();
      const url = j.secure_url;
      setForm((f) => ({ ...f, [kind === "pfp" ? "pfpUrl" : "bannerUrl"]: url }));
    } catch (e) {
      setErr(e.message || "Upload failed");
    } finally {
      setBusyKind(null);
    }
  }, [wallet]);

  const save = useCallback(async () => {
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(`${BACKEND_BASE}/api/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-wallet": wallet },
        body: JSON.stringify(form),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${r.status}`);
      }
      const j = await r.json();
      // Normalize the PATCH response (snake_case cols) back into the
      // camelCase shape the GET /api/profile/:key returned.
      const u = j.user || {};
      onSaved({
        ...initial,
        displayName: u.display_name ?? form.displayName,
        username:    u.username ?? form.username,
        bio:         u.bio ?? form.bio,
        pfpUrl:      u.pfp_url ?? form.pfpUrl,
        bannerUrl:   u.banner_url ?? form.bannerUrl,
      });
    } catch (e) {
      setErr(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }, [form, wallet, onSaved, initial]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 300,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(100vw, 520px)", maxHeight: "90vh", overflowY: "auto",
          borderRadius: 14, background: "var(--bg-card)",
          border: `1px solid ${t.border}`,
        }}
      >
        {/* Banner preview / upload */}
        <div style={{
          position: "relative", height: 140,
          background: form.bannerUrl
            ? `url("${form.bannerUrl}") center/cover no-repeat`
            : `linear-gradient(120deg, ${t.accent}, #0ea5e9)`,
          borderTopLeftRadius: 14, borderTopRightRadius: 14,
        }}>
          <input
            ref={bannerInput}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => upload(e.target.files?.[0], "banner")}
          />
          <button
            type="button"
            onClick={() => bannerInput.current?.click()}
            disabled={busyKind === "banner"}
            style={{
              position: "absolute", top: 10, right: 48,
              padding: "6px 10px", borderRadius: 999,
              border: `1px solid rgba(255,255,255,0.3)`, background: "rgba(0,0,0,0.5)",
              color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 6,
              backdropFilter: "blur(6px)",
            }}
          >
            {busyKind === "banner" ? <Loader2 size={12} className="ic-spin" /> : <Camera size={12} />}
            Banner
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              position: "absolute", top: 10, right: 10,
              width: 32, height: 32, borderRadius: "50%",
              border: `1px solid rgba(255,255,255,0.3)`, background: "rgba(0,0,0,0.5)",
              color: "#fff", cursor: "pointer",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              backdropFilter: "blur(6px)",
            }}
          >
            <XIcon size={14} />
          </button>

          {/* Pfp preview overlap */}
          <div style={{
            position: "absolute", left: 16, bottom: -32,
            width: 70, height: 70, borderRadius: "50%",
            border: `3px solid var(--bg-card)`,
            background: form.pfpUrl
              ? `url("${form.pfpUrl}") center/cover no-repeat`
              : `linear-gradient(135deg, ${t.accent}, #0ea5e9)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer",
          }}
          onClick={() => pfpInput.current?.click()}
          title="Change profile picture"
          >
            {busyKind === "pfp" ? (
              <Loader2 size={20} color="#fff" className="ic-spin" />
            ) : (!form.pfpUrl && <Camera size={20} color="#fff" />)}
            <input
              ref={pfpInput}
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => upload(e.target.files?.[0], "pfp")}
            />
          </div>
        </div>

        <div style={{ padding: "48px 18px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Display name" t={t}>
            <input
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              placeholder="Your name"
              style={input(t)}
              maxLength={60}
            />
          </Field>
          <Field label="Username" t={t}>
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value.replace(/[^A-Za-z0-9_]/g, "").toLowerCase() })}
              placeholder="handle"
              style={input(t)}
              maxLength={30}
            />
          </Field>
          <Field label="Bio" t={t}>
            <textarea
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value.slice(0, 280) })}
              placeholder="Describe yourself in a line or two"
              rows={3}
              style={{ ...input(t), minHeight: 72, resize: "vertical" }}
            />
            <div style={{ fontSize: 11, color: t.textDim, marginTop: 4, textAlign: "right" }}>
              {form.bio.length}/280
            </div>
          </Field>

          {err && (
            <div style={{
              padding: "8px 10px", borderRadius: 8,
              background: "rgba(239,68,68,0.08)", border: `1px solid var(--red)`,
              color: "var(--red)", fontSize: 12,
            }}>
              {err}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "8px 14px", borderRadius: 8,
                border: `1px solid ${t.border}`, background: "transparent",
                color: t.textMuted, fontSize: 13, cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={save}
              style={{
                padding: "8px 14px", borderRadius: 8, border: "none",
                background: t.accent, color: "#fff", fontSize: 13, fontWeight: 700,
                cursor: saving ? "wait" : "pointer", opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>

        <style jsx global>{`
          @keyframes ic-spin { to { transform: rotate(360deg); } }
          .ic-spin { animation: ic-spin 800ms linear infinite; }
        `}</style>
      </div>
    </div>
  );
}

function Field({ label, children, t }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, color: t.textDim, letterSpacing: 0.4, textTransform: "uppercase" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function input(t) {
  return {
    padding: "8px 10px", borderRadius: 8,
    border: `1px solid ${t.border}`, background: "var(--bg-input)",
    color: t.text, fontSize: 14, fontFamily: "inherit", outline: "none",
    width: "100%",
  };
}
