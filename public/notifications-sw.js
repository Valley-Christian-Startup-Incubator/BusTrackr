self.addEventListener('push', event => {
  let data = {};
  try {data = event.data?.json() || {};} catch {}
  event.waitUntil(self.registration.showNotification(typeof data.title === 'string' ? data.title : 'BusTrackr', {
    body: typeof data.body === 'string' ? data.body : 'A new bus sighting has arrived.',
    tag: typeof data.eventId === 'string' ? data.eventId : 'bustrackr-sighting',
    data: {url: new URL('app', self.registration.scope).href},
    icon: new URL('favicon.svg', self.registration.scope).href,
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  // The tracker lives at /app; the site root is the landing page.
  const destination = new URL('app', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(async clients => {
    for (const client of clients) {
      if (client.url.startsWith(destination) && 'focus' in client) {
        try {client.postMessage({type: 'bustrackr_notification_open'});} catch {}
        return client.focus();
      }
    }
    return self.clients.openWindow(destination + '?notification_open=1');
  }));
});
