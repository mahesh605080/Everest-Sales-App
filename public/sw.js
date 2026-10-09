// Minimal service worker: makes the site installable and shows a clear page when there is no network.
// It never caches API answers or pages, so nobody sees stale sales or credit figures.
const OFFLINE = '/offline.html';
self.addEventListener('install', e => { e.waitUntil(caches.open('sfa-shell-v1').then(c => c.add(OFFLINE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});
