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
  let data = { title: "IronShield", body: "You have a new notification", tag: "general" };
  try {
    if (e.data) data = { ...data, ...e.data.json() };
  } catch {
    if (e.data) data.body = e.data.text();
  }

  const options = {
    body: data.body,
    icon: "/mascot.png",
    badge: "/icon.svg",
    tag: data.tag || "general",
    renotify: true,
    vibrate: [100, 50, 100],
    data: {
      url: data.url || "/",
    },
    actions: data.actions || [],
  };

  e.waitUntil(self.registration.showNotification(data.title, options));
});

// ─── Notification click: open / focus the app ──────────────────────
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "/";

  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Focus existing tab if one is open
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Otherwise open a new window
      return self.clients.openWindow(url);
    })
  );
});
