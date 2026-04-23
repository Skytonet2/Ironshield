"use client";
// ReferralCard — self-profile section showing the viewer's invite
// link, how many users they've brought in, and (if applicable) the
// account that invited them. Only renders on the viewer's own
// profile; pass `visible` false from the profile page when the user
// is viewing someone else.
//
// Backend it talks to (lightweight — one call on mount):
//   GET /api/rewards/me         — { rewards: { refCode, referrals, ... } }
//   GET /api/rewards/referrer   — { referrer: { username, ... } | null }

import { useCallback, useEffect, useState } from "react";
import { Link2, Copy, Check, Users, Gift } from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import { API_BASE as API } from "@/lib/apiBase";

export default function ReferralCard() {
  const t = useTheme();
  const { address } = useWallet();
  const [state, setState] = useState({ loaded: false });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!address) { setState({ loaded: true }); return; }
    let alive = true;
    (async () => {
      try {
        const [meR, refR] = await Promise.all([
          fetch(`${API}/api/rewards/me`, { headers: { "x-wallet": address } }).then((r) => r.ok ? r.json() : null),
          fetch(`${API}/api/rewards/referrer`, { headers: { "x-wallet": address } }).then((r) => r.ok ? r.json() : null),
        ]);
        if (!alive) return;
        setState({
          loaded: true,
          refCode: meR?.rewards?.refCode || null,
          referrals: meR?.rewards?.referrals ?? 0,
          referrer: refR?.referrer || null,
        });
      } catch { if (alive) setState({ loaded: true }); }
    })();
    return () => { alive = false; };
  }, [address]);

  const link = state.refCode && typeof window !== "undefined"
    ? `${window.location.origin}/?ref=${state.refCode}`
    : "";

  const onCopy = useCallback(async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }, [link]);

  if (!address || !state.loaded) return null;

  return (
    <section style={{
      margin: "4px 16px 12px",
      padding: 14,
      borderRadius: 14,
      border: `1px solid ${t.border}`,
      background: "linear-gradient(135deg, rgba(168,85,247,0.06), rgba(59,130,246,0.05))",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
        color: t.textDim, fontSize: 11, fontWeight: 700, letterSpacing: 0.6,
        textTransform: "uppercase",
      }}>
        <Gift size={12} /> Invite friends
      </div>

      {/* Share link */}
      <div style={{
        display: "flex", gap: 8, alignItems: "center",
        padding: "8px 10px", borderRadius: 10,
        border: `1px solid ${t.border}`,
        background: "var(--bg-input)",
      }}>
        <Link2 size={13} color={t.textDim} />
        <div style={{
          flex: 1, minWidth: 0,
          fontSize: 12, color: t.text,
          fontFamily: "var(--font-jetbrains-mono), monospace",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {link || "—"}
        </div>
        <button
          type="button"
          onClick={onCopy}
          disabled={!link}
          aria-label="Copy invite link"
          style={{
            padding: "6px 10px", borderRadius: 8, border: "none",
            background: copied ? "var(--green)" : `linear-gradient(135deg, ${t.accent}, #a855f7)`,
            color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 4,
            transition: "background 120ms ease",
          }}
        >
          {copied ? <><Check size={12}/> Copied</> : <><Copy size={12}/> Copy</>}
        </button>
      </div>

      {/* Stats + inviter */}
      <div style={{
        marginTop: 10, display: "flex", alignItems: "center",
        gap: 14, flexWrap: "wrap", fontSize: 12, color: t.textDim,
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Users size={12} />
          <span style={{ color: t.text, fontWeight: 700 }}>{state.referrals ?? 0}</span> invited
        </span>
        {state.referrer && (
          <span>
            Invited by{" "}
            <a
              href={`/profile/?username=${encodeURIComponent(state.referrer.username || "")}`}
              style={{ color: t.accent, textDecoration: "none", fontWeight: 700 }}
            >
              @{state.referrer.username || state.referrer.wallet?.slice(0, 6)}
            </a>
          </span>
        )}
      </div>
    </section>
  );
}
