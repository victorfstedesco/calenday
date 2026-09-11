self.addEventListener('push', (event) => {
  let data = { title: 'Lembrete', body: '' };
  try { data = event.data.json(); } catch (e) { /* ignora */ }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Lembrete', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || undefined,
      vibrate: [100, 50, 100],
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      if (clientList.length > 0) return clientList[0].focus();
      return clients.openWindow('/');
    })
  );
});
