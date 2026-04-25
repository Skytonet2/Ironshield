"use client";
// Keywords — manage a list of terms the user wants to surface (or hide)
// across the feed. Entries persist locally and sync to the backend
// `/api/feed/keywords` when available; the local store keeps the UI
// responsive during rollout.

import { useCallback, useEffect, useState } from "react";
import { Plus, X, Eye, EyeOff } from "lucide-react";
import { useTheme, useWallet } from "@/lib/contexts";
import { API_BASE as API } from "@/lib/apiBase";
import { apiFetch } from "@/lib/apiFetch";
import { tabCard, tabTitle, btn, input } from "./_shared";

function loadLocal() {
  if (typeof window === "undefined") return { follow: [], block: [] };
  try {
    return JSON.parse(localStorage.getItem("ironshield:keywords") || '{"follow":[],"block":[]}');
  } catch { return { follow: [], block: [] }; }
}
function saveLocal(v) {
  try { localStorage.setItem("ironshield:keywords", JSON.stringify(v)); } catch {}
}

export default function KeywordsTab() {
  const t = useTheme();
  const { address } = useWallet();
  const [kws, setKws] = useState({ follow: [], block: [] });
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState("follow"); // follow | block

  useEffect(() => { setKws(loadLocal()); }, []);

  const persist = useCallback((next) => {
    setKws(next);
    saveLocal(next);
    if (address) {
      apiFetch(`/api/feed/keywords`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      }).catch(() => {});
    }
  }, [address]);

  const add = () => {
    const v = draft.trim().toLowerCase();
    if (!v) return;
    if (kws[mode].includes(v)) { setDraft(""); return; }
    persist({ ...kws, [mode]: [...kws[mode], v] });
    setDraft("");
  };
  const remove = (section, v) => {
    persist({ ...kws, [section]: kws[section].filter((x) => x !== v) });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={tabTitle(t)}>Keywords</h2>
        <p style={{ color: t.textDim, fontSize: 13, margin: "4px 0 0", lineHeight: 1.55 }}>
          Boost posts that match <strong style={{ color: "var(--green)" }}>Follow</strong> terms and hide posts that match <strong style={{ color: "var(--red)" }}>Block</strong> terms. Case-insensitive, partial match on content + hashtags.
        </p>
      </div>

      <section style={tabCard(t)}>
        <form
          onSubmit={(e) => { e.preventDefault(); add(); }}
          style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}
        >
          <div style={{ display: "flex", border: `1px solid ${t.border}`, borderRadius: 8, overflow: "hidden" }}>
            {["follow", "block"].map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} style={{
                padding: "8px 12px", border: "none",
                background: mode === m ? "var(--accent-dim)" : "transparent",
                color: mode === m ? t.accent : t.textMuted,
                fontSize: 12, fontWeight: 700, cursor: "pointer", textTransform: "capitalize",
              }}>
                {m === "follow" ? <Eye size={12} style={{ marginRight: 4, verticalAlign: "-2px" }} /> : <EyeOff size={12} style={{ marginRight: 4, verticalAlign: "-2px" }} />}
                {m}
              </button>
            ))}
          </div>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={mode === "follow" ? "e.g. ironclaw, $NEAR, airdrop" : "e.g. rugpull, giveaway"}
            style={{ ...input(t), flex: 1, minWidth: 180 }}
          />
          <button type="submit" style={btn(t, true)}>
            <Plus size={13} /> Add
          </button>
        </form>

        <KeywordList
          t={t} label="Follow" color="var(--green)" items={kws.follow}
          onRemove={(v) => remove("follow", v)}
          empty="No Follow keywords yet — posts won't be boosted by keyword."
        />
        <div style={{ height: 14 }} />
        <KeywordList
          t={t} label="Block" color="var(--red)" items={kws.block}
          onRemove={(v) => remove("block", v)}
          empty="No Block keywords — nothing is filtered out by keyword."
        />
      </section>
    </div>
  );
}

function KeywordList({ t, label, color, items, onRemove, empty }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: t.textDim, textTransform: "uppercase", marginBottom: 8 }}>
        {label} · {items.length}
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: t.textDim, fontStyle: "italic" }}>{empty}</div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {items.map((v) => (
            <span key={v} style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              padding: "4px 10px", borderRadius: 999,
              background: `${color}22`, color,
              border: `1px solid ${color}55`,
              fontSize: 12, fontWeight: 600,
            }}>
              {v}
              <button
                type="button" onClick={() => onRemove(v)} aria-label={`Remove ${v}`}
                style={{ background: "transparent", border: "none", color, cursor: "pointer", padding: 0, display: "inline-flex" }}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
