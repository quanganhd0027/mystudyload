/* StudyLoad · sw.js — nhận thông báo đẩy khi tab đã đóng/ẩn */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'StudyLoad', {
    body: d.body || '',
    tag: d.tag || undefined,
    data: { page: d.page || 'notifications' },
    requireInteraction: false
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const page = (e.notification.data && e.notification.data.page) || 'notifications';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all.length) { const c = all[0]; await c.focus(); c.postMessage({ type: 'go', page }); return; }
    await self.clients.openWindow('/#' + page);
  })());
});
