/* Imported by the generated offline worker. No session token is stored here. */
const PUSH_SETTINGS = 'safewatch-push-settings-v1';
const PUSH_RECEIPTS = 'safewatch-push-receipts-v1';
const ownerUrl = () => new URL('/__safewatch_push_owner', self.location.origin).href;

async function pushOwner() {
  const response = await (await caches.open(PUSH_SETTINGS)).match(ownerUrl());
  return response ? response.text() : '';
}

self.addEventListener('message', event => {
  if (event.data?.type !== 'SAFEWATCH_PUSH_OWNER' || !event.source?.url
      || new URL(event.source.url).origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const cache = await caches.open(PUSH_SETTINGS);
    const owner = event.data.userId;
    if (typeof owner === 'string' && /^[\da-f-]{36}$/i.test(owner)) {
      await cache.put(ownerUrl(), new Response(owner));
    } else {
      await cache.delete(ownerUrl());
      for (const notification of await self.registration.getNotifications()) notification.close();
    }
    event.ports?.[0]?.postMessage({ saved: true });
  })());
});

function pushTarget(data) {
  if (data?.kind === 'test') return '/?notification_test=1';
  if (data?.kind === 'sos' && /^[1-9]\d{0,18}$/.test(String(data.alertId))) return `/?sos=${data.alertId}`;
  return null;
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data;
    try { data = event.data?.json(); } catch { return; }
    const target = pushTarget(data);
    if (!target || !data.deliveryId || await pushOwner() !== data.userId
        || !Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) < Date.now()) return;
    const receiptCache = await caches.open(PUSH_RECEIPTS);
    const receipt = new URL(`/__safewatch_push_receipt/${encodeURIComponent(data.deliveryId)}`, self.location.origin).href;
    if (await receiptCache.match(receipt)) return;
    const reactivated = data.kind === 'sos' && data.reactivated === true;
    const notifyOpenApp = async () => {
      if (data.kind !== 'sos') return;
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const window of windows) {
        if (window.visibilityState !== 'visible' || new URL(window.url).origin !== self.location.origin) continue;
        window.postMessage({ type: 'SAFEWATCH_SOS_PUSH', alertId: String(data.alertId), userId: data.userId });
      }
    };
    const notification = self.registration.showNotification(data.kind === 'test' ? 'SafeWatch notification test' : 'SafeWatch · SOS alert', {
      body: data.kind === 'test' ? 'Background notifications are working. Tap to open SafeWatch.'
        : reactivated ? 'A linked senior’s watch activated SOS again. Tap to view the alert.'
        : 'A linked senior’s watch sent an SOS. Tap to open the alert and respond.',
      icon: '/icons/family-192-v2.png',
      badge: '/icons/notification-badge.svg',
      tag: data.kind === 'test' ? `safewatch-test-${data.deliveryId}`
        : reactivated ? `safewatch-sos-${data.alertId}-${data.deliveryId}` : `safewatch-sos-${data.alertId}`,
      silent: false, renotify: false, requireInteraction: true,
      vibrate: [300, 150, 300, 150, 500],
      timestamp: Date.parse(data.createdAt) || Date.now(),
      data: { target },
      actions: [{ action: 'open', title: data.kind === 'test' ? 'Open SafeWatch' : 'Open SOS' }],
    });
    const [result] = await Promise.allSettled([notification, notifyOpenApp()]);
    if (result.status === 'rejected') throw result.reason;
    await receiptCache.put(receipt, new Response(String(Date.now())));
    const keys = await receiptCache.keys();
    for (const key of keys.slice(0, Math.max(0, keys.length - 100))) await receiptCache.delete(key);
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = event.notification.data?.target;
    if (typeof target !== 'string' || !/^\/\?(?:sos=[1-9]\d{0,18}|notification_test=1)$/.test(target)) return;
    const url = new URL(target, self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const window of windows) {
      if (new URL(window.url).origin !== self.location.origin) continue;
      try {
        const navigated = await window.navigate(url);
        if (navigated) { await navigated.focus(); return; }
      } catch { /* A closing window can be replaced by the installed app. */ }
    }
    await self.clients.openWindow(url);
  })());
});
