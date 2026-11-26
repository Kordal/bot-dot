// An HTML file the owner opens is shown rendered (ADR 281, amending ADR 072), end to end: the real front door with the
// sandbox's own address, and an account's real botdot server. The viewer's answer for the file carries a signed address
// on the sandbox's own address, where a copy of the bytes it read is served with the sandbox's rules; the file is never
// served as a page on botdot's own address, and without a sandbox address there is no preview.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor } = require('./front-door-helpers');
const { startServer, makeBot, freePort, fakeDocker } = require('./helpers');
const fileView = require('../lib/file-view');

let door, ann, owner, sitesPort, bot, docker, boxBot;
const RUNNING = '"running"|"bot-dot/desktop:latest"|"sha256:a"';
const PAGE = '<!doctype html><title>Mockup</title><h1>Acme</h1><script>document.querySelector("h1").textContent = "Acme!"</script>';
before(async () => {
  docker = fakeDocker();
  ann = await startServer({ account: 'ann', env: { PATH: `${docker.bin}${path.delimiter}${process.env.PATH}` } });
  sitesPort = await freePort();
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann', FRONT_DOOR_SITES_ORIGIN: `http://localhost:${sitesPort}`, FRONT_DOOR_SITES_PORT: String(sitesPort) } });
  fs.symlinkSync(path.dirname(ann.socket), path.join(door.sockets, 'ann'));
  owner = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await owner.post(`${door.firstLink.path}/options`, { name: 'ann' });
  assert.equal((await owner.post(door.firstLink.path, { name: 'ann', credential: key.register(options.data.publicKey) })).status, 201);
  bot = await makeBot(ann, { name: 'Website Builder' });
  boxBot = await makeBot(ann, { name: 'Box Builder', computer: 'linux' });
  const ws = path.join(ann.data, 'workspaces', bot.id);
  fs.mkdirSync(path.join(ws, 'site-mockup'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'site-mockup', 'index.html'), PAGE);
  fs.writeFileSync(path.join(ws, 'site-mockup', 'big.html'), `<p>${'x'.repeat(fileView.VIEW_BYTES)}</p>`);
  fs.writeFileSync(path.join(ws, 'site-mockup', 'notes.txt'), '<h1>not a page</h1>');
  fs.writeFileSync(path.join(ws, 'site-mockup', 'README.md'), '<h1>not a page</h1>');
  fs.writeFileSync(path.join(ws, 'site-mockup', 'old.HTM'), '<h1>old</h1>');
});
after(async () => {
  await door?.stop();
  if (ann) { await ann.stop(); fs.rmSync(ann.dir, { recursive: true, force: true }); }
  docker?.remove();
});

const at = (p, more = '&view=1') => `/api/bots/${bot.id}/path?path=${encodeURIComponent(p)}${more}`;
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

test('the server says it can show an HTML file rendered', async () => {
  assert.ok((await ann.api('/version')).data.features.includes('html-preview'));
});

test("an HTML file's view carries the frame's address on the sandbox, next to the source an older app shows", async () => {
  const r = await owner.get(at('site-mockup/index.html'));
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.kind, 'text', 'an app without the preview shows its source');
  assert.equal(r.data.text, PAGE);
  assert.match(r.data.preview.frame, new RegExp(`^http://localhost:${sitesPort}/ann/[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{32}/index\\.html$`));
  assert.ok(Date.parse(r.data.preview.expires) - Date.now() <= 12 * 3_600_000 + 5000, 'short-lived');
  assert.ok(Date.parse(r.data.preview.expires) > Date.now());
  assert.deepEqual(Object.keys(r.data.preview).sort(), ['expires', 'frame']);
  assert.equal(r.data.type, 'text/plain', 'never named as a page');
  assert.ok((await owner.get(at('site-mockup/old.HTM'))).data.preview, 'an .htm file, in any case');
});

test('the sandbox serves what was read as a page, with the sandbox rules, and nothing else of that address', async () => {
  const { frame } = (await owner.get(at('site-mockup/index.html'))).data.preview;
  const prefix = pathOf(frame).replace(/index\.html$/, '');
  const page = await site('GET', pathOf(frame), { Cookie: owner.cookie() });
  assert.equal(page.status, 200, page.text);
  assert.equal(page.text, PAGE);
  assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
  const csp = page.headers['content-security-policy'];
  assert.match(csp, /^sandbox allow-scripts; default-src 'none'; /, 'no origin of its own: no cookie, storage or API of the app');
  assert.ok(csp.includes(`connect-src http://localhost:${sitesPort}${prefix};`));
  assert.ok(csp.includes(`script-src http://localhost:${sitesPort}${prefix} 'unsafe-inline';`));
  assert.ok(csp.includes(`frame-ancestors ${door.origin}`));
  assert.ok(!csp.includes('allow-same-origin'));
  assert.ok(!csp.includes('*'));
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  assert.equal(page.headers['referrer-policy'], 'no-referrer');
  assert.equal(page.headers['set-cookie'], undefined);
  assert.equal(page.headers['x-frame-options'], undefined);
  // Its one file: what it would load by a relative path is not found (siblings are not part of the preview).
  for (const p of ['app.js', 'style.css', 'big.html', 'notes.txt', '..%2Fnotes.txt']) assert.equal((await site('GET', `${prefix}${p}`)).status, 404, p);
  assert.equal((await site('POST', pathOf(frame))).status, 405);
  // A token changed by a character is refused.
  const forged = pathOf(frame).replace(/([A-Za-z0-9_-])(\/index\.html)$/, (_, c, rest) => `${c === 'A' ? 'B' : 'A'}${rest}`);
  assert.equal((await site('GET', forged)).status, 403);
});

test('opening the same file again signs a new address for the same copy, and a changed file is a new copy', async () => {
  const a = (await owner.get(at('site-mockup/index.html'))).data.preview.frame;
  const b = (await owner.get(at('site-mockup/index.html'))).data.preview.frame;
  assert.equal((await site('GET', pathOf(a))).text, PAGE);
  assert.equal((await site('GET', pathOf(b))).text, PAGE);
  const file = path.join(ann.data, 'workspaces', bot.id, 'site-mockup', 'index.html');
  fs.writeFileSync(file, '<h1>second</h1>');
  const c = (await owner.get(at('site-mockup/index.html'))).data.preview.frame;
  assert.equal((await site('GET', pathOf(c))).text, '<h1>second</h1>');
  assert.equal((await site('GET', pathOf(a))).text, PAGE, 'an address keeps showing what its opening read');
  fs.writeFileSync(file, PAGE);
});

test('no preview for what is not an HTML file, what is cut at 1 MB, or a view of its size alone', async () => {
  for (const p of ['site-mockup/notes.txt', 'site-mockup/README.md']) assert.equal((await owner.get(at(p))).data.preview, undefined, p);
  const big = (await owner.get(at('site-mockup/big.html'))).data;
  assert.equal(big.truncated, true);
  assert.equal(big.preview, undefined, 'a page cut short would not be the page');
  const stat = (await owner.get(at('site-mockup/index.html', '&stat=1'))).data;
  assert.equal(stat.preview, undefined);
  assert.equal(stat.text, undefined);
});

test('without a sandbox address on the machine there is no preview: the source, as before', async () => {
  const r = await ann.api(`/bots/${bot.id}/path?path=${encodeURIComponent('site-mockup/index.html')}&view=1`);
  assert.equal(r.status, 200);
  assert.equal(r.data.kind, 'text');
  assert.equal(r.data.text, PAGE);
  assert.equal(r.data.preview, undefined);
  assert.equal(fs.existsSync(path.join(ann.data, 'previews')) && fs.readdirSync(path.join(ann.data, 'previews')).some((n) => !n.endsWith('.html')), false);
});

test("botdot's own address never serves the file as a page: not the download, not the view, not a frame address", async () => {
  const down = await owner.get(at('site-mockup/index.html', ''));
  assert.equal(down.status, 200);
  assert.doesNotMatch(down.headers['content-type'], /html/);
  assert.match(down.headers['content-disposition'], /^attachment/);
  assert.equal(down.headers['content-security-policy'], "sandbox; default-src 'none'");
  const view = await owner.get(at('site-mockup/index.html'));
  assert.match(view.headers['content-type'], /^application\/json/);
  const { frame } = view.data.preview;
  const token = pathOf(frame).split('/')[2];
  const same = await owner.get(`/sandbox/${token}/index.html`, { 'X-Botdot-Sandbox': '1', 'X-Botdot-Sites': 'http://evil.example' });
  assert.equal(same.status, 404);
  assert.doesNotMatch(same.text, /Acme/);
  for (const p of [`/ann/${token}/index.html`, `/api/sandbox/${token}/index.html`, `/api/previews/${token}/index.html`]) {
    const r = await owner.get(p);
    assert.doesNotMatch(r.headers['content-type'] || '', /text\/html; charset=utf-8/, p);
    assert.doesNotMatch(r.text, /Acme!/, p);
  }
});

test('the app may frame the sandbox and still no other address', async () => {
  const app = await owner.get('/');
  assert.match(app.headers['content-security-policy'], new RegExp(`frame-src 'self' http://localhost:${sitesPort}(;|$)`));
});

test("an HTML file on the account's computer is shown rendered too, from a copy of what was read there", async () => {
  docker.answer('inspect.json', RUNNING);
  docker.answer('exec.txt', `ok ${Buffer.byteLength(PAGE)} 1760000000\n${Buffer.from(PAGE).toString('base64')}`);
  const r = await owner.get(`/api/bots/${boxBot.id}/path?path=${encodeURIComponent(`/workspace/${boxBot.id}/site-mockup/index.html`)}&view=1`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.text, PAGE);
  assert.ok(r.data.preview?.frame, 'a frame on the sandbox');
  const page = await site('GET', pathOf(r.data.preview.frame));
  assert.equal(page.status, 200);
  assert.equal(page.text, PAGE, 'the copy, not a read of the computer');
  assert.match(page.headers['content-security-policy'], /sandbox allow-scripts/);
  docker.answer('exec.txt', null);
  docker.answer('inspect.json', null);
});

test("a preview that can't be kept (a full disk, an unwritable folder) leaves the file's source, not an error", async () => {
  const previews = path.join(ann.data, 'previews');
  const moved = `${previews}.aside`;
  if (fs.existsSync(previews)) fs.renameSync(previews, moved);
  fs.writeFileSync(previews, 'not a folder');
  try {
    const r = await owner.get(at('site-mockup/old.HTM'));
    assert.equal(r.status, 200, r.text);
    assert.equal(r.data.text, '<h1>old</h1>');
    assert.equal(r.data.preview, undefined);
  } finally {
    fs.rmSync(previews, { force: true });
    if (fs.existsSync(moved)) fs.renameSync(moved, previews);
  }
});
