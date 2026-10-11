const CACHE = 'veylo-shell-v3';
const SHELL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith('veylo-shell-') && key !== CACHE).map((key) => caches.delete(key)),
  )));
  self.clients.claim();
});

self.addEventListener('push', (event) => {
  let message = {};
  try { message = event.data ? event.data.json() : {}; } catch { /* Use the generic reminder copy. */ }
  const title = typeof message.title === 'string' ? message.title : 'A thought you set aside';
  const body = typeof message.body === 'string' ? message.body : 'You can return to it whenever you’re ready.';
  const url = typeof message.url === 'string' && message.url.startsWith('/') && !message.url.startsWith('//') ? message.url : '/';
  event.waitUntil(self.registration.showNotification(title, {
    body, icon: '/assets/icon.svg', tag: 'veylo-snooze-reminder',
    renotify: false, data: { url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = typeof event.notification.data?.url === 'string' && event.notification.data.url.startsWith('/') && !event.notification.data.url.startsWith('//')
    ? event.notification.data.url : '/';
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    const sameOrigin = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (sameOrigin) { await sameOrigin.navigate(target); return sameOrigin.focus(); }
    return self.clients.openWindow(target);
  }));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/v1/') || url.pathname === '/auth/callback' || url.searchParams.has('code') || url.searchParams.has('access_token')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) void caches.open(CACHE).then((cache) => cache.put(SHELL, response.clone()));
      return response;
    }).catch(async () => (await caches.match(SHELL)) ?? Response.error()));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    const immutableAsset = /[-.]([a-z0-9_-]{8,})\./i.test(url.pathname);
    if (immutableAsset) {
      event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
        if (response.ok) void caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
        return response;
      })));
      return;
    }

    event.respondWith(fetch(request).then((response) => {
      if (response.ok) void caches.open(CACHE).then((cache) => cache.put(request, response.clone()));
      return response;
    }).catch(async () => (await caches.match(request)) ?? Response.error()));
  }
});
