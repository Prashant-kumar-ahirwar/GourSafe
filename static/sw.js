/* ============================================================
   GourSafe — Service Worker
   Strategy:
     • App shell (HTML pages, CSS, JS, icons) → Cache-first,
       falling back to network, then offline page.
     • External CDN assets (Bootstrap CSS/JS) → Stale-while-
       revalidate (serve cached copy instantly, update in bg).
     • API calls (/api/sos) → Network-only (location data must
       be fresh; never serve a cached SOS response).
   ============================================================ */

const CACHE_VERSION = 'goursafe-v12';
const OFFLINE_URL   = '/offline';

/* Map tiles (OpenStreetMap) are cached separately so repeat visits to the
   home map load instantly. Capped so it never grows without limit. */
const TILE_CACHE = 'goursafe-tiles-v1';
const TILE_MAX   = 250;

/* Assets to pre-cache on install — the "app shell" */
const SHELL_ASSETS = [
  '/',
  '/contacts',
  '/security',
  '/report',
  '/offline',
  '/static/css/style.css',
  '/static/js/script.js',
  '/static/js/native-safety.js',
  '/static/manifest.json',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
];

/* CDN origins to cache with stale-while-revalidate */
const CDN_ORIGINS = [
  'cdn.jsdelivr.net',
  'unpkg.com',
];

// ── Install: pre-cache the app shell ──────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache => {
      // addAll fetches and caches everything; one failure aborts install
      return cache.addAll(SHELL_ASSETS);
    })
  );
  // Take control of all pages immediately — don't wait for old SW to die
  self.skipWaiting();
});

// ── Activate: delete old caches ───────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_VERSION && key !== TILE_CACHE)
          .map(key => caches.delete(key))
      )
    )
  );
  // Claim all open clients so the new SW takes effect without a reload
  self.clients.claim();
});

// ── Fetch: route requests through the right strategy ──────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Network-only for SOS API — never serve stale location data
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // 1b. Map tiles: cache-first (they almost never change)
  if (/^[abc]\.tile\.openstreetmap\.org$/.test(url.hostname)) {
    event.respondWith(tileStrategy(request));
    return;
  }

  // 1b2. Operator console: always live from the server, never from the cache
  if (url.origin === self.location.origin && url.pathname.startsWith('/operator')) {
    event.respondWith(fetch(request));
    return;
  }

  // 1c. "My Reports" shows live status set by security: network first, cache only when offline
  if (url.origin === self.location.origin && url.pathname === '/my-reports') {
    event.respondWith(fetch(request).catch(() => caches.match(request).then(r => r || caches.match(OFFLINE_URL))));
    return;
  }

  // 2. Stale-while-revalidate for CDN assets
  if (CDN_ORIGINS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // 3. Cache-first for everything else (app shell pages + static files)
  event.respondWith(cacheFirst(request));
});

// ── Strategy: Cache-first with network fallback ───────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    // Only cache successful same-origin responses
    if (response.ok && new URL(request.url).origin === self.location.origin) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Network failed — return the offline page for navigation requests
    if (request.mode === 'navigate') {
      const offlinePage = await caches.match(OFFLINE_URL);
      if (offlinePage) return offlinePage;
    }
    // For non-navigation requests just let it fail naturally
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

// ── Strategy: Stale-while-revalidate ─────────────────────────
async function staleWhileRevalidate(request) {
  const cache  = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);

  // Kick off a background fetch regardless
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);  // swallow network errors silently

  // Return cached version immediately if we have one
  return cached || fetchPromise;
}

// ── Strategy: map tiles, cache-first with a size cap ─────────
async function tileStrategy(request) {
  const cache  = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  // Only CORS (non-opaque) responses are cached, so storage stays small.
  if (response && response.ok && response.type === 'cors') {
    cache.put(request, response.clone());
    trimTileCache(cache);
  }
  return response;
}

async function trimTileCache(cache) {
  const keys = await cache.keys();
  if (keys.length > TILE_MAX) {
    await Promise.all(keys.slice(0, keys.length - TILE_MAX).map(k => cache.delete(k)));
  }
}
