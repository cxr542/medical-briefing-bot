const CACHE_NAME = 'medical-briefing-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll([OFFLINE_URL, '/icons/icon-192.png'])
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (names) => {
      await Promise.all(names
        .filter((name) => name.startsWith('medical-briefing-offline-') && name !== CACHE_NAME)
        .map((name) => caches.delete(name)));
      await self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => {
      const fallback = await caches.match(OFFLINE_URL);
      return fallback || Response.error();
    }));
  } else if (url.pathname === '/icons/icon-192.png') {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
  }
});
