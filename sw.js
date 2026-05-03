// The Family Tree - Enhanced Service Worker (Phase 7)
const CACHE_NAME = 'family-tree-v7';
const STATIC_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/vendor/d3.min.js',
  '/vendor/flexsearch.bundle.js',
  '/vendor/leaflet.js',
  '/vendor/leaflet.css',
  '/vendor/fonts.css',
  '/vendor/otpauth.min.js',
  '/vendor/fonts/playfair-display-400.woff2',
  '/vendor/fonts/playfair-display-700.woff2',
  '/vendor/fonts/lato-400.woff2',
  '/vendor/fonts/lato-700.woff2'
];

const DATA_CACHE = [
  '/data/family.json',
  '/data/auth.json',
  '/data/config.json',
  '/data/i18n/en.json',
  '/data/i18n/mr.json'
];

// Install event - cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_CACHE)),
      caches.open(CACHE_NAME + '-data').then(cache => cache.addAll(DATA_CACHE))
    ])
  );
  self.skipWaiting();
});

// Activate event - cleanup old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (!cacheName.startsWith('family-tree-v7')) {
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

  // Network-first for data files and index.html (always get fresh)
  if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.startsWith('/data/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const responseClone = response.clone();
          const cacheName = url.pathname.startsWith('/data/') ? CACHE_NAME + '-data' : CACHE_NAME;
          caches.open(cacheName).then(cache => cache.put(event.request, responseClone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for static assets (vendor, fonts, etc.)
  if (url.pathname.startsWith('/vendor/') || url.pathname.startsWith('/icons/') ||
      url.pathname.endsWith('.css') || url.pathname.endsWith('.js')) {
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
