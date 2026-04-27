"use client";
// OnboardingModal — first-time user setup flow.
//
// Triggered by the AppShell when GET /api/profile/me returns
// onboardedAt == null for the connected wallet. Required fields:
// username + display name. Optional: profile picture + banner —
// both can be skipped. POST /api/profile/onboard atomically saves
// everything and stamps onboarded_at = NOW() so the modal won't
// fire again on next page load.
//
// Image uploads use the existing /api/profile/upload signed-upload
// flow (Cloudinary). When that endpoint returns 503 (Cloudinary not
// configured on this deploy), the picker buttons render disabled
// with a hint — the rest of the form still works.

import { useState, useCallback, useRef } from "react";
import { Camera, ImageIcon, Loader2, Check, X as XIcon } from "lucide-react";
import { useTheme } from "@/lib/contexts";
import { apiFetch } from "@/lib/apiFetch";
import { API_BASE as API } from "@/lib/apiBase";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;

export default function OnboardingModal({ initial, onComplete, onClose }) {
  const t = useTheme();
  const [username, setUsername]       = useState(initial?.username || "");
  const [displayName, setDisplayName] = useState(initial?.displayName || initial?.username || "");
  const [pfpUrl, setPfpUrl]           = useState(initial?.pfpUrl || "");
  const [bannerUrl, setBannerUrl]     = useState(initial?.bannerUrl || "");
  const [pfpUploading, setPfpUploading]       = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  const [imageSupported, setImageSupported] = useState(true); // flips false if Cloudinary 503s
  const pfpInputRef = useRef(null);
  const bannerInputRef = useRef(null);

  const usernameValid = USERNAME_RE.test(username);
  const displayValid  = displayName.trim().length >= 1 && displayName.trim().length <= 40;
  const canSubmit = usernameValid && displayValid && !submitting && !pfpUploading && !bannerUploading;

  const uploadImage = useCallback(async (file, kind) => {
    if (!file) return null;
    if (file.size > 5 * 1024 * 1024) {
      throw new Error("Image must be under 5 MB");
    }
    if (!file.type.startsWith("image/")) {
      throw new Error("Please pick an image file");
    }
    const sigRes = await apiFetch(`/api/profile/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (sigRes.status === 503) {
      setImageSupported(false);
      throw new Error("Image hosting isn't configured on this deploy — you can skip and add later");
    }
    if (!sigRes.ok) throw new Error(`upload-prep failed (${sigRes.status})`);
    const { cloudName, apiKey, timestamp, folder, signature, uploadUrl } = await sigRes.json();
    const fd = new FormData();
    fd.append("file", file);
    fd.append("api_key", apiKey);
    fd.append("timestamp", timestamp);
    fd.append("folder", folder);
    fd.append("signature", signature);
    const cloudRes = await fetch(uploadUrl, { method: "POST", body: fd });
    if (!cloudRes.ok) throw new Error("upload failed");
    const cloudJson = await cloudRes.json();
    return cloudJson.secure_url || cloudJson.url || null;
  }, []);

  const handlePickPfp = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setPfpUploading(true); setErr("");
    try {
      const url = await uploadImage(file, "pfp");
      if (url) setPfpUrl(url);
    } catch (e) {
      setErr(e.message || "PFP upload failed");
    } finally {
      setPfpUploading(false);
      if (pfpInputRef.current) pfpInputRef.current.value = "";
    }
  };

  const handlePickBanner = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setBannerUploading(true); setErr("");
    try {
      const url = await uploadImage(file, "banner");
      if (url) setBannerUrl(url);
    } catch (e) {
      setErr(e.message || "Banner upload failed");
    } finally {
      setBannerUploading(false);
      if (bannerInputRef.current) bannerInputRef.current.value = "";
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true); setErr("");
    const body = {
      username: username.trim(),
      displayName: displayName.trim(),
      pfpUrl: pfpUrl || null,
      bannerUrl: bannerUrl || null,
    };
    console.log("[onboarding] submit attempt", { path: "/api/profile/onboard", body });
    let r;
    try {
      r = await apiFetch(`/api/profile/onboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      // Distinguish transport-level errors so the user sees something
      // actionable instead of the generic "Failed to fetch". Common
      // shapes: CORS preflight rejection, wallet popup dismissed,
      // signMessage throwing, network drop.
      const msg = String(e?.message || e || "");
      console.error("[onboarding] submit threw before HTTP", e);
      if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
        setErr("Couldn't reach the backend. Hard-refresh the page (Ctrl+Shift+R) and try again. If that fails, your browser may be blocking the request — check the console (F12).");
      } else if (/sign|reject|cancel|denied/i.test(msg)) {
        setErr("Wallet signing was cancelled. Try again and confirm the popup.");
      } else {
        setErr(msg || "Failed to save");
      }
      setSubmitting(false);
      return;
    }
    let j = {};
    try { j = await r.json(); } catch { /* empty body */ }
    console.log("[onboarding] response", { status: r.status, body: j });
    if (r.status === 409) { setErr("That username is taken — try another."); setSubmitting(false); return; }
    if (!r.ok) { setErr(j.error || `Failed (${r.status})`); setSubmitting(false); return; }
    onComplete?.(j.user);
    setSubmitting(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      style={{
        position: "fixed", inset: 0, zIndex: 220,
        background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div style={{
        width: "100%", maxWidth: 480,
        background: "var(--bg-card)", border: `1px solid ${t.border}`,
        borderRadius: 16, overflow: "hidden",
        boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
      }}>
        {/* Banner preview band — doubles as the banner-set hint */}
        <div style={{
          height: 96, position: "relative",
          background: bannerUrl
            ? `url("${bannerUrl}") center/cover no-repeat`
            : "linear-gradient(135deg, rgba(168,85,247,0.18), rgba(59,130,246,0.14))",
          borderBottom: `1px solid ${t.border}`,
        }}>
          <button
            type="button"
            onClick={() => bannerInputRef.current?.click()}
            disabled={bannerUploading || !imageSupported}
            title={imageSupported ? "Set banner image" : "Image hosting not configured"}
            style={{
              position: "absolute", right: 10, top: 10,
              padding: "6px 10px", borderRadius: 8,
              background: "rgba(0,0,0,0.55)", color: "#fff", border: "none",
              fontSize: 11, fontWeight: 700, cursor: imageSupported ? "pointer" : "not-allowed",
              display: "inline-flex", alignItems: "center", gap: 6,
              opacity: imageSupported ? 1 : 0.6,
            }}
          >
            {bannerUploading ? <><Loader2 size={11} className="spin" /> Uploading…</>
              : <><ImageIcon size={11} /> {bannerUrl ? "Change banner" : "Add banner"}</>}
          </button>
          <input ref={bannerInputRef} type="file" accept="image/*" hidden onChange={handlePickBanner} />

          {/* PFP avatar overlap */}
          <div style={{
            position: "absolute", left: 18, bottom: -28,
            width: 64, height: 64, borderRadius: "50%",
            background: pfpUrl
              ? `url("${pfpUrl}") center/cover no-repeat`
              : `linear-gradient(135deg, ${t.accent}, #a855f7)`,
            border: `3px solid var(--bg-card)`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 22, fontWeight: 800,
          }}>
            {!pfpUrl && (username?.[0]?.toUpperCase() || "?")}
            <button
              type="button"
              onClick={() => pfpInputRef.current?.click()}
              disabled={pfpUploading || !imageSupported}
              title={imageSupported ? "Set profile picture" : "Image hosting not configured"}
              style={{
                position: "absolute", right: -4, bottom: -4,
                width: 24, height: 24, borderRadius: "50%",
                background: t.accent, color: "#fff", border: `2px solid var(--bg-card)`,
                cursor: imageSupported ? "pointer" : "not-allowed",
                display: "flex", alignItems: "center", justifyContent: "center",
                opacity: imageSupported ? 1 : 0.6,
              }}
            >
              {pfpUploading ? <Loader2 size={11} className="spin" /> : <Camera size={11} />}
            </button>
            <input ref={pfpInputRef} type="file" accept="image/*" hidden onChange={handlePickPfp} />
          </div>
        </div>

        <div style={{ padding: "40px 18px 18px" }}>
          <h2 id="onboarding-title" style={{
            margin: 0, fontSize: 18, fontWeight: 800, color: t.text, letterSpacing: -0.2,
          }}>
            Welcome to IronShield
          </h2>
          <p style={{ margin: "4px 0 14px", fontSize: 12, color: t.textDim, lineHeight: 1.5 }}>
            Pick a username and display name. Pictures are optional — you can add or change them anytime in settings.
          </p>

          <Field
            t={t}
            label="Username"
            hint="3–24 chars, letters/digits/underscore"
            value={username}
            onChange={setUsername}
            placeholder="e.g. alice42"
            valid={!username || usernameValid}
            invalidText={username && !usernameValid ? "Letters, digits, or underscore only (3–24 chars)." : null}
            mono
          />
          <Field
            t={t}
            label="Display name"
            hint="Up to 40 characters"
            value={displayName}
            onChange={setDisplayName}
            placeholder="e.g. Alice the Builder"
            valid={!displayName || displayValid}
          />

          {!imageSupported && (
            <div style={{
              padding: "8px 10px", borderRadius: 8, marginTop: 4,
              background: "rgba(234,179,8,0.08)", border: `1px solid #eab308`,
              color: "#eab308", fontSize: 11, lineHeight: 1.4,
            }}>
              Image hosting isn't configured on this deploy. You can still finish onboarding — add a picture later in settings.
            </div>
          )}

          {err && (
            <div style={{
              padding: "8px 10px", borderRadius: 8, marginTop: 8,
              background: "rgba(239,68,68,0.08)", border: `1px solid var(--red)`,
              color: "var(--red)", fontSize: 11, lineHeight: 1.4,
            }}>
              {err}
            </div>
          )}

          <div style={{
            display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14,
          }}>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: "9px 14px", borderRadius: 8,
                  background: "transparent", color: t.textMuted,
                  border: `1px solid ${t.border}`, fontSize: 12, fontWeight: 700, cursor: "pointer",
                }}
              >
                Later
              </button>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              style={{
                padding: "9px 16px", borderRadius: 8,
                background: canSubmit
                  ? `linear-gradient(135deg, ${t.accent}, #a855f7)`
                  : t.bgSurface,
                color: canSubmit ? "#fff" : t.textDim,
                border: "none", fontSize: 12, fontWeight: 800, letterSpacing: 0.3,
                cursor: canSubmit ? "pointer" : "not-allowed",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}
            >
              {submitting ? <><Loader2 size={13} className="spin" /> Saving…</> : <><Check size={13} /> Continue</>}
            </button>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}.spin{animation:spin 1s linear infinite}`}</style>
    </div>
  );
}

function Field({ t, label, hint, value, onChange, placeholder, valid = true, invalidText, mono }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        marginBottom: 4,
      }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: t.textMuted, letterSpacing: 0.4, textTransform: "uppercase" }}>
          {label}
        </label>
        {hint && <span style={{ fontSize: 10, color: t.textDim }}>{hint}</span>}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%", padding: "10px 12px", borderRadius: 8,
          border: `1px solid ${valid ? t.border : "var(--red)"}`,
          background: "var(--bg-input)", color: t.text,
          fontSize: 13, fontFamily: mono ? "var(--font-jetbrains-mono), monospace" : "inherit",
          outline: "none",
        }}
      />
      {invalidText && (
        <div style={{ fontSize: 10, color: "var(--red)", marginTop: 4 }}>{invalidText}</div>
      )}
    </div>
  );
}
