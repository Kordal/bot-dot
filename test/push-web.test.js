// Notifications on this device, on the web page (public/push.js, public/sw.js, issue #87): the switch asks the
// browser's permission on the tap and before anything else, subscribes with the account's key and gives botdot the
// subscription; Safari on an iPhone is told to add botdot to the Home Screen first; the service worker shows what
// botdot sends and a tap opens its chat. Run against stand-in browsers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Push = require('../public/push');
const { cut } = require('./web-page');

const SW = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
const KEY = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64url');
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

// A browser that can get Web Push: what it was asked, in order.
function browser({ permission = 'default', answer = 'granted', existing = null } = {}) {
  const log = [];
  let sub = existing;
  const reg = {
    pushManager: {
      getSubscription: async () => sub,
      subscribe: async (opts) => {
        log.push(['subscribe', Buffer.from(opts.applicationServerKey).toString('base64url'), opts.userVisibleOnly]);
        sub = { endpoint: 'https://push.example/new', options: { applicationServerKey: opts.applicationServerKey.buffer }, toJSON: () => ({ endpoint: 'https://push.example/new', keys: { p256dh: 'p', auth: 'a' } }), unsubscribe: async () => { log.push(['unsubscribe']); sub = null; } };
        return sub;
      },
    },
  };
  const win = {
    PushManager: function PushManager() {},
    Notification: { permission, requestPermission: async () => { log.push(['permission']); win.Notification.permission = answer; return answer; } },
    navigator: {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/131.0',
      serviceWorker: {
        register: async (url) => { log.push(['register', url]); return reg; },
        ready: Promise.resolve(reg),
        getRegistration: async () => (log.some((l) => l[0] === 'register') || existing ? reg : undefined),
      },
    },
  };
  const api = async (p, opts = {}) => {
    log.push(['api', opts.method || 'GET', p, opts.body]);
    return p === '/push/key' ? { publicKey: KEY } : { ok: true };
  };
  return { win, api, log, sub: () => sub };
}

test('turning the switch on asks first, then subscribes with the account key and tells botdot', async () => {
  const b = browser();
  assert.equal(await Push.isOn(b.win), false);
  await Push.turnOn(b.win, b.api);
  assert.equal(b.log[0][0], 'permission', 'the permission is asked on the tap, before anything that waits');
  assert.deepEqual(b.log.map((l) => l.slice(0, 3)), [
    ['permission'], ['register', '/sw.js'], ['api', 'GET', '/push/key'], ['subscribe', KEY, true], ['api', 'POST', '/push/subscriptions'],
  ]);
  assert.deepEqual(b.log[4][3], { endpoint: 'https://push.example/new', keys: { p256dh: 'p', auth: 'a' }, device: 'Linux, Firefox' });
  assert.equal(await Push.isOn(b.win), true);
  await Push.turnOff(b.win, b.api);
  assert.deepEqual(b.log.slice(5).map((l) => l.slice(0, 4)), [['unsubscribe'], ['api', 'DELETE', '/push/subscriptions', { endpoint: 'https://push.example/new' }]]);
  assert.equal(await Push.isOn(b.win), false);
});

test('a refused permission subscribes nothing and says what to do', async () => {
  for (const [answer, words] of [['denied', /blocked for botdot in this browser/], ['default', /were not allowed/]]) {
    const b = browser({ answer });
    await assert.rejects(Push.turnOn(b.win, b.api), words);
    assert.deepEqual(b.log, [['permission']]);
  }
});

test('a subscription made with another key is replaced, and one made with this key is given to botdot again on load', async () => {
  const old = { endpoint: 'https://push.example/old', options: { applicationServerKey: new Uint8Array(65).buffer }, toJSON: () => ({ endpoint: 'https://push.example/old', keys: {} }), unsubscribe: async () => { b.log.push(['unsubscribe']); } };
  const b = browser({ permission: 'granted', existing: old });
  await Push.turnOn(b.win, b.api);
  assert.deepEqual(b.log.map((l) => l[0]), ['permission', 'register', 'api', 'unsubscribe', 'subscribe', 'api']);
  const same = browser({ permission: 'granted', existing: b.sub() });
  await Push.again(same.win, same.api);
  assert.deepEqual(same.log.map((l) => l.slice(0, 3)), [['api', 'POST', '/push/subscriptions']], 'nothing asked');
  const notAllowed = browser({ permission: 'default', existing: b.sub() });
  await Push.again(notAllowed.win, notAllowed.api);
  assert.deepEqual(notAllowed.log, []);
});

test('Safari on an iPhone or iPad needs the Home Screen app; the Home Screen app does not', () => {
  assert.equal(Push.needsHomeScreen({ userAgent: IPHONE, standalone: false }), true);
  assert.equal(Push.needsHomeScreen({ userAgent: IPAD, platform: 'MacIntel', maxTouchPoints: 5, standalone: false }), true);
  assert.equal(Push.needsHomeScreen({ userAgent: IPHONE, standalone: true }), false);
  assert.equal(Push.needsHomeScreen({ userAgent: IPAD, platform: 'MacIntel', maxTouchPoints: 0 }), false, 'a Mac');
  assert.equal(Push.deviceName({ userAgent: IPHONE, standalone: true }), 'iPhone, Home Screen');
  assert.equal(Push.supported({ navigator: {} }), false);
  // The card: the hint in Safari on iOS, the switch elsewhere, nothing against a server without web-push; the
  // permission is asked in the switch's handler alone, never as the page loads.
  const card = cut('function pushCardHTML()', '\nfunction wirePushCard');
  assert.match(card, /Add to Home Screen first/);
  assert.match(card, /needsHomeScreen\(navigator\)/);
  assert.match(card, /features\.includes\('web-push'\)/);
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.doesNotMatch(app, /requestPermission/);
  assert.match(cut('box.onchange = async', '\n  };'), /Push\.turnOn\(window, api\)/);
});

test('a tap opens what the notification is about', () => {
  assert.deepEqual(Push.viewOf('bot:b1'), { view: 'bot', id: 'b1' });
  assert.deepEqual(Push.viewOf('chief:c-1'), { view: 'chief', id: 'c-1' });
  assert.deepEqual(Push.viewOf('group:g1'), { view: 'group', id: 'g1' });
  assert.deepEqual(Push.viewOf('needs'), { view: 'needs', id: null });
  assert.deepEqual(Push.viewOf('app'), { view: 'chief', id: null });
  assert.equal(Push.viewOf('bot:<x>'), null);
  assert.equal(Push.viewOf('javascript:alert(1)'), null);
  const b = browser();
  let heard;
  b.win.navigator.serviceWorker.addEventListener = (type, fn) => { heard = { type, fn }; };
  const opened = [];
  Push.onTap(b.win, (t) => opened.push(t));
  heard.fn({ data: { type: 'open', target: 'bot:b1' } });
  heard.fn({ data: { type: 'other', target: 'bot:b2' } });
  assert.deepEqual([heard.type, opened], ['message', ['bot:b1']]);
});

// The service worker in a stand-in worker scope.
function worker({ pages = [] } = {}) {
  const on = {};
  const shown = [];
  const opened = [];
  const self = {
    location: { origin: 'https://botdot.example' },
    addEventListener: (type, fn) => { on[type] = fn; },
    skipWaiting() {},
    registration: { showNotification: async (title, opts) => { shown.push({ title, ...opts }); } },
    clients: { claim: async () => {}, matchAll: async () => pages, openWindow: async (url) => { opened.push(url); } },
  };
  vm.runInNewContext(SW, { self, URL, fetch: async () => ({}) });
  const fire = async (type, e) => { let done; on[type]({ ...e, waitUntil: (p) => { done = p; } }); await done; };
  return { fire, shown, opened };
}

test('the service worker shows what botdot sent, and a tap brings the page to the chat or opens it there', async () => {
  const w = worker();
  await w.fire('push', { data: { json: () => ({ title: 'News', body: 'Found 3 articles.', target: 'bot:b1', tag: 'bot:b1' }) } });
  assert.deepEqual(w.shown.map((n) => [n.title, n.body, n.tag, n.data.target]), [['News', 'Found 3 articles.', 'bot:b1', 'bot:b1']]);
  await w.fire('push', { data: { json: () => { throw new Error('not JSON'); } } });
  assert.equal(w.shown[1].title, 'botdot', 'every push shows something');
  let closed = false;
  await w.fire('notificationclick', { notification: { data: { target: 'chief:c1' }, close: () => { closed = true; } } });
  assert.ok(closed);
  assert.deepEqual(w.opened, ['/#chief/c1']);
  await w.fire('notificationclick', { notification: { data: { target: 'needs' }, close() {} } });
  await w.fire('notificationclick', { notification: { data: { target: 'bot:../x' }, close() {} } });
  assert.deepEqual(w.opened.slice(1), ['/#needs', '/#chief']);
  const told = [];
  let focused = false;
  const page = { url: 'https://botdot.example/#chief', postMessage: (m) => told.push({ ...m }), focus: async () => { focused = true; } };
  const open = worker({ pages: [page] });
  await open.fire('notificationclick', { notification: { data: { target: 'group:g1' }, close() {} } });
  assert.deepEqual(told, [{ type: 'open', target: 'group:g1' }]);
  assert.ok(focused);
  assert.deepEqual(open.opened, []);
});
