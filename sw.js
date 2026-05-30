// The Family Tree - Enhanced Service Worker (Phase 8)
const CACHE_NAME = 'family-tree-v8';
const STATIC_CACHE = [
  './',
  'index.html',
  'manifest.json',
  'vendor/d3.min.js',
  'vendor/flexsearch.bundle.js',
  'vendor/leaflet.js',
  'vendor/leaflet.css',
  'vendor/fonts.css',
  'vendor/fonts/playfair-display-400.woff2',
  'vendor/fonts/playfair-display-700.woff2',
  'vendor/fonts/lato-400.woff2',
  'vendor/fonts/lato-700.woff2'
];

// Install event - cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_CACHE))
  );
  self.skipWaiting();
});

// Activate event - cleanup old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (!cacheName.startsWith('family-tree-v8')) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - cache-first for static, network-first for data
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  const isIndexHtml = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  const isVendorFile = url.pathname.includes('/vendor/') || url.pathname.includes('/icons/');

  // Network-first for index.html (always get fresh)
  if (isIndexHtml) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for static assets (vendor, fonts, etc.)
  if (isVendorFile || url.pathname.endsWith('.css') || url.pathname.endsWith('.js')) {
    event.respondWith(
      caches.match(event.request)
        .then(response => {
          if (response) return response;
          return fetch(event.request).then(response => {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
            return response;
          });
        })
    );
    return;
  }

  // Network-first for everything else
  event.respondWith(
    fetch(event.request)
      .catch(() => caches.match(event.request))
  );
});
