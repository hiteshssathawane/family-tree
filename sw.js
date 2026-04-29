// The Family Tree - Service Worker
const CACHE_NAME = 'family-tree-v1';
const STATIC_CACHE = [
  '/',
  '/index.html',
  '/data/family.json',
  '/data/auth.json', 
  '/data/config.json',
  '/data/i18n/en.json',
  '/data/i18n/mr.json',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_CACHE))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
