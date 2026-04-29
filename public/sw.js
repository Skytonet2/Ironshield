// AZUKA Service Worker — v4-push-only.
//
// Why this shape: v1–v2 ran a full stale-while-revalidate fetch layer
// and ended up holding broken chunk responses across deploys, which
// presented to users as "This page couldn't load" and was unrecoverable
// without a cache bump. v3 (the self-uninstaller) killed the problem
// but also killed web push, which needs an active SW on the page.
//
// v4 threads the needle: we register as a SW so push delivery works,
// but we install NO fetch handler at all — every request goes through
// the browser's normal HTTP cache, same as if no SW existed. That
// takes the whole class of cache-eviction bugs off the table while
// bringing OS-level notifications back.
//
// If we want offline support again later, add it as an opt-in layer
// behind a separate route allowlist — never reintroduce a blanket
// fetch interceptor.
//
// Client registration lives in src/lib/usePWA.js.
const SW_VERSION = "v4-push-only";

// ─── Install: take over immediately, no shell caching ────────────────
self.addEventListener("install", () => {
  self.skipWaiting();
});

// ─── Activate: wipe every leftover cache from older SW versions, then
//     claim controlled clients so push subscriptions become usable
//     without requiring a hard reload. ──────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (_) { /* ignore — we're only wiping as a precaution */ }
    try { await self.clients.claim(); } catch (_) { /* ignore */ }
  })());
});

// ─── Push: render the OS notification, relay call pushes to any open
//     tab so the in-app ringing UI can take over instead of the plain
//     banner (iOS PWA especially benefits since action buttons are
//     swallowed there). ────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = {
    title: "AZUKA",
    body: "You have a new notification",
    tag: "general",
    kind: "general",
  };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }

  const isCall = data.kind === "call";
  const callVibrate = [400, 200, 400, 200, 400, 200, 400, 200, 400];

  const title = isCall
    ? (data.title?.startsWith("📞") ? data.title : `📞 ${data.title || "Incoming call"}`)
    : data.title;
  const body  = isCall ? (data.body || "Tap to answer") : data.body;

  const options = {
    body,
    icon: "/mascot.png",
    badge: "/icon.svg",
    tag: data.tag || "general",
    renotify: true,
    vibrate: isCall ? callVibrate : [100, 50, 100],
    requireInteraction: isCall,
    silent: false,
    data: {
      url: data.url || "/",
      kind: data.kind || "general",
      conversationId: data.conversationId,
    },
    actions: data.actions || [],
  };

  const relay = async () => {
    try {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const hasVisible = clients.some(
        (c) => c.visibilityState === "visible" || c.focused
      );
      for (const c of clients) {
        c.postMessage({ type: "ix-push", kind: data.kind, data });
      }
      // Calls suppress the OS banner when a tab is visible so the
      // in-app ringing overlay is the single source of truth.
      if (isCall && hasVisible) return;
      await self.registration.showNotification(title, options);
    } catch {
      await self.registration.showNotification(title, options);
    }
  };

  event.waitUntil(relay());
});

// ─── Notification click: route based on action + kind ────────────────
self.addEventListener("notificationclick", (event) => {
  const action = event.action || "";
  const nData  = event.notification.data || {};
  event.notification.close();

  if (nData.kind === "call" && action === "decline") {
    // Dismiss-only: a real hangup needs an authed call we can't make
    // from a push click. The LiveKit room just times out.
    return;
  }

  const url = nData.url || "/";
  event.waitUntil(openOrFocus(url));
});

function openOrFocus(url) {
  return self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin) {
          try { client.navigate(url); } catch (_) { /* ignore */ }
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    });
}

// ─── pushsubscriptionchange: the browser rotated our subscription.
//     Re-subscribe silently with the same VAPID key; the client re-
//     syncs the new endpoint to the backend on next page load (see
//     usePWA.js, which re-POSTs the current subscription on every
//     mount). We deliberately don't try to POST from the SW because
//     the /api/push/subscribe endpoint requires a wallet header we
//     don't have here. ────────────────────────────────────────────
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    try {
      const r = await fetch("https://ironclaw-backend.onrender.com/api/push/vapid-key");
      if (!r.ok) return;
      const { publicKey } = await r.json();
      if (!publicKey) return;
      const padding = "=".repeat((4 - (publicKey.length % 4)) % 4);
      const base64  = (publicKey + padding).replace(/-/g, "+").replace(/_/g, "/");
      const raw     = atob(base64);
      const appKey  = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; ++i) appKey[i] = raw.charCodeAt(i);
      await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appKey,
      });
    } catch (_) { /* best effort — client sync runs on next visit */ }
  })());
});
