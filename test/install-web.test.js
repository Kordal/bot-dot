// Installing botdot from the browser, on the web page (public/install.js, public/sw.js, issue #163): Settings offers the
// browser's own install dialog when the browser offers one, says the way in Safari, and shows nothing once installed;
// the service worker shows the offline page for a page that can't be loaded and leaves everything else alone.
// Run against stand-in browsers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Install = require('../public/install');

const SW = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

function browser({ ua = CHROME, standalone = false, touch = 0 } = {}) {
  const handlers = {};
  const win = {
    navigator: { userAgent: ua, platform: /Macintosh/.test(ua) ? 'MacIntel' : 'Linux x86_64', maxTouchPoints: touch },
    matchMedia: (q) => ({ matches: standalone && q === '(display-mode: standalone)' }),
    addEventListener: (type, fn) => { (handlers[type] ||= []).push(fn); },
  };
  const fire = (type, e = {}) => { for (const fn of handlers[type] || []) fn(e); };
  return { win, fire };
}
const offer = (outcome) => {
  const log = [];
  return { log, preventDefault: () => log.push('preventDefault'), prompt: async () => log.push('prompt'), userChoice: Promise.resolve({ outcome }) };
};

test('Chrome offers it: the button shows, its tap opens the dialog once, and an install hides the card', async () => {
  const { win, fire } = browser();
  Install.watch(win);
  let changes = 0;
  Install.onChange(win, () => changes++);
  assert.equal(Install.state(win), null, 'nothing before the browser offers');
  const e = offer('accepted');
  fire('beforeinstallprompt', e);
  assert.deepEqual(e.log, ['preventDefault']);
  assert.equal(Install.state(win), 'button');
  assert.equal(await Install.install(win), true);
  assert.deepEqual(e.log, ['preventDefault', 'prompt']);
  assert.equal(Install.state(win), null);
  assert.equal(await Install.install(win), false, 'an offer is good once');
  assert.ok(changes >= 2);
});

test('a dismissed dialog hides the button until the browser offers again; appinstalled hides it too', async () => {
  const { win, fire } = browser();
  Install.watch(win);
  fire('beforeinstallprompt', offer('dismissed'));
  assert.equal(await Install.install(win), false);
  assert.equal(Install.state(win), null);
  fire('beforeinstallprompt', offer('dismissed'));
  assert.equal(Install.state(win), 'button');
  fire('appinstalled');
  assert.equal(Install.state(win), null);
});

test('Safari: the way to install is said; opened as the app, nothing is', () => {
  assert.equal(Install.state(browser({ ua: IPHONE }).win), 'ios');
  assert.equal(Install.state(browser({ ua: MAC_SAFARI, touch: 5 }).win), 'ios', 'an iPad says it is a Mac');
  assert.equal(Install.state(browser({ ua: MAC_SAFARI }).win), 'mac-safari');
  assert.equal(Install.state(browser({ ua: MAC_CHROME }).win), null);
  const home = browser({ ua: IPHONE }).win;
  home.navigator.standalone = true;
  assert.equal(Install.state(home), null);
  const app = browser({ standalone: true });
  Install.watch(app.win);
  app.fire('beforeinstallprompt', offer('accepted'));
  assert.equal(Install.state(app.win), null);
});

test('the service worker is registered on every load, and quietly not where there is none', async () => {
  const seen = [];
  const win = { navigator: { serviceWorker: { register: async (url) => { seen.push(url); return {}; } } } };
  await Install.register(win);
  assert.deepEqual(seen, ['/sw.js']);
  assert.equal(await Install.register({ navigator: {} }), null);
  assert.equal(await Install.register({ navigator: { serviceWorker: { register: async () => { throw new Error('no'); } } } }), null);
});

// The service worker in a stand-in worker scope: its caches and the network.
function worker({ online = true } = {}) {
  const handlers = {};
  const stores = new Map([['old-cache', new Map()]]);
  const fetched = [];
  const self = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
    registration: {},
    location: { origin: 'https://botdot.example' },
  };
  const caches = {
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return { add: async (req) => { const url = typeof req === 'string' ? req : req.url; fetched.push(url); if (!online) throw new Error('offline'); m.set(url, `kept ${url}`); } };
    },
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (url, { cacheName }) => stores.get(cacheName)?.get(url),
  };
  const ctx = {
    self, caches, console,
    Request: function Request(url, opts) { this.url = url; this.cache = opts?.cache; },
    Response: { error: () => 'network error' },
    fetch: async (req) => { fetched.push(req.url); if (!online) throw new TypeError('Failed to fetch'); return `page ${req.url}`; },
    URL,
  };
  vm.runInNewContext(SW, ctx);
  const run = async (type, e) => {
    let waited; let answer;
    handlers[type]({ ...e, waitUntil: (p) => { waited = p; }, respondWith: (p) => { answer = p; } });
    const out = answer === undefined ? undefined : await answer;
    await waited;
    return out;
  };
  return { run, stores, fetched, setOnline: (v) => { online = v; } };
}

test('the service worker keeps only the offline page and its words, shows it for a page that fails, and leaves the rest alone', async () => {
  const w = worker();
  await w.run('install', {});
  await w.run('activate', {});
  assert.deepEqual([...w.stores.keys()], ['botdot-offline-2'], 'older caches go');
  assert.deepEqual([...w.stores.get('botdot-offline-2').keys()], ['/offline.html', '/i18n.js'], 'the offline page and its words (#647)');
  assert.equal(await w.run('fetch', { request: { mode: 'navigate', url: '/#chief' } }), 'page /#chief', 'online: the page itself');
  w.setOnline(false);
  assert.equal(await w.run('fetch', { request: { mode: 'navigate', url: '/' } }), 'kept /offline.html');
  assert.equal(await w.run('fetch', { request: { mode: 'cors', url: '/api/bots' } }), undefined, 'the API is not answered by the worker');
  assert.equal(await w.run('fetch', { request: { mode: 'no-cors', url: '/app.js' } }), undefined);
  assert.equal(await w.run('fetch', { request: { mode: 'no-cors', url: 'https://botdot.example/i18n.js' } }), 'kept /i18n.js', "the offline page's words");
  w.setOnline(true);
  assert.equal(await w.run('fetch', { request: { mode: 'no-cors', url: 'https://botdot.example/i18n.js' } }), 'page https://botdot.example/i18n.js', 'online: the file itself');
});

test('the service worker installs offline too, a failed page without the offline page fails as before, and the next page keeps it', async () => {
  const w = worker({ online: false });
  await w.run('install', {});
  assert.equal(await w.run('fetch', { request: { mode: 'navigate', url: '/' } }), 'network error');
  w.setOnline(true);
  assert.equal(await w.run('fetch', { request: { mode: 'navigate', url: '/' } }), 'page /', 'the next page that loads keeps it');
  w.setOnline(false);
  assert.equal(await w.run('fetch', { request: { mode: 'navigate', url: '/' } }), 'kept /offline.html');
});
