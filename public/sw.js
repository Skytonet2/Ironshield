// IronShield Service Worker — PWA offline shell + push notifications
const CACHE_NAME = "ironshield-v1";
const SHELL_URLS = ["/", "/icon.svg", "/mascot.png"];

// ─── Install: cache the app shell ──────────────────────────────────
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(SHELL_URLS))
  );
  self.skipWaiting();
});

// ─── Activate: clean old caches ────────────────────────────────────
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ─── Fetch: network-first for API, cache-first for static ─────────
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Never cache API or LiveKit calls
  if (url.pathname.startsWith("/api/") || url.hostname.includes("livekit")) return;

  // For navigation requests (HTML pages), serve cache fallback for offline
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).catch(() => caches.match("/"))
    );
    return;
  }

  // Static assets: stale-while-revalidate
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetched = fetch(e.request).then((resp) => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => cached);
      return cached || fetched;
    })
  );
});

// ─── Push notifications ────────────────────────────────────────────
self.addEventListener("push", (e) => {
  let data = { title: "IronShield", body: "You have a new notification", tag: "general", kind: "general" };
  try {
    if (e.data) data = { ...data, ...e.data.json() };
  } catch {
    if (e.data) data.body = e.data.text();
  }

  const isCall = data.kind === "call";

  // Calls: long vibrate pattern (browsers cap this, but it's the closest we
  // get to a ring without a native wrapper), require interaction so the
  // banner stays up until Answer/Decline is tapped, and attach action buttons.
  const callVibrate = [400, 200, 400, 200, 400, 200, 400, 200, 400];

  // Force a phone-call look on both Android and iOS. iOS PWA ignores action
  // buttons, so the title/body have to carry the meaning on their own.
  const title = isCall ? (data.title?.startsWith("📞") ? data.title : `📞 ${data.title || "Incoming call"}`) : data.title;
  const body  = isCall ? (data.body  || "Tap to answer") : data.body;

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

  // If any app window is focused/visible, let it handle the ring in-app
  // (full-screen overlay + looping ringtone) instead of relying on the
  // OS notification, which on many mobile browsers reads as a plain DM.
  const relayToForeground = async () => {
    try {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const hasVisible = clients.some((c) => c.visibilityState === "visible" || c.focused);
      for (const c of clients) {
        c.postMessage({ type: "ix-push", kind: data.kind, data });
      }
      // Still show the notification when no window is visible; when one is
      // visible we skip the OS banner so the in-app ringing UI is the single
      // source of truth.
      if (isCall && hasVisible) return;
      await self.registration.showNotification(title, options);
    } catch {
      await self.registration.showNotification(title, options);
    }
  };

  e.waitUntil(relayToForeground());
});

// ─── Notification click: route based on action + kind ──────────────
self.addEventListener("notificationclick", (e) => {
  const action = e.action || "";
  const nData = e.notification.data || {};
  e.notification.close();

  // Call actions
  if (nData.kind === "call") {
    if (action === "decline") {
      // Soft-decline: just dismiss. (A server-side hangup would need an
      // authenticated call, which we can't do from a push click without
      // relay infra — acceptable since the LiveKit room just times out.)
      return;
    }
    // answer or tap-through: open the call overlay deep link
    const url = nData.url || "/";
    e.waitUntil(openOrFocus(url));
    return;
  }

  const url = nData.url || "/";
  e.waitUntil(openOrFocus(url));
});

function openOrFocus(url) {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if (new URL(client.url).origin === self.location.origin) {
        client.navigate(url);
        return client.focus();
      }
    }
    return self.clients.openWindow(url);
  });
}
