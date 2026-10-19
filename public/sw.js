// botdot's service worker (issue #87): it shows the notifications botdot sends this browser through its push service,
// and a tap opens the chat or the card they are about. Nothing else: no caching, no offline page. The page registers it
// when the switch "Notifications on this device" is turned on in Settings (push.js).
//
// A push is { title, body, target, tag }: `target` is "bot:<id>", "chief:<chatId>", "group:<id>", "needs" (Needs you)
// or "app"; `tag` names the notification, so a newer one of the same chat or card takes its place.

// Where a target opens: the page's own address for it.
const ID = /^[\w.-]{1,80}$/;
function hashOf(target) {
  const t = String(target || '');
  const i = t.indexOf(':');
  const [kind, id] = i > 0 ? [t.slice(0, i), t.slice(i + 1)] : [t, ''];
  if (['bot', 'chief', 'group'].includes(kind) && ID.test(id)) return `#${kind}/${id}`;
  if (t === 'needs') return '#needs';
  return '#chief';
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { /* not botdot's: a plain notification */ }
  const title = typeof d.title === 'string' && d.title ? d.title : 'botdot';
  const tag = typeof d.tag === 'string' && d.tag ? d.tag : typeof d.target === 'string' ? d.target : undefined;
  // Every push shows a notification: a browser takes the subscription away from a page whose pushes show none.
  e.waitUntil(self.registration.showNotification(title, {
    body: typeof d.body === 'string' ? d.body : '',
    tag,
    renotify: !!tag,
    icon: '/icon-512.png',
    data: { target: typeof d.target === 'string' ? d.target : 'app' },
  }));
});

// A tap: the page that is open is brought to the front and opens the target; without one, a new page opens on it.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = e.notification.data?.target || 'app';
  e.waitUntil((async () => {
    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const page = pages.find((c) => new URL(c.url).origin === self.location.origin);
    if (page) {
      page.postMessage({ type: 'open', target });
      return page.focus();
    }
    return self.clients.openWindow(`/${hashOf(target)}`);
  })());
});

// The push service renewed the subscription: botdot is given the new one.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    const key = e.oldSubscription?.options?.applicationServerKey;
    const sub = e.newSubscription || (key ? await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }) : null);
    if (!sub) return;
    await fetch('/api/push/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1' }, body: JSON.stringify(sub.toJSON()) });
  })().catch(() => {}));
});
