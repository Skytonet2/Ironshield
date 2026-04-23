"use client";
// Notifications preferences — toggles for each channel + event type.
// Preferences persist in localStorage and are mirrored to the backend's
// /api/push/preferences endpoint if present; when the endpoint isn't
// there yet (staging DBs that haven't run the migration), the local
// copy still keeps the UI responsive.

import { useCallback, useEffect, useState } from "react";
import { Bell, Mail, MessageSquare, Phone, Zap, Target, DollarSign, Shield, Users as UsersIcon } from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import { usePWA } from "@/lib/usePWA";
import { API_BASE as API } from "@/lib/apiBase";
import { tabCard, tabTitle, row, rowSub, toggle } from "./_shared";

const CHANNELS = [
  { key: "web",      label: "In-app",  Icon: Bell,    hint: "Banner + counter on the bell icon" },
  { key: "push",     label: "Push",    Icon: Phone,   hint: "Browser / mobile push notifications" },
  { key: "email",    label: "Email",   Icon: Mail,    hint: "Daily digest + urgent alerts" },
  { key: "telegram", label: "Telegram", Icon: MessageSquare, hint: "Via the IronClaw TG bot" },
];

const EVENTS = [
  { key: "mentions",    label: "Mentions",         Icon: UsersIcon,  hint: "When someone @mentions you" },
  { key: "replies",     label: "Replies",          Icon: MessageSquare, hint: "New replies on your posts" },
  { key: "tips",        label: "Tips received",    Icon: DollarSign, hint: "Someone sends you IRON or NEAR" },
  { key: "tracker",     label: "Tracker alerts",   Icon: Target,     hint: "Price / volume triggers" },
  { key: "governance",  label: "Governance",       Icon: Shield,     hint: "New proposals and voting windows" },
  { key: "rooms",       label: "Room invites",     Icon: Zap,        hint: "Someone invites you to a live room" },
];

const DEFAULTS = {
  channels: { web: true, push: false, email: false, telegram: false },
  events:   { mentions: true, replies: true, tips: true, tracker: true, governance: true, rooms: true },
};

function loadPrefs() {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const v = JSON.parse(localStorage.getItem("ironshield:notif-prefs") || "null");
    if (!v) return DEFAULTS;
    return {
      channels: { ...DEFAULTS.channels, ...(v.channels || {}) },
      events:   { ...DEFAULTS.events,   ...(v.events   || {}) },
    };
  } catch { return DEFAULTS; }
}

function savePrefs(p) {
  try { localStorage.setItem("ironshield:notif-prefs", JSON.stringify(p)); } catch {}
}

export default function NotificationsTab() {
  const t = useTheme();
  const { address } = useWallet();
  const { pushEnabled, pushDenied, enablePush, disablePush, isIOS } = usePWA(address);
  const [prefs, setPrefs] = useState(DEFAULTS);
  const [syncedAt, setSyncedAt] = useState(null);
  const [pushError, setPushError] = useState("");
  const [testResult, setTestResult] = useState("");

  useEffect(() => { setPrefs(loadPrefs()); }, []);

  // Keep the "Push" channel toggle in sync with the real browser
  // subscription state. Without this, the UI can lie — e.g. a user
  // toggles push on, we ignore it, and the toggle stays lit despite
  // no actual SW subscription existing.
  useEffect(() => {
    setPrefs((prev) => {
      if (prev.channels.push === pushEnabled) return prev;
      const next = { ...prev, channels: { ...prev.channels, push: pushEnabled } };
      savePrefs(next);
      return next;
    });
  }, [pushEnabled]);

  const update = useCallback(async (section, key, value) => {
    // Push channel is backed by a real browser subscription, not just
    // a prefs flag — route it through the PWA hook so the device
    // actually gets enrolled (or unenrolled) with the push service.
    if (section === "channels" && key === "push") {
      setPushError("");
      if (value) {
        const res = await enablePush();
        if (!res.ok) {
          setPushError(res.message || "Couldn't enable push.");
          return; // leave toggle off — useEffect above will reconcile
        }
      } else {
        await disablePush();
      }
      return; // pushEnabled effect reconciles prefs.channels.push
    }

    setPrefs((prev) => {
      const next = { ...prev, [section]: { ...prev[section], [key]: value } };
      savePrefs(next);
      if (address) {
        fetch(`${API}/api/push/preferences`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "x-wallet": address },
          body: JSON.stringify(next),
        }).then(() => setSyncedAt(Date.now())).catch(() => {});
      }
      return next;
    });
  }, [address, enablePush, disablePush]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={tabTitle(t)}>Notifications</h2>
        <p style={{ color: t.textDim, fontSize: 13, margin: "4px 0 0", lineHeight: 1.55 }}>
          Choose how IronShield reaches you. Preferences are stored on this device; they sync to the server when you're signed in.
        </p>
      </div>

      <section style={tabCard(t)}>
        <div style={{ fontSize: 11, letterSpacing: 0.8, color: t.textDim, fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>
          Channels
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {CHANNELS.map((c) => (
            <div key={c.key} style={row(t)}>
              <c.Icon size={15} color={prefs.channels[c.key] ? t.accent : t.textDim} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{c.label}</div>
                <div style={rowSub(t)}>
                  {c.key === "push" && pushDenied
                    ? "Blocked in browser settings — re-enable there first."
                    : c.key === "push" && pushError
                      ? pushError
                      : c.hint}
                </div>
              </div>
              <Toggle t={t} on={!!prefs.channels[c.key]} onChange={(v) => update("channels", c.key, v)} />
            </div>
          ))}
        </div>
        {/* Test-push button — users couldn't otherwise verify the
            subscribe flow worked end-to-end without waiting for
            someone to like/comment. /api/push/test fires a real push
            to the caller's own device subscriptions. */}
        {pushEnabled && (
          <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={async () => {
                if (!address) { setTestResult("Connect wallet first."); return; }
                setTestResult("Sending…");
                try {
                  const r = await fetch(`${API}/api/push/test`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "x-wallet": address },
                  });
                  const j = await r.json().catch(() => ({}));
                  if (r.ok) setTestResult(`Sent to ${j.pushedTo || 1} device(s). Check your notifications.`);
                  else setTestResult(j.message || `Test failed (HTTP ${r.status}).`);
                } catch (e) { setTestResult(`Test failed: ${e.message}`); }
              }}
              style={{
                padding: "8px 14px", borderRadius: 10, border: `1px solid ${t.border}`,
                background: "transparent", color: t.text, fontSize: 12, fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Send test notification
            </button>
            {testResult && (
              <span style={{ fontSize: 11, color: t.textDim }}>{testResult}</span>
            )}
          </div>
        )}
      </section>

      <section style={tabCard(t)}>
        <div style={{ fontSize: 11, letterSpacing: 0.8, color: t.textDim, fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>
          Event types
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {EVENTS.map((e) => (
            <div key={e.key} style={row(t)}>
              <e.Icon size={15} color={prefs.events[e.key] ? t.accent : t.textDim} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{e.label}</div>
                <div style={rowSub(t)}>{e.hint}</div>
              </div>
              <Toggle t={t} on={!!prefs.events[e.key]} onChange={(v) => update("events", e.key, v)} />
            </div>
          ))}
        </div>
      </section>

      {syncedAt && (
        <div style={{ fontSize: 11, color: t.textDim, textAlign: "right" }}>
          Synced to server · {new Date(syncedAt).toLocaleTimeString()}
        </div>
      )}
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
