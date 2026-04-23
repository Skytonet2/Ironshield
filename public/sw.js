// IronShield Service Worker — DISABLED (self-uninstall build).
//
// Previous versions (v1/v2/v3) turned out to be the cause of a
// "This page couldn't load" crash for users with a stale SW serving
// broken cached responses after the brand-system deploy. Rather than
// keep iterating on caching strategy while users are stuck, this
// build ships a service worker whose only job is to unregister
// itself and wipe every cache it ever owned.
//
// When a browser with an old IronShield SW next visits, it fetches
// /sw.js (standard SW update-check cadence), sees this new content,
// goes through install→activate, then the activate hook:
//   1. deletes every cache
//   2. unregisters itself
//   3. tells every controlled client to reload once
// After that, the page is served directly by the browser's normal
// HTTP cache with no SW in the middle.
//
// src/lib/usePWA.js also short-circuits its registerSW() call so no
// new clients pick up a SW. We can re-enable offline/push later with
// a cleaner design; right now, stability wins.

self.addEventListener("install", () => {
  // Skip waiting so activate runs on the next tick, not after the
  // old SW has finished handling in-flight fetches.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch (_) { /* ignore */ }
    try {
      await self.registration.unregister();
    } catch (_) { /* ignore */ }
    // Force every tab controlled by this SW to reload without cache.
    try {
      const clients = await self.clients.matchAll({ type: "window" });
      for (const c of clients) {
        try { c.navigate(c.url); } catch (_) { /* ignore */ }
      }
    } catch (_) { /* ignore */ }
  })());
});

// No fetch handler — let every request go straight to the network /
// HTTP cache. No push handler — re-add when SW is re-enabled.
