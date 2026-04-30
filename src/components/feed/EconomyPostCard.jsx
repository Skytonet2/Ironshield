"use client";
// EconomyPostCard — dispatcher that renders the right card variant
// for an agent-economy post. Falls through to the legacy FeedCard for
// chat posts so the existing social feed is undisturbed.
//
// Variants:
//   receipt  — auto-authored mission outcome card; shows kit + payout
//              + time-to-close + the "Use this Kit" / "Hire this agent"
//              CTAs that drive the daily-return loop.
//   mission  — free-form intent post; embeds the AgentBidSidebar.
//   bounty   — escrowed challenge; embeds the BountyLeaderboard.
//   chat     — legacy social post; delegates to FeedCard untouched.

import { useMemo } from "react";
import FeedCard from "./FeedCard";
import AgentBidSidebar from "./AgentBidSidebar";
import BountyLeaderboard from "./BountyLeaderboard";
import { useTheme } from "@/lib/contexts";

function yoctoToNear(y) {
  if (!y) return "0";
  try {
    const big = BigInt(String(y));
    const PER = 1_000_000_000_000_000_000_000_000n; // 1e24
    const whole = big / PER;
    const frac  = big % PER;
    if (frac === 0n) return whole.toString();
    // 4-decimal-place representation; good enough for a feed line.
    const fracStr = (Number(frac) / 1e24).toFixed(4).slice(2);
    return `${whole}.${fracStr.replace(/0+$/, "") || "0"}`;
  } catch { return String(y); }
}

function fmtMs(ms) {
  if (!ms || ms < 0) return null;
  const s = Math.floor(ms / 1000);
  if (s < 60)   return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48)   return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function ReceiptCard({ post, t, onUseKit, onHireAgent }) {
  const intent = post.intent_json || {};
  const payoutNear = yoctoToNear(intent.payout_yocto);
  const ttc = fmtMs(intent.time_to_close_ms);
  return (
    <div style={{
      padding: "14px 16px", borderRadius: 12,
      border: `1px solid ${t.border}`, background: t.bg || "white",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--green, #2a8)", marginBottom: 4 }}>
        ✓ Mission closed
      </div>
      <div style={{ fontSize: 14, color: t.text, marginBottom: 6 }}>{post.content}</div>
      <div style={{ display: "flex", gap: 12, fontSize: 11, color: t.textDim, marginBottom: 10, flexWrap: "wrap" }}>
        {intent.kit_slug && <span>Kit: <strong style={{ color: t.text }}>{intent.kit_slug}</strong></span>}
        {ttc && <span>Closed in <strong style={{ color: t.text }}>{ttc}</strong></span>}
        {payoutNear !== "0" && <span>Payout <strong style={{ color: t.text }}>{payoutNear} NEAR</strong></span>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {intent.kit_slug && (
          <button type="button" onClick={() => onUseKit?.(intent.kit_slug)} style={{
            padding: "6px 12px", borderRadius: 8, border: `1px solid ${t.border}`,
            background: "transparent", color: t.text, fontSize: 12, fontWeight: 600, cursor: "pointer",
          }}>
            Use this Kit
          </button>
        )}
        {intent.claimant_wallet && (
          <button type="button" onClick={() => onHireAgent?.(intent.claimant_wallet)} style={{
            padding: "6px 12px", borderRadius: 8, border: "none",
            background: t.accent, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}>
            Hire this agent
          </button>
        )}
      </div>
    </div>
  );
}

function MissionCard({ post, t, viewerWallet, onHired }) {
  return (
    <div style={{
      padding: "14px 16px", borderRadius: 12,
      border: `1px solid ${t.border}`, background: t.bg || "white",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: t.accent, marginBottom: 4 }}>
        Looking to hire {post.status !== "open" ? `· ${post.status}` : ""}
      </div>
      <div style={{ fontSize: 14, color: t.text, marginBottom: 4, whiteSpace: "pre-wrap" }}>{post.content}</div>
      <div style={{ fontSize: 11, color: t.textDim }}>
        by {post.author?.username || post.author?.wallet_address}
      </div>
      <AgentBidSidebar post={post} viewerWallet={viewerWallet} onHired={onHired} />
    </div>
  );
}

function BountyCard({ post, t, viewerWallet }) {
  const yocto = post.escrow_yocto;
  return (
    <div style={{
      padding: "14px 16px", borderRadius: 12,
      border: `1px solid ${t.border}`, background: t.bg || "white",
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--purple, #84c)" }}>Bounty</span>
        {yocto && (
          <span style={{ fontSize: 12, fontWeight: 700, color: t.text }}>
            {yoctoToNear(yocto)} NEAR
          </span>
        )}
      </div>
      <div style={{ fontSize: 14, color: t.text, marginBottom: 4, whiteSpace: "pre-wrap" }}>{post.content}</div>
      <div style={{ fontSize: 11, color: t.textDim }}>
        by {post.author?.username || post.author?.wallet_address}
      </div>
      <BountyLeaderboard postId={post.id} />
    </div>
  );
}

export default function EconomyPostCard(props) {
  const t = useTheme();
  const { post } = props;
  const type = post?.type || "chat";

  if (type === "receipt") return <ReceiptCard post={post} t={t} {...props} />;
  if (type === "mission") return <MissionCard post={post} t={t} {...props} />;
  if (type === "bounty")  return <BountyCard  post={post} t={t} {...props} />;
  return <FeedCard {...props} />;
}
