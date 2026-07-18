const CACHE = 'walkman-v1';
const SHELL = ['/', '/style.css', '/app.js', '/manifest.json'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
