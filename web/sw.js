/* REMIXT · Service Worker: network-first, cache offline, auto-update. */
const CACHE = 'remixt-shell-v7';
const SHELL = [
  './', './index.html', './login.html', './chofer.html', './pasajero.html',
  './styles.css', './portal.css', './config.js', './app-config.js', './version.js',
  './vendor/leaflet/leaflet.css', './vendor/leaflet/leaflet.js',
  './vendor/leaflet/images/marker-icon.png', './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png', './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png',
  './auth.js', './app.js', './login.js', './chofer.js', './pasajero.js',
  './portal.js', './pwa.js', './geo.js',
  './manifest.webmanifest', './manifest-chofer.webmanifest',
  './apple-touch-icon.png', './icon-192.png', './icon-512.png',
];

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // La API y el WebSocket van siempre a la red, nunca se cachean.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/ws')) return;

  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('./index.html'))),
  );
});
