// The web page on an iPhone (public/ios.js, #963): with the keyboard open the page is pinned to what is visible, and
// where the page has its own cookies (Home Screen, an app's WKWebView) a new window of this botdot opens in a sheet
// and a download goes to the share sheet. Nothing changes in Safari, on a desktop or on Android. Run against stand-in
// browsers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Ios = require('../public/ios');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_WEBVIEW = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const MAC_APP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)';

function browser({ ua = IPHONE, standalone, vv = { height: 844, offsetTop: 0, scale: 1 }, page = 844 } = {}) {
  const on = {}, vvOn = {}, style = {}, classes = new Set(), made = [];
  const listen = (bag) => (type, fn) => { (bag[type] ||= []).push(fn); };
  const html = { clientHeight: page, classList: { toggle: (c, v) => (v ? classes.add(c) : classes.delete(c)) }, style: { setProperty: (k, v) => { style[k] = v; }, removeProperty: (k) => { delete style[k]; } } };
  const el = (tag) => {
    const e = { tag, children: [], attrs: {}, append: (...c) => e.children.push(...c), setAttribute: (k, v) => { e.attrs[k] = v; }, showModal: () => { e.open = true; }, close: () => { e.open = false; e.onclose?.(); }, remove: () => { e.removed = true; } };
    made.push(e);
    return e;
  };
  const shared = [];
  const win = {
    innerHeight: page, scrollY: 0,
    navigator: { userAgent: ua, platform: /Macintosh/.test(ua) ? 'MacIntel' : 'iPhone', maxTouchPoints: 5, ...(standalone !== undefined ? { standalone } : {}),
      canShare: ({ files }) => files?.length > 0, share: async (d) => { shared.push(d); if (win.shareFails) throw Object.assign(new Error('no'), { name: win.shareFails }); } },
    location: { href: 'https://botdot.example.com/', origin: 'https://botdot.example.com' },
    visualViewport: vv && { ...vv, addEventListener: listen(vvOn) },
    document: { documentElement: html, createElement: el, body: { append: () => {} } },
    matchMedia: () => ({ matches: false }),
    addEventListener: listen(on),
    requestAnimationFrame: (fn) => { fn(); return 1; },
    scrollTo: (x, y) => { win.scrollY = y; },
    fetch: async (href) => ({ ok: true, headers: { get: () => 'attachment; filename*=UTF-8\'\'r%C3%A9sum%C3%A9.pdf' }, blob: async () => ({ type: 'application/pdf', href }) }),
    File: class { constructor(parts, name, o) { Object.assign(this, { parts, name, type: o.type }); } },
  };
  const fire = (bag, type, e = {}) => { for (const fn of (bag === 'vv' ? vvOn : on)[type] || []) fn(e); };
  return { win, fire, style, classes, made, shared };
}

test('the keyboard on an iPhone pins the page to what it leaves visible, and its closing lets it go', () => {
  const b = browser();
  Ios.keyboard(b.win);
  assert.equal(b.classes.has('kb'), false, 'no keyboard, nothing pinned');
  Object.assign(b.win.visualViewport, { height: 500, offsetTop: 0 });
  b.win.scrollY = 300; // Safari moved the page up to show the field
  b.fire('vv', 'resize');
  assert.equal(b.classes.has('kb'), true);
  assert.deepEqual(b.style, { '--kb-top': '0px', '--kb-h': '500px' });
  assert.equal(b.win.scrollY, 0, 'the page is scrolled back, its header on screen');
  Object.assign(b.win.visualViewport, { offsetTop: 40.4 });
  b.fire('vv', 'scroll');
  assert.equal(b.style['--kb-top'], '40px', 'follows where the visible part is');
  Object.assign(b.win.visualViewport, { height: 844, offsetTop: 0 });
  b.fire('vv', 'resize');
  assert.equal(b.classes.has('kb'), false);
  assert.deepEqual(b.style, {});
});

test("zooming in or Safari's bars are not the keyboard", () => {
  const b = browser({ vv: { height: 400, offsetTop: 0, scale: 2 } });
  assert.equal(Ios.visible(b.win), null, 'zoomed in');
  const bars = browser({ vv: { height: 780, offsetTop: 0, scale: 1 } });
  assert.equal(Ios.visible(bars.win), null, 'the bars took 64 px');
});

test('no keyboard handling off iOS: Android, a desktop, the Mac app', () => {
  for (const ua of [ANDROID, MAC_APP]) {
    const b = browser({ ua, vv: { height: 400, offsetTop: 0, scale: 1 } });
    b.win.navigator.maxTouchPoints = 0;
    Ios.keyboard(b.win);
    assert.equal(b.classes.has('kb'), false, ua);
  }
});

test("the page's own cookies: the Home Screen and an app's WKWebView, not Safari, Android or the Mac app", () => {
  assert.equal(Ios.inApp(browser({ standalone: true }).win), true, 'Home Screen');
  assert.equal(Ios.inApp(browser({ ua: IPHONE_WEBVIEW }).win), true, "the iOS app's WKWebView");
  assert.equal(Ios.inApp(browser({ standalone: false }).win), false, 'Safari');
  assert.equal(Ios.inApp(browser({ ua: ANDROID }).win), false, 'Android');
  const mac = browser({ ua: MAC_APP }).win;
  mac.navigator.maxTouchPoints = 0;
  assert.equal(Ios.inApp(mac), false, 'the desktop app on a Mac');
});

const click = (b, a) => {
  const e = { button: 0, target: { closest: () => a }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  b.fire('win', 'click', e);
  return e;
};
const link = (href, { target = '', download = null, title = '' } = {}) => ({ href, target, title, textContent: ' Report ', hasAttribute: (k) => k === 'download' && download !== null, getAttribute: () => download });

test("from the Home Screen a new window of this botdot opens in a sheet over the page; another site's is left alone", () => {
  const b = browser({ standalone: true });
  Ios.links(b.win);
  const e = click(b, link('https://botdot.example.com/doc?run=r1', { target: '_blank' }));
  assert.equal(e.defaultPrevented, true);
  const d = b.made.find((x) => x.tag === 'dialog');
  assert.equal(d.className, 'page-sheet');
  assert.equal(d.open, true);
  assert.equal(b.made.find((x) => x.tag === 'iframe').src, 'https://botdot.example.com/doc?run=r1', 'same cookies: a frame of the page');
  assert.equal(b.made.find((x) => x.tag === 'b').textContent, 'Report');
  d.close();
  assert.equal(d.removed, true, 'Close takes it away, the page where it was');
  assert.equal(click(b, link('https://example.com/', { target: '_blank' })).defaultPrevented, false, 'another site opens in the browser');
  assert.equal(click(b, link('https://botdot.example.com/#chief')).defaultPrevented, false, 'a link in the same window stays one');
});

test('a link the page already took (the viewer, a picture) is left to it', () => {
  const b = browser({ standalone: true });
  Ios.links(b.win);
  const e = { button: 0, target: { closest: () => link('https://botdot.example.com/api/files/a.pdf', { target: '_blank' }) }, defaultPrevented: true, preventDefault() {} };
  b.fire('win', 'click', e);
  assert.equal(b.made.length, 0);
});

test('from the Home Screen a download goes to the share sheet, under the name the server gives', async () => {
  const b = browser({ standalone: true });
  Ios.links(b.win);
  assert.equal(click(b, link('https://botdot.example.com/api/bots/b1/path?path=cv.pdf', { download: '' })).defaultPrevented, true);
  await new Promise((r) => setImmediate(r));
  assert.equal(b.shared.length, 1);
  assert.equal(b.shared[0].files[0].name, 'résumé.pdf');
  assert.equal(b.made.length, 0, 'no sheet');
});

test('a share too late for its tap opens the file in a sheet whose button shares it; a cancelled share does nothing', async () => {
  const b = browser({ standalone: true });
  b.win.shareFails = 'NotAllowedError';
  assert.equal(await Ios.save(b.win, { href: 'https://botdot.example.com/api/backups/x.tar', name: 'x.tar' }), 'sheet');
  const share = b.made.find((x) => x.tag === 'button' && x.attrs['aria-label'] === 'Download');
  assert.ok(share, 'the bar has the share button');
  b.win.shareFails = '';
  share.onclick();
  await new Promise((r) => setImmediate(r));
  assert.equal(b.shared.at(-1).files[0].name, 'x.tar');
  const c = browser({ standalone: true });
  c.win.shareFails = 'AbortError';
  assert.equal(await Ios.save(c.win, { href: 'https://botdot.example.com/a.txt', name: 'a.txt' }), 'cancelled');
  assert.equal(c.made.length, 0);
});

test('in Safari, on Android and on a desktop links and downloads are left to the browser', () => {
  for (const opts of [{ standalone: false }, { ua: ANDROID }]) {
    const b = browser(opts);
    Ios.links(b.win);
    assert.equal(click(b, link('https://botdot.example.com/doc?run=r1', { target: '_blank' })).defaultPrevented, false);
    assert.equal(click(b, link('https://botdot.example.com/api/backups/x.tar', { download: '' })).defaultPrevented, false);
    assert.equal(Ios.open(b.win, 'https://botdot.example.com/api/files/a.pdf'), false);
  }
});

test('the page loads it, pins the app with the keyboard open, and Files opens a file through it', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
  assert.match(read('index.html'), /<script src="\/ios.js"><\/script>/);
  assert.match(read('style.css'), /html\.kb \.app \{[^}]*position: fixed;[^}]*top: var\(--kb-top[^}]*height: var\(--kb-h/);
  assert.match(read('files.js'), /Ios\?\.open\(window, `\/api\$\{src\}`/);
});
