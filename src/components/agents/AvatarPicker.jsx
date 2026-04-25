"use client";
// AvatarPicker — pick from 30 first-party presets or upload from the
// device. Uploads are resized client-side to 256x256 JPEG before
// they hit the network, so we don't ship raw 5MB photos to the
// backend or chain. The resized blob is POSTed as base64 to
// /api/agents/avatar (Postgres-backed for now); on success the
// picker emits the absolute URL the dashboard can render.

import { useCallback, useRef, useState } from "react";
import { Upload, Loader2, Check } from "lucide-react";
import { API_BASE as API } from "@/lib/apiBase";
import { useTheme, useWallet } from "@/lib/contexts";
import { PRESETS, parseAvatar } from "./avatarPresets";
import AgentAvatar from "./AgentAvatar";

const MAX_INPUT_BYTES   = 8 * 1024 * 1024;  // 8MB — photos straight from a phone
const RESIZE_DIMENSION  = 256;
const RESIZE_QUALITY    = 0.82;

async function resizeFileToDataUrl(file) {
  if (typeof window === "undefined") throw new Error("Browser only");
  const img = await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im  = new Image();
    im.onload  = () => { URL.revokeObjectURL(url); resolve(im); };
    im.onerror = (e) => { URL.revokeObjectURL(url); reject(new Error("Couldn't read image")); };
    im.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = RESIZE_DIMENSION;
  const ctx = canvas.getContext("2d");
  // Cover-fit to a square so portrait/landscape photos crop nicely.
  const min = Math.min(img.width, img.height);
  const sx  = (img.width  - min) / 2;
  const sy  = (img.height - min) / 2;
  ctx.drawImage(img, sx, sy, min, min, 0, 0, RESIZE_DIMENSION, RESIZE_DIMENSION);
  return canvas.toDataURL("image/jpeg", RESIZE_QUALITY);
}

export default function AvatarPicker({ value, onChange }) {
  const t = useTheme();
  const { address } = useWallet();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState(null);

  const parsed = parseAvatar(value);
  const selectedPresetId = parsed.kind === "preset" ? parsed.preset.id : null;

  const onFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (file) await handleUpload(file);
    if (fileRef.current) fileRef.current.value = "";
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpload = useCallback(async (file) => {
    setError(null);
    if (file.size > MAX_INPUT_BYTES) {
      setError(`Image is ${(file.size / 1024 / 1024).toFixed(1)}MB — pick something under 8MB.`);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("That's not an image file.");
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await resizeFileToDataUrl(file);
      // If no backend reachable, fall back to embedding the data URL
      // directly. Lossy but it works offline / pre-deploy.
      if (!API || !address) {
        onChange(dataUrl);
        return;
      }
      const r = await fetch(`${API}/api/agents/avatar`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "x-wallet": address },
        body:    JSON.stringify({ data_url: dataUrl }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `Upload failed (HTTP ${r.status})`);
      onChange(j.url || dataUrl);
    } catch (err) {
      setError(err?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [address, onChange]);

  return (
    <div>
      {/* Live preview + upload row */}
      <div style={{
        display: "flex", alignItems: "center", gap: 14, marginBottom: 12,
        padding: "12px 14px",
        background: t.bgSurface, border: `1px solid ${t.border}`, borderRadius: 12,
      }}>
        <AgentAvatar value={value} size={56} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: t.white, marginBottom: 2 }}>
            Agent avatar
          </div>
          <div style={{ fontSize: 11.5, color: t.textMuted, lineHeight: 1.4 }}>
            Pick a preset below or upload a square image (auto-cropped to 256×256).
          </div>
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "9px 14px", flexShrink: 0,
            background: uploading ? t.bgCard : `linear-gradient(135deg, #a855f7, ${t.accent})`,
            border: "none", borderRadius: 10,
            fontSize: 12.5, fontWeight: 700,
            color: "#fff",
            cursor: uploading ? "wait" : "pointer",
            opacity: uploading ? 0.7 : 1,
          }}
        >
          {uploading
            ? <><Loader2 size={12} style={{ animation: "ma-spin 0.9s linear infinite" }} /> Uploading…</>
            : <><Upload size={12} /> Upload</>}
        </button>
        <input
          ref={fileRef} type="file" accept="image/*"
          onChange={onFile} style={{ display: "none" }}
        />
      </div>

      {error && (
        <div style={{
          padding: "8px 10px", marginBottom: 10, fontSize: 12,
          background: "rgba(239,68,68,0.12)", color: "#fca5a5", borderRadius: 8,
        }}>{error}</div>
      )}

      {/* Preset grid */}
      <div style={{
        display: "grid", gap: 8,
        gridTemplateColumns: "repeat(auto-fit, minmax(56px, 1fr))",
      }}>
        {PRESETS.map(p => {
          const selected = selectedPresetId === p.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-label={`Pick ${p.id}`}
              title={p.id.replace(/-/g, " ")}
              onClick={() => onChange(`preset:${p.id}`)}
              style={{
                position: "relative",
                padding: 4,
                background: selected ? `${t.accent}14` : "transparent",
                border: selected
                  ? `2px solid ${t.accent}`
                  : `1px solid ${t.border}`,
                borderRadius: 12,
                cursor: "pointer",
                aspectRatio: "1 / 1",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "border-color 120ms ease, background 120ms ease",
              }}
            >
              <AgentAvatar value={`preset:${p.id}`} size="100%" />
              {selected && (
                <span aria-hidden style={{
                  position: "absolute", top: 2, right: 2,
                  width: 16, height: 16, borderRadius: "50%",
                  background: t.accent, color: "#fff",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "0 0 0 2px var(--bg-card, #0e1324)",
                }}>
                  <Check size={10} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
