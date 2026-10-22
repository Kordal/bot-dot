// A bot's interactive page (#399, ADR 072), end to end: the real front door with the sandbox's own address, and an
// account's real botdot server. A page's files are served only there, on a signed address made for the owner, with
// the sandbox's rules on every answer; no cookie or header of the browser's reaches botdot, nothing else of botdot
// answers there, and the app's own address never serves the page. Versions roll back; the download is a zip.
// What a browser does with those rules is checked in Chromium by test/browser/interactive-page.cjs.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');
const { startServer, makeBot, freePort } = require('./helpers');

let door, ann, owner, sitesPort, bot;
before(async () => {
  ann = await startServer({ account: 'ann' });
  sitesPort = await freePort();
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann', FRONT_DOOR_SITES_ORIGIN: `http://localhost:${sitesPort}`, FRONT_DOOR_SITES_PORT: String(sitesPort) } });
  fs.symlinkSync(path.dirname(ann.socket), path.join(door.sockets, 'ann'));
  owner = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await owner.post(`${door.firstLink.path}/options`, { name: 'ann' });
  assert.equal((await owner.post(door.firstLink.path, { name: 'ann', credential: key.register(options.data.publicKey) })).status, 201);
  bot = await makeBot(ann, { name: 'Ops' });
  seed(bot.id, 'roadmap', { 1: { 'index.html': '<h1>v1</h1>' }, 2: { 'index.html': '<h1>v2</h1><script src="app.js"></script>', 'app.js': 'fetch("data.json")', 'data.json': '{"done":3}', 'assets/logo.svg': '<svg/>' } });
});
after(async () => {
  await door?.stop();
  if (ann) { await ann.stop(); fs.rmSync(ann.dir, { recursive: true, force: true }); }
});

// A page as publish_interactive_page leaves it: its versions in botdot's data folder, what it is in pages.json.
function seed(botId, slug, versions) {
  const data = path.join(ann.dir, 'data');
  const ns = Object.keys(versions).map(Number).sort((a, b) => b - a);
  for (const n of ns) {
    for (const [file, text] of Object.entries(versions[n])) {
      const at = path.join(data, 'sites', botId, slug, String(n), file);
      fs.mkdirSync(path.dirname(at), { recursive: true });
      fs.writeFileSync(at, text);
    }
  }
  const at = '2026-10-22T07:00:00.000Z';
  const meta = { [botId]: [{ slug, title: 'Roadmap', kind: 'interactive', sources: '', createdAt: at, updatedAt: at, current: ns[0], tiles: [], versions: ns.map((n) => ({ n, at, bytes: 10, files: Object.keys(versions[n]).length })) }] };
  fs.writeFileSync(path.join(data, 'pages.json'), JSON.stringify(meta));
}

// A request on the sandbox's own address, as a browser sends it.
const site = (method, p, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: sitesPort, agent: false, path: p, method, headers: { Host: `localhost:${sitesPort}`, ...headers } }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
  });
  req.on('error', reject);
  req.end();
});
const pathOf = (url) => new URL(url).pathname;

test('the viewer gets the frame on the sandbox\'s own address, signed for the owner, and an older app only the download', async () => {
  const list = await owner.get(`/api/bots/${bot.id}/pages`);
  assert.equal(list.status, 200, list.text);
  assert.deepEqual(list.data.pages.map((p) => [p.slug, p.kind, p.version]), [['roadmap', 'interactive', 2]]);
  const v = (await owner.get(`/api/bots/${bot.id}/pages/roadmap?view=1`)).data;
  assert.equal(v.kind, 'none', 'an app older than #399 shows its "no preview" with the download');
  assert.equal(v.page.kind, 'interactive');
  assert.match(v.interactive.frame, new RegExp(`^http://localhost:${sitesPort}/ann/[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{32}/index\\.html$`));
  assert.ok(Date.parse(v.interactive.expires) - Date.now() <= 30 * 60_000 + 5000, 'short-lived');
  assert.deepEqual(v.interactive.versions.map((x) => x.n), [2, 1]);
  assert.equal(v.interactive.shown, 2);
  const app = await owner.get('/');
  assert.match(app.headers['content-security-policy'], new RegExp(`frame-src 'self' http://localhost:${sitesPort}(;|$)`), 'the web page may frame the sandbox and nothing else new');
});

test("the sandbox's answer: the page's files with its rules, no cookie in or out, and nothing else of botdot", async () => {
  const { frame } = (await owner.get(`/api/bots/${bot.id}/pages/roadmap?view=1`)).data.interactive;
  const prefix = pathOf(frame).replace(/index\.html$/, '');
  const page = await site('GET', pathOf(frame), { Cookie: `botdot_session=${owner.cookie().split('=')[1]}` });
  assert.equal(page.status, 200, page.text);
  assert.equal(page.text, '<h1>v2</h1><script src="app.js"></script>');
  assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
  const csp = page.headers['content-security-policy'];
  assert.match(csp, /^sandbox allow-scripts; default-src 'none'; /, 'no origin of its own: no cookie, storage or API of the app');
  assert.ok(csp.includes(`connect-src http://localhost:${sitesPort}${prefix};`), 'it fetches only its own files');
  assert.ok(csp.includes(`script-src http://localhost:${sitesPort}${prefix} 'unsafe-inline';`));
  assert.ok(csp.includes(`frame-ancestors ${door.origin}`), 'framed by the app alone');
  assert.match(csp, /form-action 'none'/);
  assert.deepEqual([...new Set(csp.match(/https?:\/\/[^\s;]+/g))], [`http://localhost:${sitesPort}${prefix}`, door.origin], 'no other address anywhere in its rules');
  assert.ok(!csp.includes('*'));
  assert.equal(page.headers['access-control-allow-origin'], '*');
  assert.equal(page.headers['referrer-policy'], 'no-referrer');
  assert.equal(page.headers['set-cookie'], undefined);
  assert.equal(page.headers['x-frame-options'], undefined, "botdot's own SAMEORIGIN would keep the app from framing it");
  assert.equal((await site('GET', `${prefix}data.json`)).text, '{"done":3}');
  assert.equal((await site('GET', `${prefix}assets/logo.svg`)).headers['content-type'], 'image/svg+xml');
  assert.equal((await site('GET', `${prefix}assets/`)).status, 404, 'a folder has no index of its own');
  assert.equal((await site('GET', `${prefix}..%2F..%2Fpages.json`)).status, 404, 'nothing outside the version');
  assert.equal((await site('POST', pathOf(frame))).status, 405);
  assert.equal((await site('GET', pathOf(frame), { Host: door.origin.replace('http://', '') })).status, 403, 'only on its own name');
  // Not a page's address: nothing of botdot answers, signed in or not.
  for (const p of ['/api/bots', '/ann/api/bots', `/ann/x.${'a'.repeat(32)}/index.html`, '/', '/sign-in']) {
    const r = await site('GET', p, { Cookie: owner.cookie() });
    assert.ok([403, 404].includes(r.status), `${p}: ${r.status} ${r.text}`);
    assert.doesNotMatch(r.text, /Ops|"bots"/);
  }
  // A token changed by a character is refused by botdot.
  const forged = pathOf(frame).replace(/([A-Za-z0-9_-])(\/index\.html)$/, (_, c, rest) => `${c === 'A' ? 'B' : 'A'}${rest}`);
  assert.equal((await site('GET', forged)).status, 403);
});

test("the app's own address never serves a page, and a browser can't say it asks for one", async () => {
  const { frame } = (await owner.get(`/api/bots/${bot.id}/pages/roadmap?view=1`)).data.interactive;
  const token = pathOf(frame).split('/')[2];
  const r = await owner.get(`/sandbox/${token}/index.html`, { 'X-Botdot-Sandbox': '1', 'X-Botdot-Sites': 'http://evil.example' });
  assert.equal(r.status, 404);
  assert.doesNotMatch(r.text, /v2/);
});

test("the front door passes no cookie or header of the browser's on, and its rules stand whatever botdot answers", async () => {
  const link = (await owner.post('/admin/links', {})).data.url;
  const bob = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await bob.post(`${new URL(link).pathname}/options`, { name: 'bob' });
  assert.equal((await bob.post(new URL(link).pathname, { name: 'bob', credential: key.register(options.data.publicKey) })).status, 201);
  const fake = await standIn(door, 'bob');
  try {
    const token = `${'a'.repeat(20)}.${'b'.repeat(32)}`;
    const r = await site('GET', `/bob/${token}/assets/app.js?x=1`, { Cookie: bob.cookie(), 'X-Botdot-Account': 'ann', 'X-Botdot-Sandbox': '0', 'X-Botdot-Sites': 'http://evil.example', Authorization: 'Bearer x', 'X-Chief-Key': 'k' });
    assert.equal(r.status, 200, `${r.status} ${r.text} ${JSON.stringify(fake.seen)}`);
    assert.match(r.headers['content-security-policy'], /^sandbox allow-scripts; /, "the sandbox's rules, though botdot's answer had none");
    const seen = fake.seen.at(-1);
    assert.equal(seen.url, `/sandbox/${token}/assets/app.js`, 'no query');
    assert.deepEqual(Object.keys(seen.headers).filter((k) => k !== 'connection').sort(), ['host', 'x-botdot-account', 'x-botdot-sandbox']);
    assert.equal(seen.headers['x-botdot-account'], 'bob', 'the account the address names, never the one a browser says');
    assert.equal(seen.headers['x-botdot-sandbox'], '1');
  } finally { fake.close(); }
  // An account's page is asked for under its own name only: no session needed, none taken.
  assert.equal((await site('GET', `/zed/${'a'.repeat(20)}.${'b'.repeat(32)}/index.html`)).status, 404, 'no such account');
});

test('versions: roll back makes an older one the page again, a version shows by itself, and the download is a zip', async () => {
  const back = await owner.post(`/api/bots/${bot.id}/pages/roadmap/versions/1`, {});
  assert.equal(back.status, 200, back.text);
  assert.equal(back.data.page.version, 1);
  const v = (await owner.get(`/api/bots/${bot.id}/pages/roadmap?view=1`)).data.interactive;
  assert.equal(v.current, 1);
  assert.equal((await site('GET', pathOf(v.frame))).text, '<h1>v1</h1>');
  const two = (await owner.get(`/api/bots/${bot.id}/pages/roadmap?view=1&version=2`)).data.interactive;
  assert.equal(two.shown, 2);
  assert.equal((await site('GET', pathOf(two.frame))).text, '<h1>v2</h1><script src="app.js"></script>');
  assert.equal((await owner.post(`/api/bots/${bot.id}/pages/roadmap/versions/7`, {})).status, 404);
  assert.equal((await owner.get(`/api/bots/${bot.id}/pages/roadmap?view=1&version=7`)).status, 404);
  const zip = await owner.get(`/api/bots/${bot.id}/pages/roadmap?version=2`);
  assert.equal(zip.status, 200);
  assert.equal(zip.headers['content-type'], 'application/zip');
  assert.match(zip.headers['content-disposition'], /filename\*=UTF-8''roadmap-v2\.zip/);
  assert.equal(zip.bytes.subarray(0, 4).toString('hex'), '504b0304');
  assert.ok(zip.bytes.includes(Buffer.from('assets/logo.svg')));
  assert.equal((await owner.post(`/api/bots/${bot.id}/pages/roadmap/keep`, { every: 'day' })).status, 400, 'it shows its live values itself');
  await owner.post(`/api/bots/${bot.id}/pages/roadmap/versions/2`, {});
});

test('a page whose bot is gone, or whose version is no longer kept, is not served on an address signed before', async () => {
  const { frame } = (await owner.get(`/api/bots/${bot.id}/pages/roadmap?view=1&version=1`)).data.interactive;
  fs.rmSync(path.join(ann.dir, 'data', 'sites', bot.id, 'roadmap', '1'), { recursive: true });
  assert.equal((await site('GET', pathOf(frame))).status, 404);
});
