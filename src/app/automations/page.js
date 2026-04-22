"use client";
// /automations — while-you're-away agent presets.
//
// Users bind a running agent to automate engagement on their behalf —
// buys/sells on specific coins, likes/replies on specific authors or
// topics, scheduled posts. Activation costs 10 NEAR one-time (the
// "skin in the game" gate); the backend won't start the loop until
// it sees the on-chain payment.

import { useState } from "react";
import { useTheme, useWallet } from "@/lib/contexts";
import AppShell from "@/components/shell/AppShell";
import { Zap, Coins, Heart, Send, Shield, Lock, CheckCircle2 } from "lucide-react";

const ACTIVATION_NEAR = 10;

const CATEGORIES = [
  {
    key: "coins",
    label: "Trade these coins",
    Icon: Coins,
    description: "Pick tickers your agent can buy / sell. Keep the list small — one or two high-conviction coins works best.",
    placeholder: "e.g. NBULL, IRONCLAW, NEAR",
  },
  {
    key: "topics",
    label: "Like & repost on topics",
    Icon: Heart,
    description: "Posts mentioning these terms get an auto-like. Use hashtags or $TICKERS.",
    placeholder: "e.g. #nearai, $IRONCLAW, governance",
  },
  {
    key: "post-style",
    label: "Post style",
    Icon: Send,
    description: "Short description of your voice — the agent imitates it when it drafts replies or scheduled posts.",
    placeholder: "e.g. terse, technical, anti-hype, 1-2 sentences",
  },
  {
    key: "news-sources",
    label: "News sources to cover",
    Icon: Shield,
    description: "Comma-separated source names. The agent posts a short summary when fresh items appear.",
    placeholder: "e.g. CoinDesk, The Block, NEAR Blog",
  },
];

export default function AutomationsPage() {
  const t = useTheme();
  const { address, showModal } = useWallet();
  const [active, setActive] = useState(false); // TODO: hydrate from backend
  const [cfg, setCfg] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function activate() {
    setErr(null);
    if (!address) { showModal?.(); return; }
    setBusy(true);
    try {
      // Delegates to the payNear helper used everywhere else for
      // platform fees. On success, the backend sees the tx in the
      // webhook and flips the user's automation to "live".
      const { payNear, PLATFORM_TREASURY } = await import("@/lib/payments");
      await payNear({
        amountNear: ACTIVATION_NEAR,
        receiver: PLATFORM_TREASURY,
        memo: "ironshield:automations:activate",
      });
      setActive(true);
    } catch (e) {
      setErr(e?.message || "Activation failed — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "16px 20px" }}>
        <header style={{ marginBottom: 16 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: t.accent, fontSize: 12, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase" }}>
            <Zap size={14} /> Automations
          </div>
          <h1 style={{ margin: "6px 0", fontSize: 22, fontWeight: 800, color: t.white }}>
            Your agent, on autopilot.
          </h1>
          <p style={{ color: t.textMuted, fontSize: 14, lineHeight: 1.55, margin: 0 }}>
            Set a preset and the IronClaw agent acts for you while you're away — trades specific coins,
            likes posts matching your interests, drafts replies in your voice. Activation is{" "}
            <strong style={{ color: t.accent }}>{ACTIVATION_NEAR} NEAR</strong> one-time so only serious
            users run it.
          </p>
        </header>

        {/* Status */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "12px 14px", borderRadius: 10,
          border: `1px solid ${active ? "var(--green)" : t.border}`,
          background: active ? "rgba(16,185,129,0.08)" : "var(--bg-card)",
          marginBottom: 14,
        }}>
          {active ? <CheckCircle2 size={16} color="var(--green)" /> : <Lock size={16} color={t.textDim} />}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: active ? "var(--green)" : t.text }}>
              {active ? "Active" : "Locked"}
            </div>
            <div style={{ fontSize: 12, color: t.textDim }}>
              {active
                ? "Agent is running your preset. Edit below to update rules."
                : `Pay ${ACTIVATION_NEAR} NEAR to activate — one-time, non-refundable.`}
            </div>
          </div>
          {!active && (
            <button
              type="button"
              disabled={busy}
              onClick={activate}
              style={{
                padding: "8px 16px", borderRadius: 8, border: "none",
                background: t.accent, color: "#fff", fontWeight: 700,
                cursor: busy ? "wait" : "pointer", opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? "Activating…" : `Activate · ${ACTIVATION_NEAR} NEAR`}
            </button>
          )}
        </div>

        {err && (
          <div style={{
            fontSize: 12, color: "var(--red)",
            padding: "8px 12px", border: `1px solid var(--red)`, borderRadius: 8,
            background: "rgba(239,68,68,0.06)", marginBottom: 14,
          }}>
            {err}
          </div>
        )}

        {/* Presets */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {CATEGORIES.map((c) => {
            const { Icon } = c;
            return (
              <div
                key={c.key}
                style={{
                  padding: 14, borderRadius: 10,
                  border: `1px solid ${t.border}`, background: "var(--bg-card)",
                  opacity: active ? 1 : 0.65,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <Icon size={14} color={t.accent} />
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{c.label}</div>
                </div>
                <div style={{ fontSize: 12, color: t.textDim, marginBottom: 8 }}>
                  {c.description}
                </div>
                <textarea
                  value={cfg[c.key] || ""}
                  disabled={!active}
                  onChange={(e) => setCfg({ ...cfg, [c.key]: e.target.value })}
                  placeholder={c.placeholder}
                  rows={2}
                  style={{
                    width: "100%", resize: "vertical", minHeight: 48,
                    padding: 10, borderRadius: 8,
                    border: `1px solid ${t.border}`, background: "var(--bg-input)",
                    color: t.text, fontSize: 13, fontFamily: "inherit", outline: "none",
                  }}
                />
              </div>
            );
          })}
        </div>

        <div style={{ fontSize: 11, color: t.textDim, marginTop: 12, lineHeight: 1.5 }}>
          The agent runs in watchdog mode — it never takes an action you didn't explicitly opt in to, and
          every trade is logged on-chain. Disable any category by leaving it blank.
        </div>
      </div>
    </AppShell>
  );
}
