// Crucible3D service worker — app-shell caching for offline use.
// Strategy: cache-first for our own files (fast, works offline),
// network-first fallback for anything else (e.g. the Three.js CDN,
// which is cached opportunistically after first successful load).
const CACHE = 'crucible3d-v11-app';
const SHELL = [
  './',
  './index.html',
  './guide.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/main.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  // Pre-cache the shell we can enumerate. ES module sub-imports and the
  // CDN are cached on first fetch (below), so they work offline after
  // the first successful online run.
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        // opportunistically cache same-origin files and the CDN
        const url = new URL(req.url);
        const cacheable = res.ok && (url.origin === location.origin ||
          url.hostname.endsWith('cloudflare.com'));
        if (cacheable){
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);   // offline and uncached → undefined (browser shows its default)
    })
  );
});
