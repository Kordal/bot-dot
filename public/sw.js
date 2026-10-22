// botdot's service worker (issue #87): it shows the notifications botdot sends this browser through its push service,
// and a tap opens the chat or the card they are about. And one page for no connection (issue #163): a page of botdot
// that can't be loaded shows offline.html, the one file it keeps. Nothing else is cached: not the app, not the API.
// The page registers it on every load (install.js), and again when "Notifications on this device" is turned on (push.js).
//
// A push is { title, body, target, tag }: `target` is "bot:<id>", "chief:<chatId>", "group:<id>", "room:<id>" (a
// shared room), "needs" (Needs you) or "app"; `tag` names the notification, so a newer one of the same chat or card
// takes its place.

// Where a target opens: the page's own address for it.
const ID = /^[\w.-]{1,80}$/;
function hashOf(target) {
  const t = String(target || '');
  const i = t.indexOf(':');
  const [kind, id] = i > 0 ? [t.slice(0, i), t.slice(i + 1)] : [t, ''];
  if (['bot', 'chief', 'group'].includes(kind) && ID.test(id)) return `#${kind}/${id}`;
  if (kind === 'room' && ID.test(id)) return `#rooms/${id}`; // a shared room (ADR 060): the page's Rooms view
  if (t === 'needs') return '#needs';
  return '#chief';
}

// The offline page: kept at install, under a name that changes with it (a new offline.html needs a new name here);
// older names go when this worker takes over.
const OFFLINE = '/offline.html';
const KEPT = 'botdot-offline-1';

// The offline page, kept unless it is already. Never fails: without it a failed page fails as it would without botdot.
const keep = async () => {
  try {
    if (await caches.match(OFFLINE, { cacheName: KEPT })) return;
    await (await caches.open(KEPT)).add(new Request(OFFLINE, { cache: 'reload' }));
  } catch { /* no connection: the next page that loads tries again */ }
};

self.addEventListener('install', (e) => {
  self.skipWaiting();
  // A worker installs even when the page can't be kept now: failing here would take push away with it.
  e.waitUntil(keep());
});
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const name of await caches.keys()) if (name !== KEPT) await caches.delete(name);
  await self.clients.claim();
})()));

// A page that can't be loaded: the offline page in its place. Only pages: a script, a picture or the API fails as before.
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).then((page) => {
    e.waitUntil(keep()); // kept now if the install couldn't
    return page;
  }, async () => (await caches.match(OFFLINE, { cacheName: KEPT })) || Response.error()));
});

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
