"use client";
// src/components/connectors/ConnectDialog.jsx
//
// Modal that collects credentials for a single connector and posts
// them to /api/connectors/:name/connect. Uses apiFetch which signs
// the request via NEP-413 (or session token, if cached).

import { useState } from "react";
import { X, Eye, EyeOff, Loader2, ShieldAlert, ExternalLink } from "lucide-react";
import { apiFetch } from "@/lib/apiFetch";
import { CONNECTOR_META, flatToPayload } from "./connectorMeta";

export default function ConnectDialog({ connectorName, onClose, onConnected }) {
  const meta = CONNECTOR_META[connectorName];
  const [values, setValues] = useState({});
  const [reveal, setReveal] = useState({});
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState(null);

  if (!meta) return null;

  const set = (k, v) => setValues((s) => ({ ...s, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      // Required-field check.
      for (const f of meta.fields) {
        if (f.required && !values[f.key]) throw new Error(`${f.label} is required`);
      }
      const payload = flatToPayload(values);
      const r = await apiFetch(`/api/connectors/${encodeURIComponent(connectorName)}/connect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payload }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `connect failed (${r.status})`);
      onConnected?.();
      onClose?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" onClick={onClose}>
      <form style={modalStyle} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ ...dotStyle, background: meta.color }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text-1)" }}>Connect {meta.label}</div>
              <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.45, marginTop: 2 }}>{meta.blurb}</div>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={closeBtnStyle}>
            <X size={16} />
          </button>
        </div>

        {meta.warning && (
          <div style={warnStyle}>
            <ShieldAlert size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{meta.warning}</span>
          </div>
        )}

        {Array.isArray(meta.oauth_providers) && meta.oauth_providers.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {meta.oauth_providers.map((p) => (
              <button
                type="button"
                key={p.provider}
                onClick={async () => {
                  setBusy(true); setErr(null);
                  try {
                    const r = await apiFetch(
                      `/api/connectors/${encodeURIComponent(connectorName)}/oauth/${p.provider}/start`,
                      { method: "POST" }
                    );
                    const j = await r.json();
                    if (!r.ok || !j.url) throw new Error(j.error || `oauth start failed (${r.status})`);
                    window.location.href = j.url;
                  } catch (e) {
                    setErr(e.message); setBusy(false);
                  }
                }}
                style={{
                  ...oauthBtnStyle,
                  borderColor: p.color,
                  color: p.color,
                }}
              >
                {p.label}
              </button>
            ))}
            <div style={dividerStyle}>
              <span>or use an app password</span>
            </div>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {meta.fields.map((f) => {
            const isSecret = f.secret;
            const showing = reveal[f.key];
            return (
              <label key={f.key} style={fieldWrapStyle}>
                <span style={fieldLabelStyle}>
                  {f.label}{f.required && <span style={{ color: "var(--red)" }}> *</span>}
                </span>
                <div style={{ position: "relative" }}>
                  <input
                    type={isSecret && !showing ? "password" : f.type === "number" ? "number" : "text"}
                    value={values[f.key] || ""}
                    onChange={(e) => set(f.key, e.target.value)}
                    placeholder={f.placeholder || ""}
                    autoComplete="off"
                    spellCheck={false}
                    style={inputStyle}
                  />
                  {isSecret && (
                    <button
                      type="button"
                      onClick={() => setReveal((s) => ({ ...s, [f.key]: !s[f.key] }))}
                      aria-label={showing ? "Hide" : "Reveal"}
                      style={revealBtnStyle}
                    >
                      {showing ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  )}
                </div>
                {f.hint && <span style={hintStyle}>{f.hint}</span>}
              </label>
            );
          })}
        </div>

        {err && <div style={errStyle}>{err}</div>}

        <div style={footerStyle}>
          <a
            href={`https://github.com/Skytonet2/Ironshield/blob/main/backend/connectors/${connectorName}/COMPLIANCE.md`}
            target="_blank" rel="noreferrer"
            style={complianceLinkStyle}
          >
            <ExternalLink size={12} />
            Compliance note
          </a>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={onClose} style={cancelBtnStyle}>Cancel</button>
            <button type="submit" disabled={busy} style={submitBtnStyle}>
              {busy && <Loader2 size={13} style={{ animation: "spin 0.9s linear infinite" }} />}
              {busy ? "Connecting…" : "Connect"}
            </button>
          </div>
        </div>

        <style jsx>{`
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </form>
    </div>
  );
}

const overlayStyle = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000, padding: 16,
};
const modalStyle = {
  background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14,
  padding: 18, width: "100%", maxWidth: 480, maxHeight: "92vh", overflowY: "auto",
  display: "flex", flexDirection: "column", gap: 14,
};
const headerStyle = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 };
const closeBtnStyle = {
  background: "transparent", border: "none", color: "var(--text-2)", cursor: "pointer",
  padding: 4, borderRadius: 6,
};
const dotStyle = { width: 10, height: 10, borderRadius: 99, flexShrink: 0, marginTop: 4 };
const warnStyle = {
  display: "flex", gap: 8, padding: 10, borderRadius: 8,
  background: "rgba(245, 158, 11, 0.08)", border: "1px solid rgba(245, 158, 11, 0.25)",
  color: "var(--amber, #f59e0b)", fontSize: 12, lineHeight: 1.5,
};
const fieldWrapStyle = { display: "flex", flexDirection: "column", gap: 4 };
const fieldLabelStyle = { fontSize: 11.5, color: "var(--text-2)", fontWeight: 600 };
const inputStyle = {
  width: "100%", background: "var(--bg-input)", border: "1px solid var(--border)",
  borderRadius: 8, padding: "9px 10px", color: "var(--text-1)", fontSize: 13, outline: "none",
};
const revealBtnStyle = {
  position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
  background: "transparent", border: "none", color: "var(--text-2)", cursor: "pointer",
  padding: 4, borderRadius: 4,
};
const hintStyle = { fontSize: 11, color: "var(--text-3)", lineHeight: 1.45 };
const errStyle = {
  padding: 9, borderRadius: 8,
  background: "rgba(255,77,77,0.08)", border: "1px solid rgba(255,77,77,0.3)",
  color: "var(--red)", fontSize: 12,
};
const footerStyle = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  gap: 10, paddingTop: 6, borderTop: "1px dashed var(--border)",
};
const complianceLinkStyle = {
  fontSize: 11.5, color: "var(--text-2)", textDecoration: "none",
  display: "inline-flex", alignItems: "center", gap: 4,
};
const cancelBtnStyle = {
  background: "transparent", border: "1px solid var(--border)", color: "var(--text-2)",
  padding: "8px 14px", borderRadius: 8, fontSize: 12.5, cursor: "pointer",
};
const submitBtnStyle = {
  background: "linear-gradient(135deg, #a855f7, #60a5fa)", color: "#fff",
  border: "1px solid var(--accent-border)", padding: "8px 16px", borderRadius: 8,
  fontSize: 12.5, fontWeight: 700, cursor: "pointer",
  display: "inline-flex", alignItems: "center", gap: 6,
};
const oauthBtnStyle = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  padding: "10px 14px",
  borderRadius: 8,
  fontSize: 12.5,
  fontWeight: 700,
  cursor: "pointer",
  width: "100%",
  textAlign: "center",
};
const dividerStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  margin: "4px 0",
  fontSize: 10.5,
  color: "var(--text-3)",
  textTransform: "uppercase",
  letterSpacing: 1,
};
