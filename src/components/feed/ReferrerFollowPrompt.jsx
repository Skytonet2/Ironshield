"use client";
// ReferrerFollowPrompt — one-time banner on /feed telling a brand-
// new user who invited them, with a Follow button pre-wired to the
// inviter's wallet. Dismissable. Stash is set by WalletProvider in
// src/lib/contexts.js when the visitor arrived via /?ref=<code> and
// the backend accepted the claim.

import { useCallback, useEffect, useState } from "react";
import { X as XIcon, UserPlus, Sparkles } from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import { API_BASE as API } from "@/lib/apiBase";
import { apiFetch } from "@/lib/apiFetch";

const STORAGE_KEY  = "ironshield:ref-prompt";
const DISMISS_KEY  = "ironshield:ref-prompt-dismissed";

function readReferrer() {
  try {
    if (localStorage.getItem(DISMISS_KEY) === "1") return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

export default function ReferrerFollowPrompt() {
  const t = useTheme();
  const { address } = useWallet();
  const [referrer, setReferrer] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setReferrer(readReferrer()); }, []);

  const dismiss = useCallback(() => {
    try { localStorage.setItem(DISMISS_KEY, "1"); localStorage.removeItem(STORAGE_KEY); } catch {}
    setReferrer(null);
  }, []);

  const onFollow = useCallback(async () => {
    if (!address || !referrer?.wallet) return;
    setBusy(true);
    try {
      await apiFetch(`/api/social/follow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetWallet: referrer.wallet }),
      });
    } catch {}
    setBusy(false);
    dismiss();
  }, [address, referrer, dismiss]);

  if (!referrer) return null;

  return (
    <div style={{
      margin: "10px 0",
      padding: "12px 14px",
      borderRadius: 14,
      border: `1px solid rgba(168,85,247,0.35)`,
      background: "linear-gradient(135deg, rgba(168,85,247,0.12), rgba(59,130,246,0.09))",
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: "50%",
        background: "rgba(168,85,247,0.18)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
        backgroundImage: referrer.pfpUrl ? `url(${referrer.pfpUrl})` : undefined,
        backgroundSize: "cover", backgroundPosition: "center",
      }}>
        {!referrer.pfpUrl && <Sparkles size={16} color={t.accent} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: t.text, fontWeight: 700 }}>
          Welcome! You were invited by{" "}
          <a
            href={`/profile/?username=${encodeURIComponent(referrer.username || "")}`}
            style={{ color: t.accent, textDecoration: "none" }}
          >
            @{referrer.username || referrer.wallet?.slice(0, 6)}
          </a>
        </div>
        <div style={{ fontSize: 12, color: t.textDim, marginTop: 2 }}>
          Follow to stay in their circle.
        </div>
      </div>
      <button
        type="button"
        onClick={onFollow}
        disabled={busy}
        style={{
          padding: "6px 12px", borderRadius: 999, border: "none",
          background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
          color: "#fff", fontSize: 12, fontWeight: 700, cursor: busy ? "wait" : "pointer",
          display: "inline-flex", alignItems: "center", gap: 6,
          opacity: busy ? 0.7 : 1,
        }}
      >
        <UserPlus size={12} /> Follow
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          width: 28, height: 28, borderRadius: 999, border: "none",
          background: "transparent", color: t.textDim, cursor: "pointer",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <XIcon size={14} />
      </button>
    </div>
  );
}
