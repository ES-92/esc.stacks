/* esc//stacks — Service Worker
   App-Shell wird gecacht (offline-fähig). Mediendateien liegen in
   IndexedDB und werden NICHT vom SW gecacht (Größe/Eviction).

   WICHTIG: Network-First für die Shell — online wird IMMER die neueste
   Version geladen, offline kommt sie aus dem Cache. Verhindert, dass eine
   installierte PWA auf einer alten Code-Version „hängenbleibt". */
const CACHE = 'esc-stacks-v3';
const SHELL = [
  './index.html', './shell.js', './core.js', './mod-audio.js', './mod-reader.js',
  './mod-music.js', './mod-radio.js', './mod-playlist.js', './meta.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png', './icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // Network-First: frische Version holen, im Cache aktualisieren; offline -> Cache.
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined)))
  );
});
