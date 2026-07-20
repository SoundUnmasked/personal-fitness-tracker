// Personal Fitness Tracker service worker — minimal offline-friendly shell cache.
// Strategy:
//  - Navigation requests: network-first, fall back to cached shell when offline.
//  - Immutable static assets (/_next/static/, /fonts/, /icons/): cache-first.
//  - EVERYTHING else — /api/*, RSC payload fetches (?_rsc=…), manifest — goes
//    straight to the network and is never cached, so personal data is always
//    fresh. (v2: previously all same-origin GETs were cache-first, which served
//    stale server-rendered data on client-side navigations.)
const CACHE = 'pft-shell-v2';
const SHELL = ['/', '/log/strength', '/checkin', '/inbody', '/sync', '/manifest.webmanifest'];
const STATIC_PREFIXES = ['/_next/static/', '/fonts/', '/icons/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API responses (personal data, must be fresh).
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match('/'))),
    );
    return;
  }

  // Cache-first ONLY for immutable static assets. Anything else (notably Next's
  // RSC payload fetches for client-side navigation) is not intercepted at all,
  // so it always hits the network.
  if (!STATIC_PREFIXES.some((p) => url.pathname.startsWith(p))) return;

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
          return res;
        }),
    ),
  );
});
