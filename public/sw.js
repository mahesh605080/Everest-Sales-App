// Minimal service worker: makes the site installable and shows a clear page when there is no network.
// It never caches API answers or pages, so nobody sees stale sales or credit figures.
const OFFLINE = '/offline.html';
self.addEventListener('install', e => { e.waitUntil(caches.open('sfa-shell-v1').then(c => c.add(OFFLINE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});

// Push: the server sends an encrypted message through the browser's own push service; this shows it even when no tab is open.
// The text comes only from our server (the browser checks the sender's key), and a tap can only lead to a page of this site.
// Decided the way the browser itself would read the address: resolved against this site, it must still be this site.
const inside = (u, fallback = '/dashboard') => {
  if (typeof u !== 'string' || !u.startsWith('/')) return fallback;
  try { const x = new URL(u, self.location.origin); return x.origin === self.location.origin ? x.pathname + x.search + x.hash : fallback; } catch { return fallback; }
};
const ack = (token, clicked) => (token ? fetch('/api/v1/notifications/ack', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, clicked }), keepalive: true }).catch(() => {}) : Promise.resolve());
self.addEventListener('push', e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { title: 'Everest SFA', body: e.data ? e.data.text() : '' }; }
  if (!m || typeof m !== 'object') m = {};
  const shown = self.registration.showNotification(String(m.title || 'Everest SFA').slice(0, 150), {
    body: String(m.body || '').slice(0, 500), icon: inside(m.icon, '/icon-192.png'), badge: '/icon-192.png', tag: m.id || undefined, data: { url: inside(m.url), ack: m.ack || null },
  });
  e.waitUntil(shown.then(() => ack(m.ack, false)));   // "confirmed" on the server means exactly this: the browser showed it
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const { url, ack: token } = e.notification.data || {};
  e.waitUntil(Promise.all([ack(token, true), self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => new URL(c.url).origin === self.location.origin);
    return open ? open.focus().then(c => (c && 'navigate' in c ? c.navigate(inside(url)) : null)).catch(() => self.clients.openWindow(inside(url))) : self.clients.openWindow(inside(url));
  })]));
});
// The browser may replace a subscription on its own. Tell the open page to register the new one; with no page open it is registered at the next visit.
self.addEventListener('pushsubscriptionchange', e => { e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => list.forEach(c => c.postMessage({ type: 'push-resubscribe' })))); });
