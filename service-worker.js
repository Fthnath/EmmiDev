/**
 * EmmiDev Weather — Service Worker
 * Offline-first caching for the app shell.
 */

const CACHE_VERSION = 'emmidev-v2.0.4';
const APP_SHELL = [
    './',
    './index.html',
    './manifest.json',
    './weather-icon.svg',
    './favicon/favicon-16x16.png',
    './favicon/favicon-32x32.png',
    './favicon/favicon-96x96.png',
    './favicon/android-icon-144x144.png',
    './favicon/android-icon-192x192.png',
    './favicon/apple-icon-180x180.png',
    './favicon/ms-icon-144x144.png',
    './css/main.css',
    './css/themes.css',
    './css/layout.css',
    './css/components.css',
    './css/animations.css',
    './css/hero.css',
    './css/weather.css',
    './css/pwa.css',
    './js/main.js',
    './js/config.js',
    './js/core/api.js',
    './js/core/storage.js',
    './js/core/state.js',
    './js/core/events.js',
    './js/core/router.js',
    './js/core/config-tests.js',
    './js/modules/weather.js',
    './js/modules/map.js',
    './js/modules/locations.js',
    './js/modules/ai.js',
    './js/ui/i18n.js',
    './js/ui/theme.js',
    './js/ui/toast.js',
    './js/ui/modals.js',
    './js/ui/settings.js',
    './js/ui/animations.js',
    './js/utils/dom.js',
    './js/utils/date.js',
    './js/utils/format.js',
    './lang/en.json'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_VERSION).then(cache => {
            return Promise.allSettled(
                APP_SHELL.map(url => cache.add(url).catch(err =>
                    console.warn('[SW] Failed to cache', url, err.message)
                ))
            );
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);

    // Skip caching for API calls (always network, but handle offline failures cleanly)
    if (url.hostname.includes('open-meteo') ||
        url.hostname.includes('openweathermap') ||
        url.hostname.includes('nominatim') ||
        url.hostname.includes('groq') ||
        url.hostname.includes('rainviewer')) {
        e.respondWith(
            fetch(req).catch(() => new Response(JSON.stringify({ error: 'offline' }), {
                status: 503,
                statusText: 'Offline',
                headers: { 'Content-Type': 'application/json' }
            }))
        );
        return;
    }

    // Cache-first for app assets
    e.respondWith(
        caches.match(req).then(cached => {
            const networkFetch = fetch(req).then(res => {
                if (res.ok && url.origin === location.origin) {
                    const clone = res.clone();
                    caches.open(CACHE_VERSION).then(c => c.put(req, clone));
                }
                return res;
            }).catch(() => cached);
            return cached || networkFetch;
        })
    );
});
