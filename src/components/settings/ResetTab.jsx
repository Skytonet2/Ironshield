"use client";
// Reset to Defaults — clears every IronShield-prefixed localStorage key
// so the UI returns to its first-run state. Doesn't touch auth state
// or wallet connections; those live under their own prefixes and are
// managed from Wallets / Disconnect.

import { useState } from "react";
import { RotateCcw, CheckCircle2, AlertTriangle } from "lucide-react";
import { useTheme } from "@/lib/contexts";
import { tabCard, tabTitle, btn } from "./_shared";

const PREFIXES = ["ironshield:", "ironfeed:", "ironclaw:"];

export default function ResetTab() {
  const t = useTheme();
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(null);

  const onReset = () => {
    if (!window.confirm("Reset all IronShield preferences on this device? This affects theme, notifications, keywords, pinned items. Auth state is untouched.")) return;
    setErr(null);
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && PREFIXES.some((p) => k.startsWith(p))) toRemove.push(k);
      }
      for (const k of toRemove) localStorage.removeItem(k);
      setDone(true);
      // Force a reload so components re-read their initial state.
      setTimeout(() => { window.location.reload(); }, 800);
    } catch (e) {
      setErr(e.message || "Reset failed");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={tabTitle(t)}>Reset to Defaults</h2>
        <p style={{ color: t.textDim, fontSize: 13, margin: "4px 0 0", lineHeight: 1.55 }}>
          Clears every IronShield preference on this device — theme, notifications, keywords, cached states, and similar. The page will reload so the app re-initializes from defaults.
        </p>
      </div>

      <section style={{
        ...tabCard(t),
        borderColor: "rgba(245,158,11,0.35)",
        background: "linear-gradient(180deg, rgba(245,158,11,0.05), transparent 60%), var(--bg-card)",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <AlertTriangle size={16} color="var(--amber)" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 12, color: t.text, lineHeight: 1.55 }}>
            This action is local-only — your profile, posts, and backend data stay intact. Wallet connections aren't touched. Use <strong>Disconnect Wallets</strong> instead to sign out of wallets.
          </div>
        </div>
      </section>

      <div>
        <button type="button" onClick={onReset} style={btn(t, true)} disabled={done}>
          {done ? <><CheckCircle2 size={13} /> Reset — reloading…</> : <><RotateCcw size={13} /> Reset preferences</>}
        </button>
      </div>
      {err && <div style={{ fontSize: 12, color: "var(--red)" }}>{err}</div>}
    </div>
  );
}
