// Geist and Geist Mono ship with the web page and the Android app: nothing is fetched from Google (#446).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, ROOT } = require('./helpers');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(async () => { srv.unhold(); await srv.stop(); });

const FONTS = ['Geist.ttf', 'Geist-Italic.ttf', 'GeistMono.ttf'];

test('the server serves the fonts and their licence, cached like the other files of the page', async () => {
  for (const name of FONTS) {
    const res = await fetch(`${srv.base}/fonts/${name}`, { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(res.status, 200, name);
    assert.equal(res.headers.get('content-type'), 'font/ttf', name);
    assert.equal(res.headers.get('content-encoding'), 'gzip', name);
    assert.equal(res.headers.get('cache-control'), 'no-cache', name);
    const body = Buffer.from(await res.arrayBuffer());
    assert.ok(body.equals(fs.readFileSync(path.join(ROOT, 'public', 'fonts', name))), name);
    assert.equal((await fetch(`${srv.base}/fonts/${name}`, { headers: { 'If-None-Match': res.headers.get('etag') } })).status, 304, name);
  }
  const ofl = await fetch(`${srv.base}/fonts/OFL.txt`);
  assert.equal(ofl.status, 200);
  assert.match(ofl.headers.get('content-type'), /^text\/plain/);
  assert.match(await ofl.text(), /SIL OPEN FONT LICENSE/);
});

test('the page links no Google Fonts and its rules allow fonts only from botdot', async () => {
  const res = await fetch(`${srv.base}/`);
  const html = await res.text();
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /font-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  const css = fs.readFileSync(path.join(ROOT, 'public', 'style.css'), 'utf8');
  for (const name of FONTS) assert.match(css, new RegExp(`url\\("/fonts/${name}"\\)`), name);
});

test('every copy of the fonts is the Mac app\'s, with OFL.txt beside it', () => {
  const mac = path.join(ROOT, 'macos', 'BotDot', 'Resources', 'Fonts');
  const same = (a, b) => assert.ok(fs.readFileSync(a).equals(fs.readFileSync(b)), `${b} differs from ${a}`);
  for (const name of [...FONTS, 'OFL.txt']) same(path.join(mac, name), path.join(ROOT, 'public', 'fonts', name));
  // Android names resources in lower case, and res/font takes fonts only: the licence ships in assets/fonts.
  const android = path.join(ROOT, 'android', 'app', 'src', 'main');
  same(path.join(mac, 'Geist.ttf'), path.join(android, 'res', 'font', 'geist.ttf'));
  same(path.join(mac, 'Geist-Italic.ttf'), path.join(android, 'res', 'font', 'geist_italic.ttf'));
  same(path.join(mac, 'GeistMono.ttf'), path.join(android, 'res', 'font', 'geist_mono.ttf'));
  same(path.join(mac, 'OFL.txt'), path.join(android, 'assets', 'fonts', 'OFL.txt'));
});
