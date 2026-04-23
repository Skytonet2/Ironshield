"use client";
// FollowButton — toggle-follow control for the profile header.
//
// Backend: POST /api/social/follow { targetWallet } returns { following }.
// The route toggles (follow if not yet, unfollow if already) and fires a
// follow notification when flipping on. We read the starting state via
// GET /api/social/following-state so the button renders correctly on
// first paint instead of flashing "Follow" then flipping.

import { useCallback, useEffect, useState } from "react";
import { UserPlus, UserMinus, Loader2 } from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import { API_BASE as API } from "@/lib/apiBase";

export default function FollowButton({ targetWallet, onCountChange }) {
  const t = useTheme();
  const { address: viewer } = useWallet();
  const [state, setState] = useState({ following: false, loaded: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Hide on our own profile — can't follow yourself.
  const isSelf = viewer && targetWallet && viewer.toLowerCase() === targetWallet.toLowerCase();

  // Read the current follow state so the label renders correctly on
  // first mount. Avoids the "Follow → Following" flip flash when a
  // viewer revisits a profile they already follow.
  useEffect(() => {
    if (!viewer || !targetWallet || isSelf) { setState({ following: false, loaded: true }); return; }
    let alive = true;
    (async () => {
      try {
        const r = await fetch(
          `${API}/api/social/following-state?target=${encodeURIComponent(targetWallet)}`,
          { headers: { "x-wallet": viewer } }
        );
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!alive) return;
        setState({ following: !!j.following, loaded: true });
      } catch {
        // If the state endpoint isn't mounted (older backend), fall
        // back to "not following" — first click still toggles on.
        if (alive) setState({ following: false, loaded: true });
      }
    })();
    return () => { alive = false; };
  }, [viewer, targetWallet, isSelf]);

  const toggle = useCallback(async () => {
    if (!viewer) { setErr("Connect wallet to follow."); return; }
    if (!targetWallet || isSelf) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`${API}/api/social/follow`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-wallet": viewer },
        body: JSON.stringify({ targetWallet }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setState({ following: !!j.following, loaded: true });
      if (onCountChange) onCountChange(j.following ? 1 : -1);
    } catch (e) {
      setErr(e.message || "Follow failed");
    } finally {
      setBusy(false);
    }
  }, [viewer, targetWallet, isSelf, onCountChange]);

  if (isSelf || !targetWallet) return null;

  const following = state.following;
  const Icon = busy ? Loader2 : following ? UserMinus : UserPlus;

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        onClick={toggle}
        disabled={busy || !state.loaded}
        aria-pressed={following}
        aria-busy={busy}
        style={{
          padding: "6px 14px",
          borderRadius: 999,
          border: following ? `1px solid ${t.border}` : "none",
          background: following
            ? "transparent"
            : `linear-gradient(135deg, ${t.accent}, #a855f7)`,
          color: following ? t.text : "#fff",
          fontSize: 12,
          fontWeight: 700,
          cursor: busy || !state.loaded ? "wait" : "pointer",
          display: "inline-flex", alignItems: "center", gap: 6,
          opacity: state.loaded ? 1 : 0.6,
          transition: "opacity 120ms ease, background 120ms ease",
        }}
        onMouseEnter={(e) => {
          if (following) e.currentTarget.style.borderColor = "#ef4444";
        }}
        onMouseLeave={(e) => {
          if (following) e.currentTarget.style.borderColor = t.border;
        }}
      >
        <Icon size={12} style={busy ? { animation: "ic-spin 800ms linear infinite" } : undefined} />
        {following ? "Following" : "Follow"}
      </button>
      {err && (
        <span style={{ fontSize: 10, color: "#ef4444" }}>{err}</span>
      )}
    </div>
  );
}
