"use client";
// TrackersTab — live settings for AIO + Vision feed tracker types.
//
// Each tracker type has an on/off toggle per mode (AIO vs Vision).
// The feed store reads these via /aio's subscribe call, so flipping a
// toggle immediately stops receiving that tracker's events on next
// WS push. The local filter in feedStore also respects the set so
// already-loaded items can be filtered on the fly — no full reload
// needed.

import { useTheme } from "@/lib/contexts";
import { useSettings } from "@/lib/stores/settingsStore";

const TRACKERS = [
  { key: "ca",         label: "Contract Addresses",   desc: "Token CAs surfaced by scrapers + indexers" },
  { key: "x",          label: "X Posts",              desc: "Watchlist X/Twitter activity via Voices aggregator" },
  { key: "dex",        label: "DEX Events",           desc: "Raydium / Ref / PancakeSwap pool activity" },
  { key: "near",       label: "NEAR Chain",           desc: "NEAR RPC signals (staking, social.near, governance)" },
  { key: "telegram",   label: "Telegram",             desc: "Tracked group messages (alpha chats, news bots)" },
  { key: "news",       label: "News",                 desc: "RSS-ingested headlines from the IronNews bot" },
  { key: "ironclaw",   label: "IronClaw Alerts",      desc: "Autonomous security + scam alerts" },
  { key: "newpair",    label: "New Pairs",            desc: "Fresh DEX listings across chains" },
  { key: "wallet",     label: "Wallet Watch",         desc: "Tracked whale / insider wallet activity" },
];

function ToggleRow({ label, desc, checked, onChange, accent, t }) {
  return (
    <label style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "10px 14px",
      borderRadius: 10,
      border: `1px solid ${checked ? accent : t.border}`,
      background: checked ? "var(--accent-dim)" : "var(--bg-card)",
      cursor: "pointer",
      transition: "border-color 120ms var(--ease-out)",
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{
          width: 16, height: 16,
          accentColor: accent,
          cursor: "pointer",
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: t.white, fontSize: 13, fontWeight: 600 }}>{label}</div>
        <div style={{ color: t.textMuted, fontSize: 11, marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
      </div>
    </label>
  );
}

export default function TrackersTab() {
  const t = useTheme();
  const aio    = useSettings((s) => s.aioTrackers);
  const vision = useSettings((s) => s.visionTrackers);
  const setTracker = useSettings((s) => s.setTracker);

  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: t.white }}>
        Trackers
      </h1>
      <p style={{ margin: "4px 0 20px", fontSize: 12, color: t.textMuted }}>
        Pick which event types feed into the AIO stream vs. the Vision panels.
        Turning a tracker off drops new events silently; currently-visible
        items stay until you refresh.
      </p>

      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 24,
      }}>
        {[
          { mode: "aio",    title: "AIO Feed",      state: aio,    accent: t.accent },
          { mode: "vision", title: "Vision Panels", state: vision, accent: "var(--accent)" },
        ].map(({ mode, title, state, accent }) => (
          <section key={mode}>
            <h2 style={{
              margin: "0 0 10px", fontSize: 11, letterSpacing: 1,
              color: t.textDim, textTransform: "uppercase", fontWeight: 600,
            }}>
              {title}
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {TRACKERS.map((tr) => (
                <ToggleRow
                  key={`${mode}-${tr.key}`}
                  label={tr.label}
                  desc={tr.desc}
                  checked={!!state[tr.key]}
                  onChange={(v) => setTracker(mode, tr.key, v)}
                  accent={accent === "var(--accent)" ? t.accent : accent}
                  t={t}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
