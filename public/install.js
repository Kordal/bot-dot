// Installing botdot from the browser (issue #163): Settings → "Install app". Chrome and Edge say botdot can be installed
// with `beforeinstallprompt`, which is kept here (from the page's first moment, as it can come before Settings is
// drawn) for the button's tap. Safari has no such event: on an iPhone or iPad the card says to use Share → Add to Home
// Screen, on a Mac File → Add to Dock. Opened as an installed app, there is nothing to install and no card.
// It also registers the service worker (sw.js) as the page loads, before anything can fail: the offline page and
// notifications need it.
// A plain <script>, as window.Install; the tests load it the same way.

(function (root) {

const watched = new WeakMap(); // a window -> { offer: its beforeinstallprompt, or null; installed; listeners }
const of = (win) => {
  if (!watched.has(win)) watched.set(win, { offer: null, installed: false, listeners: new Set() });
  return watched.get(win);
};
const changed = (win) => { for (const fn of of(win).listeners) fn(); };

// An iPhone or iPad (an iPad says it is a Mac, with a touch screen); Safari on a Mac.
const isIos = (nav) => /iPad|iPhone|iPod/.test(String(nav?.userAgent || '')) || (nav?.platform === 'MacIntel' && nav?.maxTouchPoints > 1);
const isMacSafari = (nav) => {
  const ua = String(nav?.userAgent || '');
  return /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS/.test(ua) && !isIos(nav);
};
// Is this page botdot opened as an installed app (or from the Home Screen)?
const standalone = (win) => !!(win.matchMedia?.('(display-mode: standalone)')?.matches || win.navigator?.standalone === true);

// From the page's first moment: the browser's offer to install, and the news that botdot was installed.
function watch(win) {
  win.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // the button in Settings offers it, not the browser's own bar
    of(win).offer = e;
    changed(win);
  });
  win.addEventListener('appinstalled', () => {
    Object.assign(of(win), { offer: null, installed: true });
    changed(win);
  });
}

// What Settings shows: 'button' (the browser can install it), 'ios' (Share → Add to Home Screen), 'mac-safari'
// (File → Add to Dock), or null (installed, or a browser that can't).
function state(win) {
  const s = of(win);
  if (s.installed || standalone(win)) return null;
  if (s.offer) return 'button';
  if (isIos(win.navigator)) return 'ios';
  if (isMacSafari(win.navigator)) return 'mac-safari';
  return null;
}

// The button's tap: the browser's own dialog. Returns true when the owner installed it. An offer is good once.
async function install(win) {
  const s = of(win);
  const offer = s.offer;
  if (!offer) return false;
  s.offer = null;
  await offer.prompt();
  const { outcome } = await offer.userChoice.catch(() => ({ outcome: 'dismissed' }));
  if (outcome === 'accepted') s.installed = true;
  changed(win);
  return outcome === 'accepted';
}

const onChange = (win, fn) => of(win).listeners.add(fn);

// The service worker, on every load. Quiet: a browser without one, or one that refuses it, works as before.
function register(win) {
  const sw = win.navigator?.serviceWorker;
  if (!sw) return Promise.resolve(null);
  return sw.register('/sw.js').catch(() => null);
}

const api = { isIos, isMacSafari, standalone, watch, state, install, onChange, register };
if (typeof module === 'object' && module.exports) module.exports = api;
else {
  root.Install = api;
  if (root.addEventListener) { watch(root); register(root); }
}
})(typeof globalThis !== 'undefined' ? globalThis : this);
