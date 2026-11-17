/* REMIXT · Service Worker mínimo: app shell offline, API siempre en red. */
const CACHE = 'remixt-shell-v2';
const SHELL = [
  './', './index.html', './login.html', './chofer.html', './pasajero.html',
  './styles.css', './portal.css', './config.js',
  './auth.js', './app.js', './login.js', './chofer.js', './portal.js',
  './manifest.webmanifest', './apple-touch-icon.png', './icon-192.png', './icon-512.png',
];

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
  // La API y el WebSocket nunca se cachean: van siempre a la red.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/ws')) return;

  event.respondWith(
    fetch(event.request)
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
