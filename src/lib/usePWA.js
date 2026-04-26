"use client";
// PWA install prompt + push notification subscription hook.
//
// Registers the service worker, intercepts beforeinstallprompt for the
// "Add to Home Screen" banner, and manages Web Push subscriptions.

import { useCallback, useEffect, useRef, useState } from "react";

import { API_BASE as API } from "@/lib/apiBase";
import { apiFetch } from "@/lib/apiFetch";

// ─── Service Worker registration ──────────────────────────────────
// We register /sw.js purely so web push works — the v4 worker
// installs NO fetch handler, so we avoid the stale-cache crash that
// took v1/v2 down while still getting OS-level notifications back.
// See public/sw.js for the full rationale.
let swRegistration = null;

async function registerSW() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  if (swRegistration) return swRegistration;
  try {
    swRegistration = await navigator.serviceWorker.register("/sw.js");
    return swRegistration;
  } catch (e) {
    console.warn("[PWA] SW register failed:", e.message);
    return null;
  }
}

// ─── Push subscription ─────────────────────────────────────────────
async function subscribePush(wallet) {
  if (!swRegistration || !("PushManager" in window)) return null;
  try {
    // Get VAPID key from backend
    const r = await fetch(`${API}/api/push/vapid-key`);
    if (!r.ok) return null;
    const { publicKey } = await r.json();
    if (!publicKey) return null;

    // Convert base64 VAPID key to Uint8Array
    const padding = "=".repeat((4 - (publicKey.length % 4)) % 4);
    const base64 = (publicKey + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    const applicationServerKey = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) applicationServerKey[i] = rawData.charCodeAt(i);

    const sub = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });

    // Send to backend
    await apiFetch(`/api/push/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });

    return sub;
  } catch (e) {
    console.warn("[PWA] Push subscribe failed:", e.message);
    return null;
  }
}

async function unsubscribePush(wallet) {
  if (!swRegistration) return;
  try {
    const sub = await swRegistration.pushManager.getSubscription();
    if (sub) {
      await apiFetch(`/api/push/unsubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
  } catch (e) {
    console.warn("[PWA] Push unsubscribe failed:", e.message);
  }
}

// ─── Hook ──────────────────────────────────────────────────────────
export function usePWA(wallet) {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled]     = useState(false);
  const [pushEnabled, setPushEnabled]     = useState(false);
  const [pushDenied, setPushDenied]       = useState(false);
  const prompted = useRef(false);

  // Register SW on mount. When a wallet is also connected, re-POST
  // the current subscription so the backend has the latest endpoint —
  // browsers can rotate endpoints silently (pushsubscriptionchange is
  // best-effort and unreliable on iOS), and without this re-sync the
  // server keeps pushing to a dead row until it 410s out.
  useEffect(() => {
    let cancelled = false;
    registerSW().then(async (reg) => {
      if (!reg || cancelled) return;
      try {
        const sub = await reg.pushManager?.getSubscription();
        if (cancelled) return;
        setPushEnabled(!!sub);
        if (sub && wallet) {
          await apiFetch(`/api/push/subscribe`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subscription: sub.toJSON() }),
          }).catch(() => { /* best-effort re-sync */ });
        }
      } catch (_) { /* ignore */ }
    });
    return () => { cancelled = true; };
  }, [wallet]);

  // Intercept install prompt
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Check if already installed
    if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) {
      setIsInstalled(true);
    }

    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };

    const installed = () => setIsInstalled(true);

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  // Auto-subscribe push when wallet connects
  useEffect(() => {
    if (!wallet || pushEnabled || prompted.current) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "denied") { setPushDenied(true); return; }
    // Don't auto-prompt — wait for user to click enable
  }, [wallet, pushEnabled]);

  const promptInstall = useCallback(async () => {
    if (!installPrompt) return false;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    setInstallPrompt(null);
    return outcome === "accepted";
  }, [installPrompt]);

  const enablePush = useCallback(async () => {
    if (!wallet) {
      return { ok: false, reason: "wallet_required", message: "Connect your wallet first." };
    }
    // iOS Safari only exposes Notification / PushManager when the site is
    // installed to Home Screen. In a regular Safari tab the API is missing
    // entirely, so tell the user to install the PWA instead of silently
    // failing.
    const isIOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isStandalone = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator?.standalone);
    if (typeof Notification === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      if (isIOS && !isStandalone) {
        return { ok: false, reason: "ios_needs_install", message: "On iOS, tap Share → Add to Home Screen, then open IronShield from the home-screen icon to enable notifications." };
      }
      return { ok: false, reason: "unsupported", message: "This browser doesn't support web push notifications." };
    }

    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      setPushDenied(perm === "denied");
      return { ok: false, reason: perm, message: perm === "denied" ? "Notifications were blocked. Re-enable them in your browser/site settings." : "Notification permission wasn't granted." };
    }

    prompted.current = true;
    const sub = await subscribePush(wallet);
    const ok = !!sub;
    setPushEnabled(ok);
    return ok ? { ok: true } : { ok: false, reason: "subscribe_failed", message: "Push subscribe failed. Make sure the backend is reachable and VAPID keys are set." };
  }, [wallet]);

  const disablePush = useCallback(async () => {
    await unsubscribePush(wallet);
    setPushEnabled(false);
  }, [wallet]);

  return {
    // Install
    canInstall: !!installPrompt && !isInstalled,
    isInstalled,
    promptInstall,

    // Push
    pushEnabled,
    pushDenied,
    enablePush,
    disablePush,

    // iOS helper
    isIOS: typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent),
  };
}
