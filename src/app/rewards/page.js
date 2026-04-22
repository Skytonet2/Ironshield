"use client";
// /rewards — placeholder. Scoring, claim flow, and leaderboard land in
// a later commit once the reward program design is locked.

import { useTheme } from "@/lib/contexts";
import AppShell from "@/components/shell/AppShell";
import { Trophy, Coins, Users, Zap } from "lucide-react";

const TILES = [
  { label: "Post Points",       Icon: Zap,    hint: "Posting, liking, reposting" },
  { label: "Trade Volume",      Icon: Coins,  hint: "DEX activity counted per day" },
  { label: "Referrals",         Icon: Users,  hint: "Friends who sign up with your link" },
  { label: "Missions",          Icon: Trophy, hint: "Task-driven quests from governance" },
];

export default function RewardsPage() {
  const t = useTheme();
  return (
    <AppShell>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "16px 20px" }}>
        <header style={{ marginBottom: 16 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: t.accent, fontSize: 12, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase" }}>
            <Trophy size={14} /> Rewards
          </div>
          <h1 style={{ margin: "6px 0", fontSize: 22, fontWeight: 800, color: t.white }}>
            IronClaw rewards.
          </h1>
          <p style={{ color: t.textMuted, fontSize: 14, lineHeight: 1.55, margin: 0 }}>
            Your activity on IronShield earns IronClaw. The breakdown below previews what will be
            tracked — claim, leaderboards, and boosted categories unlock as the program goes live.
          </p>
        </header>

        <div style={{
          display: "grid", gap: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          marginBottom: 16,
        }}>
          {TILES.map((x) => {
            const { Icon } = x;
            return (
              <div
                key={x.label}
                style={{
                  padding: 14, borderRadius: 10,
                  border: `1px solid ${t.border}`, background: "var(--bg-card)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <Icon size={14} color={t.accent} />
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{x.label}</div>
                </div>
                <div style={{ fontSize: 12, color: t.textDim }}>{x.hint}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: t.textDim, marginTop: 10 }}>—</div>
              </div>
            );
          })}
        </div>

        <div style={{
          padding: 14, borderRadius: 10,
          border: `1px dashed ${t.border}`,
          fontSize: 13, color: t.textMuted, lineHeight: 1.5,
        }}>
          <strong style={{ color: t.text }}>Coming soon.</strong> The reward economy is being finalized with
          the community. Action counts are already indexed, so everything you do from today forwards will
          count once claims open.
        </div>
      </div>
    </AppShell>
  );
}
