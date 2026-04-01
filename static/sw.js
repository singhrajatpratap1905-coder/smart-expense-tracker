const CACHE_NAME = 'fintrack-v1';
const OFFLINE_URL = '/static/offline.html';

// Install event
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.add(OFFLINE_URL);
        })
    );
    self.skipWaiting();
});

// Activate event
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => clients.claim())
    );
});

// Fetch event (Required to pass PWA installation criteria)
self.addEventListener('fetch', event => {
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).catch(() => {
                return caches.match(OFFLINE_URL);
            })
        );
    }
});