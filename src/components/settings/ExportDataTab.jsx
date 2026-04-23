"use client";
// Export Data — downloads the viewer's data as a JSON bundle. Pulls
// the profile snapshot, recent posts, and any local preferences
// (notifications, keywords, theme) so the user has a GDPR-style
// portable archive. The backend doesn't need a new endpoint; we
// compose from existing ones.

import { useState } from "react";
import { Download, FileJson, CheckCircle2 } from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import { API_BASE as API } from "@/lib/apiBase";
import { tabCard, tabTitle, btn } from "./_shared";

export default function ExportDataTab() {
  const t = useTheme();
  const { address } = useWallet();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(null);

  const onExport = async () => {
    if (!address) return;
    setBusy(true);
    setErr(null);
    setDone(false);
    try {
      const [profile, posts] = await Promise.all([
        fetch(`${API}/api/profile/${encodeURIComponent(address)}`).then(r => r.ok ? r.json() : null),
        fetch(`${API}/api/users/${encodeURIComponent(address)}/posts?limit=100`, {
          headers: { "x-wallet": address },
        }).then(r => r.ok ? r.json() : null),
      ]);

      const localPrefs = {};
      try {
        for (const k of ["ironshield:notif-prefs", "ironshield:keywords", "ironshield:theme"]) {
          const v = localStorage.getItem(k);
          if (v) localPrefs[k] = JSON.parse(v);
        }
      } catch {}

      const bundle = {
        exportedAt: new Date().toISOString(),
        wallet: address,
        profile: profile?.user || null,
        posts: posts?.posts || [],
        preferences: localPrefs,
        version: 1,
      };
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `ironshield-export-${address.replace(/[^a-z0-9_-]/gi, "_")}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDone(true);
      setTimeout(() => setDone(false), 3000);
    } catch (e) {
      setErr(e.message || "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={tabTitle(t)}>Export Data</h2>
        <p style={{ color: t.textDim, fontSize: 13, margin: "4px 0 0", lineHeight: 1.55 }}>
          Download your profile, up to 100 of your most recent posts, and local preferences (theme, notifications, keywords) as a JSON bundle.
        </p>
      </div>
      <section style={tabCard(t)}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: "var(--accent-dim)", color: t.accent,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            <FileJson size={18} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>ironshield-export.json</div>
            <div style={{ fontSize: 11, color: t.textDim, marginTop: 2 }}>
              Includes profile fields, posts metadata, and device preferences.
            </div>
          </div>
          <button
            type="button"
            onClick={onExport}
            disabled={!address || busy}
            style={{ ...btn(t, true), opacity: !address || busy ? 0.5 : 1 }}
          >
            {done ? <><CheckCircle2 size={13} /> Done</> : busy ? "Exporting…" : <><Download size={13} /> Export</>}
          </button>
        </div>
        {!address && (
          <div style={{ fontSize: 12, color: t.textDim, marginTop: 12 }}>
            Connect a wallet to export your data.
          </div>
        )}
        {err && (
          <div style={{ fontSize: 12, color: "var(--red)", marginTop: 12 }}>{err}</div>
        )}
      </section>
    </div>
  );
}
