// Notifications on this device (issue #87, docs/api.md "Notifications on this device"): the switch in Settings, and
// what it does with the browser. On, it asks the browser's permission (on the tap, never on load), registers the
// service worker (sw.js), subscribes with the account's key and gives botdot the subscription; botdot then sends
// what the phone app would show. Off, it ends the subscription here and at botdot.
// An iPhone or iPad gets Web Push only in botdot added to its Home Screen: in Safari the switch says so instead.
// A plain <script>, as window.Push; the tests load it the same way.

(function (root) {

// The page's words (i18n.js, #647); without them (the tests load this file alone) English.
const words = typeof I18n === 'object' ? I18n : null;
const tr = (text, vars) => (words ? words.tr(text, vars) : text);

// An iPhone or iPad (an iPad says it is a Mac, with a touch screen).
const isIos = (nav) => /iPad|iPhone|iPod/.test(String(nav?.userAgent || '')) || (nav?.platform === 'MacIntel' && nav?.maxTouchPoints > 1);
// In Safari on iOS, not the Home Screen app: push needs the Home Screen app.
const needsHomeScreen = (nav) => isIos(nav) && nav.standalone !== true;
// Can this browser get Web Push at all?
const supported = (win) => !!win?.navigator?.serviceWorker && 'PushManager' in win && 'Notification' in win;

// How the page names this browser to botdot: a few words, so the owner can tell subscriptions apart.
function deviceName(nav) {
  const ua = String(nav?.userAgent || '');
  const os = isIos(nav) ? (/iPad/.test(ua) || nav?.platform === 'MacIntel' ? 'iPad' : 'iPhone') : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'A browser';
  const app = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return isIos(nav) && nav?.standalone === true ? `${os}, Home Screen` : app ? `${os}, ${app}` : os;
}

// The key as the browser takes it, from base64url.
function keyBytes(b64u) {
  const s = String(b64u).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
// Was this subscription made with that key? (A restored botdot can have another.)
function sameKey(buffer, b64u) {
  if (!buffer) return false;
  const a = new Uint8Array(buffer);
  const b = keyBytes(b64u);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

const registration = (nav) => nav.serviceWorker.getRegistration('/').catch(() => null);
async function subscription(nav) {
  const reg = await registration(nav);
  return reg ? reg.pushManager.getSubscription().catch(() => null) : null;
}

// Is the switch on: this browser is subscribed, and allowed to show them?
async function isOn(win) {
  if (!supported(win) || win.Notification.permission !== 'granted') return false;
  return !!(await subscription(win.navigator));
}

// The switch, turned on. `api` is the page's (app.js). Throws with a sentence for the owner.
async function turnOn(win, api) {
  // First of all, on the tap itself: a browser asks only while the tap is fresh (Safari above all).
  const allowed = await win.Notification.requestPermission();
  if (allowed !== 'granted') {
    throw new Error(allowed === 'denied'
      ? tr('Notifications are blocked for botdot in this browser. Allow them in its settings, then turn this on again.')
      : tr('Notifications were not allowed.'));
  }
  const nav = win.navigator;
  await nav.serviceWorker.register('/sw.js');
  const reg = await nav.serviceWorker.ready;
  const { publicKey } = await api('/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options?.applicationServerKey, publicKey)) { await sub.unsubscribe(); sub = null; }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await api('/push/subscriptions', { method: 'POST', body: { ...sub.toJSON(), device: deviceName(nav) } });
}

// The switch, turned off: no more pushes to this browser.
async function turnOff(win, api) {
  const sub = await subscription(win.navigator);
  if (!sub) return;
  const { endpoint } = sub;
  await sub.unsubscribe().catch(() => {});
  await api('/push/subscriptions', { method: 'DELETE', body: { endpoint } });
}

// On load: a browser that is subscribed gives botdot its subscription again (after a restore, or a renewal botdot
// missed). Quiet: nothing is asked and nothing is said.
async function again(win, api) {
  if (!supported(win) || win.Notification.permission !== 'granted') return;
  const sub = await subscription(win.navigator);
  if (sub) await api('/push/subscriptions', { method: 'POST', body: { ...sub.toJSON(), device: deviceName(win.navigator) } }).catch(() => {});
}

// A chat was opened here: its notifications on this device go.
async function clear(win, tag) {
  if (!supported(win) || !tag) return;
  const reg = await registration(win.navigator);
  if (!reg?.getNotifications) return;
  for (const n of await reg.getNotifications({ tag }).catch(() => [])) n.close();
}

// What a tap on a notification opens, from the service worker's message: the page's view and its id, or null.
function viewOf(target) {
  const t = String(target || '');
  const i = t.indexOf(':');
  const [kind, id] = i > 0 ? [t.slice(0, i), t.slice(i + 1)] : [t, ''];
  if (['bot', 'chief', 'group'].includes(kind) && /^[\w.-]{1,80}$/.test(id)) return { view: kind, id };
  if (kind === 'room' && /^[\w.-]{1,80}$/.test(id)) return { view: 'rooms', id }; // a shared room (ADR 060)
  if (t === 'needs') return { view: 'needs', id: null };
  if (t === 'app') return { view: 'chief', id: null };
  return null;
}

// A tap on a notification while the page is open: the service worker tells the page its target, and `open` gets it.
function onTap(win, open) {
  if (!supported(win)) return;
  win.navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'open') open(e.data.target); });
}

const api = { isIos, needsHomeScreen, supported, deviceName, keyBytes, sameKey, isOn, turnOn, turnOff, again, clear, viewOf, onTap };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.Push = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
