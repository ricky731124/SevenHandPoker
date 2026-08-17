// Minimal service worker. Its only job is to make the app installable on
// Android (Chrome requires a registered SW with a fetch handler). It does no
// caching — every request passes straight through to the network — so there is
// no stale-asset risk after deploys.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {
  // Intentionally empty: not calling respondWith lets the browser handle the
  // request normally. The handler's mere presence satisfies installability.
})
