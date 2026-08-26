const CACHE_NAME = 'roloff-lanches-v7';
const STATIC_ASSETS = [
    './',
    './index.html',
    './index.css',
    './app.js',
    './garcom.html',
    './garcom/',
    './garcom/index.html',
    './garcom/garcom.css',
    './garcom/garcom.js',
    './painel.html',
    './painel/',
    './painel/index.html',
    './painel/painel.css',
    './painel/painel.js',
    './firebase-config.js',
    './TrackingService.js',
    './manifest.json',
    './assets/logo.png',
    './assets/hero_banner.jpg',
    './assets/lanches_hero.jpg',
    './assets/porcoes_hero.jpg',
    './assets/torre_de_batata.jpg',
    './assets/picadao.jpg',
    './assets/pastel.jpg',
    './assets/hotdog.jpg',
    './assets/hotdog_calabresa.jpg',
    './assets/xis.jpg',
    './assets/torrada.jpg'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch((err) => {
                console.warn('Cache addAll warning:', err);
            });
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    if (event.request.url.includes('firebaseio.com') || event.request.url.includes('googleapis.com')) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            })
            .catch(() => {
                return caches.match(event.request);
            })
    );
});
