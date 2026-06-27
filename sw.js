const CACHE_NAME = 'missavj-cache-v2.6.14';
const API_CACHE_NAME = 'missavj-api-cache';
const MAX_API_CACHE_ITEMS = 50;
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/assets/css/components.css?v=2.6.2',
  '/assets/css/main.css?v=2.6.2',
  '/assets/css/base.css?v=2.6.2',
  '/assets/css/layout.css?v=2.6.2',
  '/assets/css/player.css?v=2.6.2',
  '/assets/js/app.js?v=2.6.2',
  '/assets/js/api.js?v=2.6.2',
  '/assets/js/feed.js?v=2.6.2',
  '/assets/js/i18n.js?v=2.6.2',
  '/assets/js/player.js?v=2.6.2',
  '/assets/js/ui.js?v=2.6.2',
  '/assets/js/ads.js?v=2.6.2',
  '/assets/js/analytics.js?v=2.6.2',
  '/assets/js/referral.js?v=2.6.2',
  '/assets/images/logo.png',
  '/favicon.svg'
];

// Install Event: Cache Core Assets
self.addEventListener('install', (event) => {
  self.skipWaiting(); // Force the waiting service worker to become the active service worker.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
});

// Activate Event: Cleanup Old Caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

/**
 * Helper to enforce cache limits (LRU approximation)
 */
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    // Delete the oldest entries (keys[0] is generally the oldest inserted)
    for (let i = 0; i < keys.length - maxItems; i++) {
      await cache.delete(keys[i]);
    }
  }
}

// Fetch Event: Stale-While-Revalidate strategy for API, Cache First for assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignore non-GET requests or browser extension requests
  if (event.request.method !== 'GET' || url.protocol.startsWith('chrome-extension')) {
    return;
  }

  // API Requests: Stale-While-Revalidate (Instant perceived perf + background update)
  if (url.origin === 'https://server.apijav.com' || (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/image'))) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(API_CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone)
                .then(() => trimCache(API_CACHE_NAME, MAX_API_CACHE_ITEMS));
            });
          }
          return networkResponse;
        }).catch((err) => {
          console.warn('Network fetch failed for API, relying on cache', err);
          // Return the cached response if available, else throw
          if (cachedResponse) {
             const fallbackHeaders = new Headers(cachedResponse.headers);
             fallbackHeaders.append('X-Offline-Fallback', 'true');
             // We cannot directly read cachedResponse.body as it might be consumed?
             // Actually, we must clone it or just reconstruct it. But creating a new response with the blob is safer.
             return cachedResponse.blob().then(blob => {
                 return new Response(blob, {
                     status: cachedResponse.status,
                     statusText: cachedResponse.statusText,
                     headers: fallbackHeaders
                 });
             });
          }
          throw err;
        });
        
        // Return cached immediately if present, OTHERWISE wait for the network fetch
        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // Static Assets & App Shell: Cache First, fallback to Network
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((response) => {
        // Cache dynamically fetched core assets (do NOT cache third-party images here to prevent bloat)
        if (response && response.status === 200 && response.type === 'basic' && url.origin === location.origin) {
          const clonedResponse = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clonedResponse);
          });
        }
        return response;
      });
    }).catch(() => {
      // Offline fallback: Serve index.html for navigation requests
      if (event.request.mode === 'navigate') {
        return caches.match('/index.html');
      }
    })
  );
});
