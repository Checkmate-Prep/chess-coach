// Offline support: app shell cache-first, prep.json network-first, chess.com always live.
const CACHE = 'chess-prep-dab331d5e7';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'board.js', 'pieces.js', 'store.js', 'chesscom.js', 'stats.js', 'engine.js', 'analysis.js',
  'vendor/chess.js', 'vendor/stockfish/stockfish-19-lite-single.js', 'vendor/stockfish/stockfish-19-lite-single.wasm', 'prep.json',
  'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname === 'api.chess.com') return;
  if (url.origin === location.origin && url.pathname.endsWith('prep.json')) {
    e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
    if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  })));
});
