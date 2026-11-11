/* Route Runner service worker.
 *
 * Strategy (deliberately conservative — this project has been bitten by
 * stale cached builds, so HTML is NEVER served stale):
 *   - Navigations / HTML: NETWORK-FIRST. The freshest index always
 *     wins; the cached shell is only an offline fallback.
 *   - Fingerprinted static assets under /driver/assets/ (content-hashed
 *     by Vite, served with a 1-year server cache header): CACHE-FIRST —
 *     a new deploy emits new filenames, so a cached entry can never be
 *     a stale build.
 *   - Everything else (Firestore, Storage, Functions, any cross-origin
 *     or API request): NOT intercepted. Data is never cached here.
 * The cache name is versioned; bump SW_VERSION on any shell change and
 * old caches are evicted on activate.
 */
const SW_VERSION = 'rr-v1-2026-11-10';
const SHELL_CACHE = `route-runner-shell-${SW_VERSION}`;
const ASSET_CACHE = `route-runner-assets-${SW_VERSION}`;
const SHELL_URLS = [
  '/driver/',
  '/driver/index.html',
  '/driver/manifest.webmanifest',
  '/driver/icons/icon-192.png',
  '/driver/icons/icon-512.png',
  '/driver/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Firebase/CDN: untouched

  // Navigations and HTML: network-first, cache is offline fallback only.
  if (request.mode === 'navigate' || url.pathname === '/driver/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/driver/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/driver/index.html')),
    );
    return;
  }

  // Fingerprinted build assets: cache-first (immutable by filename).
  if (url.pathname.startsWith('/driver/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // App icons / manifest: stale-while-revalidate (tiny, rarely change,
  // and a version bump of SW_VERSION evicts them anyway).
  if (url.pathname.startsWith('/driver/icons/') || url.pathname.endsWith('.webmanifest')) {
    event.respondWith(
      caches.match(request).then((hit) => {
        const network = fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          return response;
        });
        return hit || network;
      }),
    );
  }
  // All other same-origin requests: straight to network, no caching.
});
