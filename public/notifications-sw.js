self.addEventListener('push', event => {
  let data = {};
  try {data = event.data?.json() || {};} catch {}
  event.waitUntil(self.registration.showNotification(typeof data.title === 'string' ? data.title : 'BusTrackr', {
    body: typeof data.body === 'string' ? data.body : 'A new bus sighting has arrived.',
    tag: typeof data.eventId === 'string' ? data.eventId : 'bustrackr-sighting',
    data: {url: self.registration.scope},
    icon: new URL('favicon.svg', self.registration.scope).href,
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const destination = self.registration.scope;
  event.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(async clients => {
    for (const client of clients) {
      if (client.url.startsWith(destination) && 'focus' in client) return client.focus();
    }
    return self.clients.openWindow(destination);
  }));
});
