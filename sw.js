// Pocket Card — iOS-tuned service worker
// Goals (in priority order):
//   1. Fastest possible perceived load on iOS Safari / installed PWA.
//   2. Works offline after first visit (mantra, storm video, thunder audio).
//   3. Always shows fresh HTML when online; offline falls back instantly.
//   4. Never breaks iOS media seeking (<video>/<audio> byte-range requests).
//
// Strategy:
//   - Navigations (HTML)        → network-first, cache fallback, timeout → cache.
//   - Same-origin static assets → cache-first, revalidate in background.
//   - Cross-origin (fonts, etc) → pass through (rely on browser HTTP cache).
//   - Range requests            → pass through (Cache API can't serve 206 Partial).
//   - Non-GET                   → pass through.

const CACHE_NAME = 'pocket-card-v2-2026-04-22';

// Pre-cached on install. Using relative paths so it works from any GH Pages sub-path.
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png',
  './favicon-32.png',
  './assets/storm-mobile.mp4',
  './assets/rain-thunder.mp3'
];

// Network-first timeout for navigations. Keep short on iOS so offline feels instant.
const NAV_TIMEOUT_MS = 2500;

// ——— Install: robust precache (one bad URL must not kill the install) ———
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Fetch each asset individually; log and skip failures instead of aborting.
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res && (res.ok || res.type === 'opaqueredirect')) {
          await cache.put(url, res.clone());
        }
      } catch (_) { /* best-effort */ }
    }));
    await self.skipWaiting();
  })());
});

// ——— Activate: purge old caches, take control ———
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    );
    // Enable navigation preload where supported (Chromium/Edge). Safari ignores.
    if ('navigationPreload' in self.registration) {
      try { await self.registration.navigationPreload.enable(); } catch (_) {}
    }
    await self.clients.claim();
  })());
});

// ——— Fetch router ———
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET.
  if (req.method !== 'GET') return;

  // iOS Safari uses Range for <video>/<audio> seeking. Cache API cannot serve
  // 206 Partial Content, so bypass entirely and let the browser go to network.
  if (req.headers.has('range')) return;

  const url = new URL(req.url);

  // Cross-origin (Google Fonts, CDNs) — pass through. The browser HTTP cache
  // + long max-age from fonts.gstatic.com is already faster than round-tripping
  // through the service worker, and opaque responses can't be cache-matched safely.
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first with short timeout, falling back to cache.
  // This keeps the HTML shell fresh online and instant offline.
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(handleNavigation(event));
    return;
  }

  // Same-origin assets: cache-first with background revalidation.
  event.respondWith(handleAsset(req));
});

// Network-first for HTML with a short timeout.
async function handleNavigation(event) {
  const cache = await caches.open(CACHE_NAME);

  // Prefer a navigation preload response if available.
  const preload = event.preloadResponse ? await event.preloadResponse.catch(() => null) : null;

  // Race network vs. short timeout.
  const network = (async () => {
    try {
      const res = preload || await fetchWithTimeout(event.request, NAV_TIMEOUT_MS);
      if (res && res.ok) {
        cache.put('./index.html', res.clone()).catch(() => {});
      }
      return res;
    } catch (_) {
      return null;
    }
  })();

  const fresh = await network;
  if (fresh) return fresh;

  // Offline or timed out → serve the cached shell.
  const cached = await cache.match('./index.html') || await cache.match('./');
  if (cached) return cached;

  // Last-ditch: a minimal offline response.
  return new Response('<!doctype html><meta charset=utf-8><title>Offline</title><body style="background:#070a12;color:#f7f0d8;font-family:system-ui;padding:24px"><h1>Offline</h1><p>Reconnect to load Pocket Card.</p>', {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    status: 200
  });
}

// Cache-first for static assets, with quiet background revalidation.
async function handleAsset(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);

  if (cached) {
    // Revalidate in the background; don't block the response.
    fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') {
        cache.put(req, res.clone()).catch(() => {});
      }
    }).catch(() => {});
    return cached;
  }

  // Cache miss → fetch and opportunistically cache.
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === 'basic') {
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch (_) {
    // If it's a navigation-ish request that we missed above, fall back to shell.
    if (req.destination === 'document') {
      const fallback = await cache.match('./index.html');
      if (fallback) return fallback;
    }
    // Nothing we can do.
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      (res) => { clearTimeout(t); resolve(res); },
      (err) => { clearTimeout(t); reject(err); }
    );
  });
}
