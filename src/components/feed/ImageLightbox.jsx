"use client";
// ImageLightbox — full-screen overlay for viewing a post image at
// natural size with a Save action.
//
// Interaction contract:
//   - Click outside the image (on the dim backdrop) closes
//   - Esc key closes (window-level listener, removed on unmount)
//   - X button in the corner closes
//   - "Save" button downloads the image. Tries fetch+blob first
//     (works cross-origin when the bucket sends the right CORS
//     headers); falls back to a direct anchor with `download`
//     attribute (the browser may open in a new tab if CORS blocks
//     download).
//
// Why these picks: the existing FeedCard click handler already
// excludes clicks on <button> and <a>, so the buttons here won't
// accidentally trigger the post-detail navigation.

import { useEffect, useState } from "react";
import { X, Download } from "lucide-react";

function inferFilename(src) {
  try {
    const u = new URL(src, typeof window !== "undefined" ? window.location.href : "https://x");
    const last = u.pathname.split("/").filter(Boolean).pop();
    return last && last.includes(".") ? last : "image";
  } catch {
    return "image";
  }
}

export default function ImageLightbox({ src, alt = "", onClose }) {
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    if (!src) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    // Lock body scroll while the lightbox is open
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [src, onClose]);

  if (!src) return null;

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setSavedMsg("");
    const filename = inferFilename(src);
    try {
      const r = await fetch(src, { mode: "cors" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Small delay so the browser actually flushes the download
      // before the URL is revoked. Otherwise some browsers cancel.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSavedMsg("Saved");
    } catch {
      // Fallback: open the raw URL in a new tab. Browsers' default
      // behavior on download attr varies cross-origin; this at least
      // gets the user to a page where they can right-click → save.
      const a = document.createElement("a");
      a.href = src;
      a.download = filename;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setSavedMsg("Opened in new tab");
    } finally {
      setSaving(false);
      setTimeout(() => setSavedMsg(""), 2000);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "rgba(0,0,0,0.88)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        cursor: "zoom-out",
      }}
    >
      {/* Toolbar */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          top: 14,
          right: 14,
          display: "flex",
          alignItems: "center",
          gap: 8,
          zIndex: 1,
        }}
      >
        {savedMsg && (
          <span style={{
            fontSize: 12,
            color: "#e5ebf7",
            background: "rgba(15,18,28,0.85)",
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.18)",
          }}>{savedMsg}</span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          aria-label="Save image"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 12px",
            fontSize: 12.5,
            fontWeight: 600,
            color: "#e5ebf7",
            background: "rgba(15,18,28,0.85)",
            border: "1px solid rgba(255,255,255,0.22)",
            borderRadius: 8,
            cursor: saving ? "wait" : "pointer",
            opacity: saving ? 0.6 : 1,
          }}
        >
          <Download size={14} />
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            width: 36,
            height: 36,
            borderRadius: 999,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#e5ebf7",
            background: "rgba(15,18,28,0.85)",
            border: "1px solid rgba(255,255,255,0.22)",
            cursor: "pointer",
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* The image. stopPropagation so clicks on the image itself
          don't dismiss — only the dim backdrop closes. */}
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          borderRadius: 8,
          cursor: "default",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
        }}
      />
    </div>
  );
}
