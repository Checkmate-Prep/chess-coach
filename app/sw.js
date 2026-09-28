// Offline support: app shell cache-first, prep.json network-first, chess.com, /api/ and sign-in always live.
const CACHE = 'chess-prep-4171a9b3ee';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'board.js', 'pieces.js', 'store.js', 'chesscom.js', 'stats.js', 'engine.js', 'analysis.js', 'plan.js', 'sync.js', 'syncdoc.js', 'track.js',
  'vendor/chess.js', 'vendor/auth0/auth0-spa-js.production.esm.js', 'vendor/stockfish/stockfish-19-lite-single.js', 'vendor/stockfish/stockfish-19-lite-single.wasm', 'prep.json',
  'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

// On localhost (development) step aside: clear this app's caches and unregister, so edits show up on reload.
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname);
if (LOCAL) {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (e) => {
    e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('chess-prep-')).map((k) => caches.delete(k))))
      .then(() => self.registration.unregister()));
  });
}

self.addEventListener('install', (e) => {
  if (LOCAL) return;
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  if (LOCAL) return;
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (LOCAL) return;
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.hostname === 'api.chess.com' || url.pathname.includes('/api/')) return;
  if (url.origin === location.origin && url.searchParams.has('state')) return; // back from sign-in: never cache that page
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
