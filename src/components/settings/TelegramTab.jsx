"use client";
// Telegram / Agent settings.
//
// Mirrors the bot's \`/settings\` surface on the web so users can
// manage their TG notification prefs + agent tunables without opening
// the chat. Reads and writes \`feed_tg_links.settings\` via
// GET /api/tg/status?wallet=...  (returns tgId + current settings)
// and POST /api/tg/settings       (merges the JSONB patch).
//
// Why the surface looks the way it does:
// - The 10 notification toggles mirror bot/commands/settings.js so
//   users see the same choices on both sides.
// - Quiet hours + digest time are new keys (quiet_start, quiet_end,
//   digest_time) persisted in the same settings JSONB. The bot's
//   priceMonitor / dailyDigest jobs can read them when we're ready
//   to honor them; until then they're advisory and harmless.
// - Agent verbosity is an enum we pass through to the TG agent's
//   system prompt so terse users don't get novels.

import { useCallback, useEffect, useState } from "react";
import {
  Bot, Send, RefreshCcw, ExternalLink, Check, Heart, Repeat2,
  MessageCircle, UserPlus, DollarSign, Mail, TrendingUp, Shield,
  Sparkles, AlertTriangle, Moon, Clock,
} from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import { API_BASE as API } from "@/lib/apiBase";
import { apiFetch } from "@/lib/apiFetch";
import { tabCard, tabTitle, row, rowSub, toggle } from "./_shared";

// Must match bot/commands/settings.js toggle keys.
const NOTIF_TOGGLES = [
  { key: "likes",        label: "Likes",          Icon: Heart },
  { key: "reposts",      label: "Reposts",        Icon: Repeat2 },
  { key: "comments",     label: "Replies",        Icon: MessageCircle },
  { key: "follows",      label: "Follows",        Icon: UserPlus },
  { key: "tips",         label: "Tips",           Icon: DollarSign },
  { key: "dms",          label: "DMs",            Icon: Mail },
  { key: "coin_created", label: "Coin launches",  Icon: Sparkles },
  { key: "pump",         label: "Pump alerts",    Icon: TrendingUp },
  { key: "alpha",        label: "Alpha calls",    Icon: Shield },
  { key: "downtime",     label: "Downtime",       Icon: AlertTriangle },
];

const VERBOSITY = [
  { key: "terse",    label: "Terse",    hint: "Short replies, just the facts" },
  { key: "balanced", label: "Balanced", hint: "Default — conversational with context" },
  { key: "detailed", label: "Detailed", hint: "Longer explanations, extra color" },
];

// Simple HH:MM helpers — we store strings not Date objects so the
// JSONB stays cheap to parse and the bot job can diff by text.
const TIMES = [];
for (let h = 0; h < 24; h++) {
  for (const m of [0, 30]) {
    const pad = (n) => String(n).padStart(2, "0");
    TIMES.push(`${pad(h)}:${pad(m)}`);
  }
}

export default function TelegramTab() {
  const t = useTheme();
  const { address } = useWallet();
  const [state, setState] = useState({ loading: true, linked: false });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [linkCode, setLinkCode] = useState(null);

  const refresh = useCallback(async () => {
    if (!address) { setState({ loading: false, linked: false }); return; }
    setState((s) => ({ ...s, loading: true }));
    try {
      // /status now reads the wallet from the NEP-413 signature, not
      // a query param — anyone could otherwise probe any wallet's TG
      // settings. apiFetch handles the signing + Bearer token reuse.
      const r = await apiFetch(`/api/tg/status`);
      const j = await r.json();
      setState({ loading: false, ...j });
    } catch (e) {
      setState({ loading: false, linked: false, error: e.message });
    }
  }, [address]);

  useEffect(() => { refresh(); }, [refresh]);

  const startLink = useCallback(async () => {
    if (!address) return;
    setSaveError("");
    try {
      // /link-code now derives the wallet from the signature — body
      // wallet field used to be trusted, which let anyone mint codes
      // for any wallet. apiFetch handles the auth.
      const r = await apiFetch(`/api/tg/link-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await r.json();
      if (!r.ok || !j.deepLink) throw new Error(j.error || "Failed to generate link code");
      setLinkCode(j);
      // Open in a new tab so the user doesn't lose the settings page.
      window.open(j.deepLink, "_blank", "noopener");
    } catch (e) { setSaveError(e.message); }
  }, [address]);

  const patchSettings = useCallback(async (patch) => {
    if (!state.tgId) return;
    setSaving(true);
    setSaveError("");
    // Optimistic — revert on failure so the toggle doesn't lie.
    const prev = state.settings || {};
    const next = { ...prev, ...patch };
    setState((s) => ({ ...s, settings: next }));
    try {
      const r = await fetch(`${API}/api/tg/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tgId: state.tgId, settings: patch }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `Save failed (HTTP ${r.status})`);
      }
    } catch (e) {
      setState((s) => ({ ...s, settings: prev }));
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }, [state.tgId, state.settings]);

  if (state.loading) {
    return (
      <div style={{ color: t.textDim, fontSize: 13, padding: 20 }}>Loading Telegram settings…</div>
    );
  }

  if (!address) {
    return (
      <div style={tabCard(t)}>
        <h2 style={tabTitle(t)}>Telegram</h2>
        <p style={{ color: t.textDim, fontSize: 13, margin: "4px 0 0", lineHeight: 1.55 }}>
          Connect a wallet first, then you can link Telegram here.
        </p>
      </div>
    );
  }

  // ─── Unlinked state ───────────────────────────────────────────────
  if (!state.linked) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <h2 style={tabTitle(t)}>Telegram</h2>
          <p style={{ color: t.textDim, fontSize: 13, margin: "4px 0 0", lineHeight: 1.55 }}>
            Link your Telegram so IronClaw can DM you alerts, route trades, and reply to agent queries from anywhere.
          </p>
        </div>
        <section style={tabCard(t)}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: "rgba(59,130,246,0.12)",
              border: "1px solid rgba(59,130,246,0.28)",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
            }}>
              <Send size={18} color="#3b82f6" />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>IronClaw Bot</div>
              <div style={{ fontSize: 12, color: t.textDim }}>@AZUKACore_bot on Telegram</div>
            </div>
          </div>
          <button
            type="button"
            onClick={startLink}
            disabled={!address}
            style={{
              padding: "10px 16px", borderRadius: 10, border: "none",
              background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
              color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 8,
              opacity: address ? 1 : 0.5,
            }}
          >
            <ExternalLink size={14} /> Link Telegram
          </button>
          {linkCode && (
            <div style={{ marginTop: 14, padding: 12, borderRadius: 10, border: `1px solid ${t.border}`, background: "var(--bg-surface)" }}>
              <div style={{ fontSize: 12, color: t.textDim, marginBottom: 6 }}>
                If the bot didn't open, paste this into Telegram:
              </div>
              <code style={{
                fontSize: 13, fontFamily: "var(--font-jetbrains-mono), monospace",
                color: t.text, letterSpacing: 1,
              }}>/start {linkCode.code}</code>
              <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={refresh}
                  style={{
                    padding: "6px 10px", borderRadius: 8, border: `1px solid ${t.border}`,
                    background: "transparent", color: t.text, fontSize: 12, cursor: "pointer",
                    display: "inline-flex", alignItems: "center", gap: 6,
                  }}
                >
                  <RefreshCcw size={12} /> I've linked it — refresh
                </button>
              </div>
            </div>
          )}
          {saveError && <div style={{ fontSize: 11, color: "#ef4444", marginTop: 8 }}>{saveError}</div>}
        </section>
      </div>
    );
  }

  // ─── Linked state ────────────────────────────────────────────────
  const s = state.settings || {};
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={tabTitle(t)}>Telegram</h2>
        <p style={{ color: t.textDim, fontSize: 13, margin: "4px 0 0", lineHeight: 1.55 }}>
          Linked as{" "}
          <span style={{ color: t.text, fontWeight: 700 }}>@{state.username || "—"}</span>
          . Changes save automatically.
          {saving && <span style={{ color: t.textDim, marginLeft: 8 }}>saving…</span>}
          {saveError && <span style={{ color: "#ef4444", marginLeft: 8 }}>{saveError}</span>}
        </p>
      </div>

      {/* Notification toggles — mirror of /settings on the bot. */}
      <section style={tabCard(t)}>
        <div style={{ fontSize: 11, letterSpacing: 0.8, color: t.textDim, fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>
          Alert types
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {NOTIF_TOGGLES.map((n) => {
            const on = s[n.key] !== false; // default true
            return (
              <div key={n.key} style={row(t)}>
                <n.Icon size={15} color={on ? t.accent : t.textDim} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{n.label}</div>
                </div>
                <Toggle t={t} on={on} onChange={(v) => patchSettings({ [n.key]: v })} />
              </div>
            );
          })}
        </div>
      </section>

      {/* Delivery — digest time + quiet hours. New keys; the bot jobs
          will honor them once we ship the job-side changes. Harmless
          until then. */}
      <section style={tabCard(t)}>
        <div style={{ fontSize: 11, letterSpacing: 0.8, color: t.textDim, fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>
          Delivery
        </div>

        <div style={row(t)}>
          <Clock size={15} color={s.digest_time ? t.accent : t.textDim} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>Daily digest</div>
            <div style={rowSub(t)}>Time of day to drop your 24h summary</div>
          </div>
          <select
            value={s.digest_time || "08:00"}
            onChange={(e) => patchSettings({ digest_time: e.target.value })}
            style={selectStyle(t)}
          >
            {TIMES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>

        <div style={row(t)}>
          <Moon size={15} color={(s.quiet_start && s.quiet_end) ? t.accent : t.textDim} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>Quiet hours</div>
            <div style={rowSub(t)}>Mute alerts during this window</div>
          </div>
          <select
            value={s.quiet_start || "--"}
            onChange={(e) => patchSettings({ quiet_start: e.target.value === "--" ? null : e.target.value })}
            style={selectStyle(t)}
          >
            <option value="--">Off</option>
            {TIMES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <span style={{ color: t.textDim, fontSize: 12, padding: "0 4px" }}>→</span>
          <select
            value={s.quiet_end || "--"}
            onChange={(e) => patchSettings({ quiet_end: e.target.value === "--" ? null : e.target.value })}
            style={selectStyle(t)}
            disabled={!s.quiet_start}
          >
            <option value="--">Off</option>
            {TIMES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
      </section>

      {/* Agent — verbosity + auto-confirm floor. */}
      <section style={tabCard(t)}>
        <div style={{ fontSize: 11, letterSpacing: 0.8, color: t.textDim, fontWeight: 700, textTransform: "uppercase", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
          <Bot size={12} /> Agent
        </div>

        <div style={row(t)}>
          <Sparkles size={15} color={t.accent} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>Reply verbosity</div>
            <div style={rowSub(t)}>
              {(VERBOSITY.find((v) => v.key === (s.agent_verbosity || "balanced")) || {}).hint}
            </div>
          </div>
          <select
            value={s.agent_verbosity || "balanced"}
            onChange={(e) => patchSettings({ agent_verbosity: e.target.value })}
            style={selectStyle(t)}
          >
            {VERBOSITY.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
          </select>
        </div>

        <div style={row(t)}>
          <Check size={15} color={s.auto_confirm_under > 0 ? t.accent : t.textDim} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>Auto-confirm small trades</div>
            <div style={rowSub(t)}>Skip the confirm prompt for swaps under this USD amount</div>
          </div>
          <select
            value={String(s.auto_confirm_under ?? 0)}
            onChange={(e) => patchSettings({ auto_confirm_under: Number(e.target.value) })}
            style={selectStyle(t)}
          >
            <option value="0">Never</option>
            <option value="5">$5</option>
            <option value="10">$10</option>
            <option value="25">$25</option>
            <option value="50">$50</option>
          </select>
        </div>
      </section>

      {/* Unlink — danger path. */}
      <section style={tabCard(t)}>
        <div style={{ fontSize: 11, letterSpacing: 0.8, color: t.textDim, fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>
          Danger zone
        </div>
        <p style={{ color: t.textDim, fontSize: 12, margin: "0 0 10px", lineHeight: 1.5 }}>
          Unlinking stops all Telegram alerts and deletes your settings from the bot. You can re-link anytime.
        </p>
        <button
          type="button"
          onClick={async () => {
            if (!confirm("Unlink Telegram? Your bot alerts will stop immediately.")) return;
            // No /api/tg/unlink endpoint yet — send /unlink from the bot
            // is the documented path. Surface that rather than silently
            // failing or adding a half-baked route.
            alert("To unlink, open the bot and send /unlink. A web unlink is coming in the next pass.");
          }}
          style={{
            padding: "8px 14px", borderRadius: 10, border: `1px solid rgba(239,68,68,0.4)`,
            background: "transparent", color: "#ef4444", fontSize: 12, fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Unlink Telegram
        </button>
      </section>
    </div>
  );
}

function Toggle({ t, on, onChange }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      style={toggle(t, on)}
    >
      <span style={{
        position: "absolute", top: 2, left: on ? 22 : 2,
        width: 18, height: 18, borderRadius: "50%",
        background: "#fff", transition: "left 160ms ease",
      }} />
    </button>
  );
}

function selectStyle(t) {
  return {
    padding: "6px 10px", borderRadius: 8,
    border: `1px solid ${t.border}`, background: "var(--bg-input)",
    color: t.text, fontSize: 12, cursor: "pointer", outline: "none",
    fontFamily: "inherit",
  };
}
