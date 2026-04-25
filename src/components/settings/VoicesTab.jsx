"use client";
// Voices preferences — which categories of the Voices feed the user
// wants mixed into their timeline. The backend ships ~200 handles
// across six categories (politics, crypto, trends, web3, stock,
// tech). This tab lets users switch categories on/off — the Voices
// feed endpoint filters to only the enabled ones via ?categories=.
//
// Why ship this: the default mix tilts heavy on trends/politics,
// which most IronShield users don't want in a crypto-first feed.
// Rather than rewrite the preset, let users opt in to what they care
// about. Prefs persist in localStorage so the choice survives a
// wallet disconnect; when signed in, we also ping the backend so a
// future governance proposal can seed defaults per cohort.

import { useCallback, useEffect, useState } from "react";
import {
  Mic, TrendingUp, Globe, Bitcoin, Newspaper, Cpu, LineChart, Plus, X,
} from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import { API_BASE as API } from "@/lib/apiBase";
import { apiFetch } from "@/lib/apiFetch";
import { tabCard, tabTitle, row, rowSub, toggle } from "./_shared";

// Category metadata — keys must match backend/data/voicesPreset.js.
// `defaultOn` is what a fresh user sees; today the cohort that
// actually opens this tab explicitly asked for politics/trends to be
// opt-in rather than opt-out, so those two default off.
const CATEGORIES = [
  { key: "crypto",   label: "Crypto",          Icon: Bitcoin,    hint: "CT natives, market makers, traders", defaultOn: true  },
  { key: "web3",     label: "Web3 & Protocols",Icon: Globe,      hint: "Core protocol + DeFi accounts",       defaultOn: true  },
  { key: "tech",     label: "Tech & AI",       Icon: Cpu,        hint: "AI labs, founders, engineers",        defaultOn: true  },
  { key: "stock",    label: "Stocks & Macro",  Icon: LineChart,  hint: "Banks, funds, macro voices",          defaultOn: false },
  { key: "trends",   label: "Trends",          Icon: TrendingUp, hint: "Celebrities, sports, pop culture",    defaultOn: false },
  { key: "politics", label: "Politics",        Icon: Newspaper,  hint: "Heads of state, officials, pundits",  defaultOn: false },
];

const DEFAULTS = (() => {
  const cats = {};
  for (const c of CATEGORIES) cats[c.key] = c.defaultOn;
  return { categories: cats, customHandles: [] };
})();

const STORAGE_KEY = "ironshield:voices-prefs";

function loadPrefs() {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!v) return DEFAULTS;
    return {
      categories:    { ...DEFAULTS.categories,    ...(v.categories || {}) },
      customHandles: Array.isArray(v.customHandles) ? v.customHandles : [],
    };
  } catch { return DEFAULTS; }
}

function savePrefs(p) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch {}
  // Let the feed page pick up changes without a remount.
  try {
    window.dispatchEvent(new CustomEvent("ironshield:voices-prefs", { detail: p }));
  } catch {}
}

// Twitter handle: 1–15 chars, alphanumeric + underscore.
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

export default function VoicesTab() {
  const t = useTheme();
  const { address } = useWallet();
  const [prefs, setPrefs] = useState(DEFAULTS);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => { setPrefs(loadPrefs()); }, []);

  const toggleCategory = useCallback((key, value) => {
    setPrefs((prev) => {
      const next = { ...prev, categories: { ...prev.categories, [key]: value } };
      savePrefs(next);
      if (address) {
        apiFetch(`/api/feed/voices-prefs`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        }).catch(() => {});
      }
      return next;
    });
  }, [address]);

  const addHandle = useCallback(() => {
    setErr("");
    const raw = draft.trim().replace(/^@/, "");
    if (!HANDLE_RE.test(raw)) {
      setErr("Enter a valid X handle (letters, numbers, underscore — up to 15 chars).");
      return;
    }
    setPrefs((prev) => {
      if (prev.customHandles.some((h) => h.toLowerCase() === raw.toLowerCase())) {
        setErr("Already added.");
        return prev;
      }
      const next = { ...prev, customHandles: [...prev.customHandles, raw] };
      savePrefs(next);
      return next;
    });
    setDraft("");
  }, [draft]);

  const removeHandle = useCallback((h) => {
    setPrefs((prev) => {
      const next = { ...prev, customHandles: prev.customHandles.filter((x) => x !== h) };
      savePrefs(next);
      return next;
    });
  }, []);

  const enabledCount = CATEGORIES.filter((c) => prefs.categories[c.key]).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={tabTitle(t)}>Voices</h2>
        <p style={{ color: t.textDim, fontSize: 13, margin: "4px 0 0", lineHeight: 1.55 }}>
          Pick which categories of X accounts stream into your Voices tab. Turn off the ones you don't care about — if all six are off, Voices falls back to just native IronShield posts.
        </p>
      </div>

      <section style={tabCard(t)}>
        <div style={{
          fontSize: 11, letterSpacing: 0.8, color: t.textDim, fontWeight: 700,
          textTransform: "uppercase", marginBottom: 12,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span>Categories</span>
          <span style={{ color: t.text, letterSpacing: 0 }}>
            {enabledCount}/{CATEGORIES.length} on
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {CATEGORIES.map((c) => (
            <div key={c.key} style={row(t)}>
              <c.Icon size={15} color={prefs.categories[c.key] ? t.accent : t.textDim} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{c.label}</div>
                <div style={rowSub(t)}>{c.hint}</div>
              </div>
              <Toggle t={t} on={!!prefs.categories[c.key]} onChange={(v) => toggleCategory(c.key, v)} />
            </div>
          ))}
        </div>
      </section>

      <section style={tabCard(t)}>
        <div style={{ fontSize: 11, letterSpacing: 0.8, color: t.textDim, fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>
          Custom handles
        </div>
        <p style={{ color: t.textDim, fontSize: 12, margin: "0 0 10px", lineHeight: 1.5 }}>
          Add up to 20 extra X handles to pull into your Voices tab — these always show regardless of category toggles.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{
            flex: 1, display: "flex", alignItems: "center", gap: 6,
            padding: "8px 10px", borderRadius: 10, border: `1px solid ${t.border}`,
            background: "var(--bg-surface)",
          }}>
            <Mic size={13} color={t.textDim} />
            <span style={{ color: t.textDim, fontSize: 13 }}>@</span>
            <input
              type="text"
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setErr(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") addHandle(); }}
              placeholder="handle"
              maxLength={15}
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                color: t.text, fontSize: 13, padding: 0,
              }}
            />
          </div>
          <button
            type="button"
            onClick={addHandle}
            disabled={!draft.trim() || prefs.customHandles.length >= 20}
            style={{
              padding: "8px 12px", borderRadius: 10, border: "none",
              background: `linear-gradient(135deg, ${t.accent}, #a855f7)`,
              color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
              opacity: (!draft.trim() || prefs.customHandles.length >= 20) ? 0.5 : 1,
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
          >
            <Plus size={13} /> Add
          </button>
        </div>
        {err && (
          <div style={{ fontSize: 11, color: "#ef4444", marginTop: 6 }}>{err}</div>
        )}
        {prefs.customHandles.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
            {prefs.customHandles.map((h) => (
              <span
                key={h}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "4px 8px 4px 10px", borderRadius: 999,
                  background: "rgba(168,85,247,0.12)",
                  border: `1px solid rgba(168,85,247,0.28)`,
                  color: t.text, fontSize: 12, fontWeight: 600,
                }}
              >
                @{h}
                <button
                  type="button"
                  onClick={() => removeHandle(h)}
                  aria-label={`Remove @${h}`}
                  style={{
                    width: 18, height: 18, borderRadius: 999, border: "none",
                    background: "transparent", color: t.textDim, cursor: "pointer",
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
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
