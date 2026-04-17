"use client";
// DMToast — polls /api/dm/conversations and pops a toast in the
// top-right corner whenever the unread count for a peer increases.
// Silently tolerates a missing backend (HTML responses) so production
// deploys without a backend don't error-spam.
import { useEffect, useRef, useState } from "react";
import { MessageSquare, X } from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";

const API = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const POLL_MS = 15_000;
const TOAST_TTL = 6_000;
const LS_SEEN = "ix_dm_seen_v1";

function readSeen() {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(LS_SEEN) || "{}"); } catch { return {}; }
}
function writeSeen(o) {
  try { localStorage.setItem(LS_SEEN, JSON.stringify(o)); } catch {}
}

export default function DMToast({ onOpenDM }) {
  const t = useTheme();
  const { address } = useWallet();
  const [toasts, setToasts] = useState([]); // { id, peer, unread }
  const seenRef = useRef(readSeen());

  useEffect(() => {
    if (!address) return;
    let alive = true;
    let timer = null;

    const tick = async () => {
      try {
        const r = await fetch(`${API}/api/dm/conversations`, {
          headers: { "x-wallet": address },
        });
        const txt = await r.text();
        if (!r.ok || txt.trimStart().startsWith("<")) return; // backend offline
        let data; try { data = JSON.parse(txt); } catch { return; }
        const convs = Array.isArray(data?.conversations) ? data.conversations : [];
        const seen = seenRef.current;
        const next = { ...seen };
        const popped = [];
        for (const c of convs) {
          const prev = Number(seen[c.id] || 0);
          const cur = Number(c.unread || 0);
          if (cur > prev) {
            popped.push({ id: `${c.id}-${Date.now()}`, convId: c.id, peer: c.peer, unread: cur });
          }
          next[c.id] = cur;
        }
        seenRef.current = next;
        writeSeen(next);
        if (alive && popped.length) {
          setToasts(prev => [...prev, ...popped]);
          for (const p of popped) {
            setTimeout(() => {
              if (!alive) return;
              setToasts(prev => prev.filter(x => x.id !== p.id));
            }, TOAST_TTL);
          }
        }
      } catch (_) { /* offline — silent */ }
    };

    tick();
    timer = setInterval(tick, POLL_MS);
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, [address]);

  const dismiss = (id) => setToasts(prev => prev.filter(x => x.id !== id));

  if (!toasts.length) return null;

  return (
    <div style={{
      position: "fixed", top: 72, right: 16, zIndex: 9999,
      display: "flex", flexDirection: "column", gap: 10,
      pointerEvents: "none",
    }}>
      {toasts.map(toast => {
        const peer = toast.peer || {};
        const label = peer.displayName || peer.username || peer.wallet || "Someone";
        const short = typeof label === "string" && label.length > 24
          ? `${label.slice(0, 10)}…${label.slice(-8)}` : label;
        const initial = (peer.displayName || peer.username || peer.wallet || "?").slice(0, 2).toUpperCase();
        return (
          <div
            key={toast.id}
            onClick={() => { dismiss(toast.id); onOpenDM?.(peer, toast.convId); }}
            style={{
              pointerEvents: "auto",
              display: "flex", alignItems: "center", gap: 10,
              background: t.bgCard, border: `1px solid ${t.accent}55`,
              borderRadius: 14, padding: "12px 14px",
              boxShadow: `0 8px 28px ${t.accent}22, 0 2px 8px rgba(0,0,0,0.35)`,
              minWidth: 280, maxWidth: 340, cursor: "pointer",
              transform: "translateX(0)", animation: "ixDmSlide 0.28s ease-out",
            }}
          >
            <div style={{
              width: 38, height: 38, borderRadius: "50%", flexShrink: 0,
              background: `${t.accent}22`, border: `1px solid ${t.accent}55`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: t.accent, fontWeight: 800, fontSize: 13,
            }}>
              {peer.pfpUrl
                ? <img src={peer.pfpUrl} alt="" style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }} />
                : initial}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <MessageSquare size={12} color={t.accent} />
                <span style={{ fontSize: 11, color: t.accent, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
                  New message
                </span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: t.white, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {short}
              </div>
              <div style={{ fontSize: 12, color: t.textMuted }}>
                {toast.unread} unread — click to open
              </div>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); dismiss(toast.id); }}
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: t.textDim, padding: 4, display: "flex",
              }}
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
      <style>{`@keyframes ixDmSlide { from { transform: translateX(16px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
    </div>
  );
}
