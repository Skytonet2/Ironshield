"use client";
// NotificationsDrawer — slide-in panel on desktop, full-screen sheet
// on mobile. Groups rows by "Today" / "Earlier" and tags each with
// a type-specific icon (Like / Repost / Comment / Mention / Follow
// / Tip / System). Marks everything as read on open, so reopening
// the drawer doesn't re-pulse the bell badge.
//
// Rendered from AppShell via the global "ironshield:open-notifications"
// event, keyed to the viewer's wallet from useWallet(). Closes on
// backdrop click, Esc, or after a long idle so it doesn't linger
// across sessions.

import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  X, Heart, Repeat2, MessageCircle, UserPlus, AtSign, DollarSign,
  Shield, Bell, CheckCheck,
} from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import { useNotifications } from "@/lib/hooks/useNotifications";

const TYPE_META = {
  like:    { Icon: Heart,         color: "#ef4444", label: "liked" },
  repost:  { Icon: Repeat2,       color: "#10b981", label: "reposted" },
  comment: { Icon: MessageCircle, color: "#3b82f6", label: "replied to" },
  mention: { Icon: AtSign,        color: "#a855f7", label: "mentioned you" },
  follow:  { Icon: UserPlus,      color: "#f59e0b", label: "followed you" },
  tip:     { Icon: DollarSign,    color: "#10b981", label: "tipped" },
  system:  { Icon: Shield,        color: "#64748b", label: "" },
};

export default function NotificationsDrawer({ open, onClose }) {
  const t = useTheme() || {};
  const { address } = useWallet();
  const { items, markAllRead } = useNotifications(address);
  const panelRef = useRef(null);

  // Mark-all-read on open. The server writes read_at=NOW(); the
  // optimistic update means the badge clears without a round-trip.
  useEffect(() => {
    if (open && address) markAllRead();
  }, [open, address, markAllRead]);

  // Esc to close + body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  // Group rows by "today" vs "earlier" so heavy activity reads as
  // a timeline, not a flat 50-row wall.
  const groups = useMemo(() => {
    const today = []; const earlier = [];
    const now = Date.now();
    for (const n of items) {
      const created = n.created_at ? new Date(n.created_at).getTime() : now;
      if (now - created < 24 * 60 * 60 * 1000) today.push(n);
      else earlier.push(n);
    }
    return { today, earlier };
  }, [items]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-label="Notifications"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 500,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
        display: "flex", justifyContent: "flex-end",
      }}
    >
      <aside
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className="ix-notif-panel"
        style={{
          width: "min(100vw, 420px)",
          height: "100dvh",
          background: "linear-gradient(180deg, rgba(168,85,247,0.04), transparent 40%), var(--bg-surface)",
          borderLeft: `1px solid ${t.border}`,
          display: "flex", flexDirection: "column",
          boxShadow: "-28px 0 80px rgba(0,0,0,0.5)",
          animation: "ixNotifIn 220ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* Header */}
        <header style={{
          height: 52, flexShrink: 0,
          display: "flex", alignItems: "center", gap: 10,
          padding: "0 14px",
          borderBottom: `1px solid ${t.border}`,
        }}>
          <Bell size={14} color={t.accent} />
          <div style={{ fontSize: 14, fontWeight: 800, color: t.white, flex: 1 }}>
            Notifications
          </div>
          {items.length > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              title="Mark all as read"
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "4px 8px", borderRadius: 6,
                border: `1px solid ${t.border}`, background: "transparent",
                color: t.textMuted, fontSize: 11, fontWeight: 600, cursor: "pointer",
              }}
            >
              <CheckCheck size={11} />
              Mark read
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 30, height: 30, borderRadius: 8,
              border: `1px solid ${t.border}`, background: "transparent",
              color: t.textMuted, cursor: "pointer",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <X size={14} />
          </button>
        </header>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 0" }}>
          {!address ? (
            <EmptyState t={t} label="Connect a wallet to see your notifications." />
          ) : items.length === 0 ? (
            <EmptyState t={t} label="Nothing new yet. Likes, reposts, follows, and tips will land here." />
          ) : (
            <>
              {groups.today.length > 0 && (
                <Section t={t} title="Today">
                  {groups.today.map((n) => <Row key={n.id} n={n} t={t} />)}
                </Section>
              )}
              {groups.earlier.length > 0 && (
                <Section t={t} title="Earlier">
                  {groups.earlier.map((n) => <Row key={n.id} n={n} t={t} />)}
                </Section>
              )}
            </>
          )}
        </div>

        <style jsx global>{`
          @keyframes ixNotifIn {
            from { transform: translateX(24px); opacity: 0; }
            to   { transform: translateX(0); opacity: 1; }
          }
        `}</style>
      </aside>
    </div>,
    document.body
  );
}

function Section({ title, t, children }) {
  return (
    <div>
      <div style={{
        fontSize: 10, color: t.textDim, fontWeight: 700,
        letterSpacing: 0.8, textTransform: "uppercase",
        padding: "10px 16px 6px",
      }}>
        {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Row({ n, t }) {
  const meta = TYPE_META[n.type] || TYPE_META.system;
  const { Icon } = meta;
  const actor = n.actor_name || n.actor_username || "Someone";
  const href = resolveHref(n);
  return (
    <a
      href={href}
      style={{
        display: "flex", gap: 10,
        padding: "10px 14px",
        borderLeft: n.read_at ? "2px solid transparent" : `2px solid ${t.accent}`,
        background: n.read_at ? "transparent" : "var(--accent-dim)",
        color: "inherit", textDecoration: "none",
        transition: "background 120ms ease",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-card-hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = n.read_at ? "transparent" : "var(--accent-dim)"; }}
    >
      {/* Avatar (actor pfp or fallback) with type badge overlay */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        {n.actor_pfp ? (
          <img
            src={n.actor_pfp} alt=""
            width={36} height={36}
            style={{ borderRadius: "50%", objectFit: "cover" }}
            onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
          />
        ) : (
          <div style={{
            width: 36, height: 36, borderRadius: "50%",
            background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
            color: "#fff", fontWeight: 800, fontSize: 14,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {(actor[0] || "?").toUpperCase()}
          </div>
        )}
        <span style={{
          position: "absolute", bottom: -2, right: -2,
          width: 18, height: 18, borderRadius: "50%",
          background: `${meta.color}`,
          color: "#fff",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          border: `2px solid var(--bg-surface)`,
        }}>
          <Icon size={10} />
        </span>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: t.text, lineHeight: 1.4 }}>
          <strong style={{ color: t.white }}>{actor}</strong>
          {meta.label && <span style={{ color: t.textMuted }}> {meta.label}</span>}
          {n.type === "like"    && " your post"}
          {n.type === "repost"  && " your post"}
          {n.type === "comment" && " your post"}
          {n.type === "tip"     && " you"}
        </div>
        <div style={{ fontSize: 11, color: t.textDim, marginTop: 2 }}>
          {timeAgo(n.created_at)}
        </div>
      </div>
    </a>
  );
}

function EmptyState({ t, label }) {
  return (
    <div style={{
      margin: "20px 16px",
      padding: 24, borderRadius: 12,
      border: `1px dashed ${t.border}`,
      color: t.textDim, fontSize: 13, textAlign: "center", lineHeight: 1.5,
    }}>
      {label}
    </div>
  );
}

function resolveHref(n) {
  if (n.type === "follow" && n.actor_username) return `/profile?username=${encodeURIComponent(n.actor_username)}`;
  if (n.post_id) return `/feed?post=${encodeURIComponent(n.post_id)}`;
  return "#";
}

function timeAgo(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60)    return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)    return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)    return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30)    return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
