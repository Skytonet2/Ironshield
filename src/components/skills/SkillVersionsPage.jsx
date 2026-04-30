"use client";
// /skills/[id]/versions — version history + diff viewer (Tier 5 slice 5).
//
// Lists every row in skill_runtime_manifests for a given skill_id.
// Selecting two versions reveals a structured field-by-field diff;
// fields that didn't change show as "unchanged".

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme } from "@/lib/contexts";
import { API_BASE as API } from "@/lib/apiBase";
import { GitBranch, Hash, ArrowLeftRight, Calendar } from "lucide-react";

function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function lifecyclePill(s, t) {
  const colors = {
    public:     { bg: "rgba(16,185,129,0.18)", fg: "#10b981" },
    curated:    { bg: "rgba(59,130,246,0.18)", fg: "#3b82f6" },
    internal:   { bg: "rgba(255,255,255,0.10)", fg: t.textMuted },
    deprecated: { bg: "rgba(245,158,11,0.18)", fg: "#f59e0b" },
    slashed:    { bg: "rgba(239,68,68,0.18)",  fg: "#ef4444" },
  };
  const c = colors[s] || colors.internal;
  return (
    <span style={{
      padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600,
      background: c.bg, color: c.fg, textTransform: "uppercase", letterSpacing: 0.5,
    }}>{s}</span>
  );
}

function DiffField({ name, value, t }) {
  if (value === null || value === undefined) {
    return (
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${t.border}`, display: "flex", gap: 12 }}>
        <div style={{ minWidth: 160, color: t.textMuted, fontSize: 13, fontWeight: 600 }}>{name}</div>
        <div style={{ color: t.textMuted, fontSize: 13 }}>unchanged</div>
      </div>
    );
  }
  const fmt = (v) => {
    if (v === null || v === undefined) return "—";
    if (Array.isArray(v)) return v.length ? v.join(", ") : "[]";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };
  return (
    <div style={{ padding: "10px 14px", borderBottom: `1px solid ${t.border}` }}>
      <div style={{ minWidth: 160, color: t.textMuted, fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{name}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div style={{ padding: 8, background: "rgba(239,68,68,0.10)", borderRadius: 6, fontSize: 12, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {fmt(value.from)}
        </div>
        <div style={{ padding: 8, background: "rgba(16,185,129,0.10)", borderRadius: 6, fontSize: 12, fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {fmt(value.to)}
        </div>
      </div>
    </div>
  );
}

export default function SkillVersionsPage({ skillId }) {
  const t = useTheme();
  const [rows, setRows]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr]       = useState("");
  const [from, setFrom]     = useState(null);
  const [to, setTo]         = useState(null);
  const [diff, setDiff]     = useState(null);
  const [diffErr, setDiffErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const r = await fetch(`${API}/api/skills/${skillId}/versions`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setRows(j.rows || []);
      // Auto-pick the two most recent versions (rows are ordered DESC).
      if ((j.rows || []).length >= 2) {
        setFrom(j.rows[1].version);
        setTo(j.rows[0].version);
      }
    } catch (e) {
      setErr(e.message || String(e));
    } finally { setLoading(false); }
  }, [skillId]);

  const loadDiff = useCallback(async () => {
    setDiff(null); setDiffErr("");
    if (!from || !to || from === to) return;
    try {
      const r = await fetch(`${API}/api/skills/${skillId}/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const j = await r.json();
      if (!r.ok) { setDiffErr(j.error || `HTTP ${r.status}`); return; }
      setDiff(j);
    } catch (e) {
      setDiffErr(e.message || String(e));
    }
  }, [skillId, from, to]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadDiff(); }, [loadDiff]);

  const versions = useMemo(() => rows.map(r => r.version), [rows]);

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1100, margin: "0 auto", color: t.white }}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, display: "inline-flex", alignItems: "center", gap: 8 }}>
          <GitBranch size={20} /> Skill #{skillId} — Version history
        </h1>
        <div style={{ color: t.textMuted, fontSize: 13, marginTop: 4 }}>
          Each row is one (skill_id, version) entry in the runtime manifest table.
        </div>
      </div>

      {loading && <div style={{ color: t.textMuted, padding: 16 }}>Loading…</div>}
      {err && <div style={{ color: "#ef4444", padding: 16 }}>Failed to load: {err}</div>}
      {!loading && !err && rows.length === 0 && (
        <div style={{ color: t.textMuted, padding: 32, textAlign: "center", border: `1px dashed ${t.border}`, borderRadius: 12 }}>
          No manifest versions for this skill.
        </div>
      )}

      {/* Version list */}
      {rows.length > 0 && (
        <div style={{ borderRadius: 12, border: `1px solid ${t.border}`, overflow: "hidden", marginBottom: 24 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead style={{ background: t.bgSurface }}>
              <tr style={{ textAlign: "left", color: t.textMuted, fontWeight: 600 }}>
                <th style={{ padding: 12 }}>Version</th>
                <th style={{ padding: 12 }}>Lifecycle</th>
                <th style={{ padding: 12 }}>Hash</th>
                <th style={{ padding: 12 }}>Deployed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ borderTop: `1px solid ${t.border}` }}>
                  <td style={{ padding: 12, fontWeight: 600 }}>{r.version}</td>
                  <td style={{ padding: 12 }}>{lifecyclePill(r.lifecycle_status, t)}</td>
                  <td style={{ padding: 12, fontFamily: "monospace", color: t.textMuted, fontSize: 12 }}>
                    <Hash size={11} style={{ verticalAlign: "middle" }} /> {r.manifest_hash?.slice(0, 12)}…
                  </td>
                  <td style={{ padding: 12, color: t.textMuted, fontSize: 13 }}>
                    <Calendar size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
                    {fmtDate(r.deployed_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Diff viewer */}
      {versions.length >= 2 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <ArrowLeftRight size={16} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>Compare</span>
            <select value={from || ""} onChange={(e) => setFrom(e.target.value)} style={{
              padding: "6px 10px", borderRadius: 6, background: t.bgSurface, color: t.white,
              border: `1px solid ${t.border}`, fontSize: 13,
            }}>
              {versions.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
            <span style={{ color: t.textMuted }}>→</span>
            <select value={to || ""} onChange={(e) => setTo(e.target.value)} style={{
              padding: "6px 10px", borderRadius: 6, background: t.bgSurface, color: t.white,
              border: `1px solid ${t.border}`, fontSize: 13,
            }}>
              {versions.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          {diffErr && <div style={{ color: "#ef4444", padding: 12 }}>{diffErr}</div>}
          {diff && (
            <div style={{ borderRadius: 12, border: `1px solid ${t.border}`, overflow: "hidden" }}>
              {Object.entries(diff.diff).map(([k, v]) => (
                <DiffField key={k} name={k} value={v} t={t} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
