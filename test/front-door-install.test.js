// Installing botdot from the browser (issue #163): a browser fetches the manifest and its icons without cookies, so
// the front door hands them, and the offline page the service worker keeps, to anyone; everything else still needs a
// session. The manifest is what Chrome and Edge need to offer Install.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startFrontDoor } = require('./front-door-helpers');

const PUBLIC = path.join(__dirname, '..', 'public');
const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'manifest.webmanifest'), 'utf8'));
const pngSize = (file) => { const b = fs.readFileSync(path.join(PUBLIC, file)); return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`; };
const file = (src) => new URL(src, 'https://x').pathname.slice(1);

let door;
before(async () => { door = await startFrontDoor(); });
after(async () => { await door?.stop(); });

test('the manifest, its icons and screenshots, the touch icon and the offline page come without a session', async () => {
  const b = door.browser();
  const paths = ['/manifest.webmanifest', '/apple-touch-icon.png', '/offline.html',
    ...manifest.icons.map((i) => i.src), ...manifest.screenshots.map((s) => s.src)];
  for (const p of paths) {
    const r = await b.get(p);
    assert.equal(r.status, 200, p);
    assert.equal(Number(r.headers['content-length']), fs.statSync(path.join(PUBLIC, file(p))).size, p);
  }
  const m = await b.get('/manifest.webmanifest');
  assert.equal(m.headers['content-type'], 'application/manifest+json');
  assert.deepEqual(JSON.parse(m.text), manifest);
  assert.equal((await b.get('/icon-192.png?v=2')).headers['content-type'], 'image/png');
  assert.match((await b.get('/offline.html')).headers['content-type'], /^text\/html/);
});

test('everything else still needs a session', async () => {
  const b = door.browser();
  for (const p of ['/', '/index.html', '/app.js', '/sw.js', '/icon-1.png', '/manifest.webmanifest/x']) {
    const r = await b.get(p);
    assert.equal(r.status, 302, p);
    assert.equal(r.headers.location, '/sign-in');
  }
  assert.equal((await b.post('/manifest.webmanifest', {})).status, 401);
});

test('the sign-in page names the manifest, so Install is offered signed out too', async () => {
  const r = await door.browser().get('/sign-in');
  assert.match(r.text, /<link rel="manifest" href="\/manifest.webmanifest">/);
  assert.match(r.text, /<link rel="apple-touch-icon" href="\/apple-touch-icon.png\?v=2">/);
});

test('the manifest has 192 and 512 PNG icons, a maskable one among them, and a wide and a narrow screenshot', () => {
  assert.equal(manifest.id, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.description);
  for (const i of manifest.icons.filter((x) => x.type === 'image/png')) assert.equal(pngSize(file(i.src)), i.sizes, i.src);
  const png = (size, purpose = 'any') => manifest.icons.some((i) => i.type === 'image/png' && i.sizes === size && (i.purpose || 'any') === purpose);
  assert.ok(png('192x192'));
  assert.ok(png('512x512'));
  assert.ok(png('512x512', 'maskable'));
  for (const s of manifest.screenshots) assert.equal(pngSize(file(s.src)), s.sizes, s.src);
  assert.deepEqual(manifest.screenshots.map((s) => s.form_factor).sort(), ['narrow', 'wide']);
});
