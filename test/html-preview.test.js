// An HTML file the owner opens is shown rendered (ADR 281, amending ADR 072), end to end: the real front door with the
// sandbox's own address, and an account's real botdot server. The viewer's answer for the file carries a signed address
// on the sandbox's own address, where a copy of the bytes it read is served with the sandbox's rules; the file is never
// served as a page on botdot's own address, and without a sandbox address there is no preview. Since ADR 282 the copy is the
// file's folder, the allowed files of it as one bundle, so what the page loads from beside it is served too.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor } = require('./front-door-helpers');
const { startServer, makeBot, freePort, fakeDocker } = require('./helpers');
const fileView = require('../lib/file-view');
const siteKit = require('../lib/site-kit');

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
  // The neighbours a page loads (ADR 282): a style sheet, a script, a picture in a folder, and what a page may not hold.
  fs.writeFileSync(path.join(ws, 'site-mockup', 'style.css'), 'h1 { color: crimson }');
  fs.writeFileSync(path.join(ws, 'site-mockup', 'app.js'), 'document.title = "app"');
  fs.mkdirSync(path.join(ws, 'site-mockup', 'img'));
  fs.writeFileSync(path.join(ws, 'site-mockup', 'img', 'logo.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  fs.writeFileSync(path.join(ws, 'site-mockup', 'data.bin'), 'not a kind a page holds');
  fs.writeFileSync(path.join(ws, 'site-mockup', '.secret'), 'a dot file');
  fs.mkdirSync(path.join(ws, 'site-mockup', '.git'));
  fs.writeFileSync(path.join(ws, 'site-mockup', '.git', 'config'), 'git');
  fs.writeFileSync(path.join(ws, 'private.txt'), 'the folder above is not part of it');
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
  assert.deepEqual(Object.keys(r.data.preview).sort(), ['bundle', 'expires', 'frame'], 'its folder came with it');
  assert.equal(r.data.preview.bundle, true);
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
  // What is not in the folder's bundle is not found: what a page may not hold, a dot file, the folder above.
  for (const p of ['nope.css', 'data.bin', '.secret', '.git/config', 'img/nope.png', '..%2Fprivate.txt', '..%2F..%2Fprivate.txt', '%2Fprivate.txt', '%2Fetc%2Fpasswd']) assert.equal((await site('GET', `${prefix}${p}`)).status, 404, p);
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
  const previewsBefore = fs.existsSync(path.join(ann.data, 'previews')) ? fs.readdirSync(path.join(ann.data, 'previews')).sort() : [];
  const r = await ann.api(`/bots/${bot.id}/path?path=${encodeURIComponent('site-mockup/index.html')}&view=1`);
  assert.equal(r.status, 200);
  assert.equal(r.data.kind, 'text');
  assert.equal(r.data.text, PAGE);
  assert.equal(r.data.preview, undefined);
  assert.deepEqual(fs.existsSync(path.join(ann.data, 'previews')) ? fs.readdirSync(path.join(ann.data, 'previews')).sort() : [], previewsBefore, 'nothing was kept for it, a bundle neither');
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

// ---------- the folder beside the file (ADR 282) ----------

const WS = () => path.join(ann.data, 'workspaces', bot.id);
const folderOf = (rel, files) => {
  for (const [name, data] of Object.entries(files)) {
    const target = path.join(WS(), rel, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
};
const previewOf = async (rel) => (await owner.get(at(rel))).data.preview;
const prefixOf = (frame) => pathOf(frame).replace(/[^/]+$/, '');

test("the sandbox serves the files beside the HTML file, each as its own kind, with the sandbox's rules", async () => {
  const { frame } = await previewOf('site-mockup/index.html');
  const prefix = prefixOf(frame);
  const css = await site('GET', `${prefix}style.css`);
  assert.equal(css.status, 200);
  assert.equal(css.text, 'h1 { color: crimson }');
  assert.equal(css.headers['content-type'], 'text/css; charset=utf-8');
  const js = await site('GET', `${prefix}app.js`);
  assert.deepEqual([js.status, js.headers['content-type'], js.text], [200, 'text/javascript; charset=utf-8', 'document.title = "app"']);
  const png = await site('GET', `${prefix}img/logo.png`);
  assert.deepEqual([png.status, png.headers['content-type']], [200, 'image/png']);
  for (const r of [css, js, png]) {
    assert.match(r.headers['content-security-policy'], /^sandbox allow-scripts; default-src 'none'; /, 'every file carries the sandbox');
    assert.equal(r.headers['set-cookie'], undefined);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
  }
  assert.equal(css.headers['content-security-policy'], (await site('GET', pathOf(frame))).headers['content-security-policy'], 'the CSP is the one of a single file, unchanged: nothing from the internet');
  assert.doesNotMatch(css.headers['content-security-policy'], /https?:\/\/(?!localhost)|\*/);
  // The relative address a page writes, from the frame's own address, is that file.
  assert.equal(new URL('img/logo.png', `http://localhost:${sitesPort}${pathOf(frame)}`).pathname, `${prefix}img/logo.png`);
});

test('the folder is copied once: opening again keeps one bundle, and a changed neighbour is another that leaves the first as it was', async () => {
  const before = new Set(fs.readdirSync(path.join(ann.data, 'previews')));
  const a = (await previewOf('site-mockup/index.html')).frame;
  const b = (await previewOf('site-mockup/index.html')).frame;
  assert.notEqual(a, b, 'an address of its own each time');
  assert.equal(new Set([...fs.readdirSync(path.join(ann.data, 'previews'))].filter((n) => !before.has(n))).size <= 1, true, 'the same files, one copy');
  const count = fs.readdirSync(path.join(ann.data, 'previews')).length;
  await previewOf('site-mockup/index.html');
  assert.equal(fs.readdirSync(path.join(ann.data, 'previews')).length, count, 'nothing new for the same folder');
  const css = path.join(WS(), 'site-mockup', 'style.css');
  fs.writeFileSync(css, 'h1 { color: navy }');
  try {
    const c = (await previewOf('site-mockup/index.html')).frame;
    assert.equal((await site('GET', `${prefixOf(c)}style.css`)).text, 'h1 { color: navy }');
    assert.equal((await site('GET', `${prefixOf(a)}style.css`)).text, 'h1 { color: crimson }', 'an address keeps showing what its opening read');
    assert.equal(fs.readdirSync(path.join(ann.data, 'previews')).length, count + 1);
  } finally { fs.writeFileSync(css, 'h1 { color: crimson }'); }
});

test("the file is the bytes the viewer read, and the folder's other pages are served beside it", async () => {
  folderOf('two-pages', { 'index.html': '<h1>home</h1>', 'about.html': '<h1>about</h1><a href="index.html">home</a>', 'style.css': 'p{}' });
  const about = await previewOf('two-pages/about.html');
  assert.equal(about.bundle, true);
  assert.match(about.frame, /\/about\.html$/, 'beside an index.html of its own, the frame ends in its own name');
  const prefix = prefixOf(about.frame);
  assert.equal((await site('GET', `${prefix}about.html`)).text, '<h1>about</h1><a href="index.html">home</a>');
  assert.equal((await site('GET', `${prefix}index.html`)).text, '<h1>home</h1>', 'a link in it goes to the other page');
  const home = await previewOf('two-pages/index.html');
  assert.match(home.frame, /\/index\.html$/);
  assert.equal((await site('GET', pathOf(home.frame))).text, '<h1>home</h1>');
  // No index.html of its own: the frame ends in the name every app takes.
  folderOf('one-page', { 'page.html': '<h1>page</h1>', 'style.css': 'p{}' });
  const page = await previewOf('one-page/page.html');
  assert.match(page.frame, /\/index\.html$/);
  assert.equal((await site('GET', pathOf(page.frame))).text, '<h1>page</h1>');
  assert.equal((await site('GET', `${prefixOf(page.frame)}page.html`)).text, '<h1>page</h1>');
  assert.equal((await site('GET', `${prefixOf(page.frame)}style.css`)).text, 'p{}');
});

test('a folder over the limits, with a link in it, or that is uploads/ leaves the one file, as before', async () => {
  // More than 300 files, whatever their kind.
  folderOf('many', { 'index.html': '<h1>many</h1>', 'style.css': 'p{}', ...Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`f${i}.bin`, 'x'])) });
  // More than 5 MB.
  folderOf('heavy', { 'index.html': '<h1>heavy</h1>', 'style.css': 'p{}', 'photo.png': Buffer.alloc(5 * 1024 * 1024) });
  // A link out of the folder.
  folderOf('linked', { 'index.html': '<h1>linked</h1>', 'style.css': 'p{}' });
  fs.symlinkSync(path.join(WS(), 'private.txt'), path.join(WS(), 'linked', 'notes.txt'));
  // Where files handed to a bot pile up.
  folderOf('uploads', { 'index.html': '<h1>uploads</h1>', 'style.css': 'p{}' });
  for (const rel of ['many', 'heavy', 'linked', 'uploads']) {
    const r = await owner.get(at(`${rel}/index.html`));
    assert.equal(r.status, 200, `${rel}: ${r.text}`);
    assert.equal(r.data.text, `<h1>${rel}</h1>`);
    assert.ok(r.data.preview?.frame, `${rel}: the file itself is still shown`);
    assert.equal(r.data.preview.bundle, undefined, `${rel}: not a bundle`);
    assert.deepEqual(Object.keys(r.data.preview).sort(), ['expires', 'frame']);
    assert.equal((await site('GET', pathOf(r.data.preview.frame))).text, `<h1>${rel}</h1>`);
    assert.equal((await site('GET', `${prefixOf(r.data.preview.frame)}style.css`)).status, 404, `${rel}: what it loads beside it is not found`);
  }
  // At the limit it is a bundle: 300 files, and exactly 5 MB.
  folderOf('limit', { 'index.html': '<h1>limit</h1>', ...Object.fromEntries(Array.from({ length: 299 }, (_, i) => [`f${i}.txt`, 'x'])) });
  assert.equal((await previewOf('limit/index.html')).bundle, true);
});

test("a bot's workspace root with many files falls back to the one file, the folder above is never read", async () => {
  fs.writeFileSync(path.join(WS(), 'top.html'), '<h1>top</h1>');
  // The workspace holds the folders above and more than 300 files together: no bundle.
  const files = fs.readdirSync(WS());
  assert.ok(files.length > 0);
  folderOf('.', Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`root${i}.txt`, 'x'])));
  const r = await owner.get(at('top.html'));
  assert.equal(r.data.preview.bundle, undefined);
  assert.equal((await site('GET', pathOf(r.data.preview.frame))).text, '<h1>top</h1>');
  assert.equal((await site('GET', `${prefixOf(r.data.preview.frame)}private.txt`)).status, 404);
  for (let i = 0; i < 301; i++) fs.rmSync(path.join(WS(), `root${i}.txt`));
});

test("an address of one bundle opens no other bundle and no page", async () => {
  const a = (await previewOf('site-mockup/index.html')).frame;
  folderOf('other-site', { 'index.html': '<h1>other</h1>', 'other-only.css': 'o{}' });
  const b = (await previewOf('other-site/index.html')).frame;
  assert.equal((await site('GET', `${prefixOf(b)}other-only.css`)).text, 'o{}');
  assert.equal((await site('GET', `${prefixOf(a)}other-only.css`)).status, 404, 'the first address has none of the second folder');
  assert.equal((await site('GET', `${prefixOf(b)}style.css`)).status, 404, 'nor the second of the first');
  // The token's name is not a path: the other bundle can't be reached by it.
  const tokenB = pathOf(b).split('/')[2];
  assert.equal((await site('GET', `${prefixOf(a)}..%2F${tokenB}%2Findex.html`)).status, 404);
  // Not through botdot's own address either: the front door answers for the sandbox only on its own listener.
  const same = await owner.get(`/sandbox/${pathOf(a).split('/')[2]}/style.css`, { 'X-Botdot-Sandbox': '1', 'X-Botdot-Sites': 'http://evil.example' });
  assert.equal(same.status, 404);
  assert.doesNotMatch(same.text, /crimson/);
});

test("a bundle's address that is wrong or has run out is refused, and the front door's own paths are no bundle's", async () => {
  const { frame } = await previewOf('site-mockup/index.html');
  const token = pathOf(frame).split('/')[2];
  const forged = token.replace(/.$/, token.endsWith('A') ? 'B' : 'A');
  assert.equal((await site('GET', `/ann/${forged}/style.css`)).status, 403);
  for (const p of [`/ann/${token}/style.css`, `/api/previews/${token}/style.css`, `/sandbox/${token}/style.css`]) {
    const r = await owner.get(p);
    assert.doesNotMatch(r.text, /crimson/, p);
  }
});

test("an HTML file in a folder on the account's computer is shown with its folder, packed as a page's folder is", async () => {
  const dir = `/workspace/${boxBot.id}/real-site`;
  const tar = siteKit.tar([{ path: 'index.html', data: Buffer.from(PAGE) }, { path: 'style.css', data: Buffer.from('p { margin: 0 }') }, { path: 'img/logo.svg', data: Buffer.from('<svg/>') }, { path: 'movie.mp4', data: Buffer.from('no') }]);
  docker.answer('inspect.json', RUNNING);
  docker.answer('exec.txt', `ok ${Buffer.byteLength(PAGE)} 1760000000\n${Buffer.from(PAGE).toString('base64')}`);
  // The script that readies the folder says where it really is; the pack (its last argument is that folder) gives the tar.
  docker.answer('exec-when.json', JSON.stringify([{ has: '-mindepth', text: `ok ${dir}\n` }, { has: 'real-site', text: tar.toString('latin1') }]));
  const before = docker.calls().length;
  try {
    const r = await owner.get(`/api/bots/${boxBot.id}/path?path=${encodeURIComponent(`/workspace/${boxBot.id}/site-mockup/index.html`)}&view=1`);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.data.text, PAGE);
    assert.equal(r.data.preview?.bundle, true, JSON.stringify(r.data.preview));
    const prefix = prefixOf(r.data.preview.frame);
    assert.equal((await site('GET', pathOf(r.data.preview.frame))).text, PAGE, 'the bytes read, not the pack\'s copy');
    assert.equal((await site('GET', `${prefix}style.css`)).text, 'p { margin: 0 }');
    assert.equal((await site('GET', `${prefix}img/logo.svg`)).headers['content-type'], 'image/svg+xml');
    assert.equal((await site('GET', `${prefix}movie.mp4`)).status, 404, 'a kind a page may not hold is not kept');
    const made = docker.calls().slice(before).filter((c) => c.args[0] === 'exec').map((c) => c.args.at(-1));
    assert.ok(made.some((a) => a === dir), 'the folder is packed by its real path as box');
  } finally {
    docker.answer('exec-when.json', null);
    docker.answer('exec.txt', null);
    docker.answer('inspect.json', null);
  }
});

test("a computer folder that can't be packed, is outside the allowed places, or holds a link leaves the one file", async () => {
  const dir = `/workspace/${boxBot.id}/real-site`;
  // A tar in which the entry of style.css is a symbolic link (type 2): untar refuses the whole folder.
  const link = Buffer.from(siteKit.tar([{ path: 'index.html', data: Buffer.from(PAGE) }, { path: 'style.css', data: Buffer.from('p{}') }]));
  for (let at = 0; at < link.length; at += 512) if (link.subarray(at, at + 9).toString() === 'style.css') link[at + 156] = '2'.charCodeAt(0);
  assert.ok(link.includes(Buffer.from('style.css')));
  docker.answer('inspect.json', RUNNING);
  docker.answer('exec.txt', `ok ${Buffer.byteLength(PAGE)} 1760000000\n${Buffer.from(PAGE).toString('base64')}`);
  const view = async () => (await owner.get(`/api/bots/${boxBot.id}/path?path=${encodeURIComponent(`/workspace/${boxBot.id}/site-mockup/index.html`)}&view=1`));
  try {
    for (const [why, rules] of [
      ['too many files or too large', [{ has: '-mindepth', text: 'many\n' }]],
      ['outside its places', [{ has: '-mindepth', text: 'outside\n' }]],
      ['no answer to the script', [{ has: '-mindepth', text: '' }]],
      ['a pack that failed', [{ has: '-mindepth', text: `ok ${dir}\n` }, { has: 'real-site', text: '' }]],
      ['a link in it', [{ has: '-mindepth', text: `ok ${dir}\n` }, { has: 'real-site', text: link.toString('latin1') }]],
      ['a tar cut off', [{ has: '-mindepth', text: `ok ${dir}\n` }, { has: 'real-site', text: link.subarray(0, 700).toString('latin1') }]],
    ]) {
      docker.answer('exec-when.json', JSON.stringify(rules));
      const r = await view();
      assert.equal(r.status, 200, `${why}: ${r.text}`);
      assert.equal(r.data.text, PAGE, why);
      assert.ok(r.data.preview?.frame, `${why}: the file itself is shown`);
      assert.equal(r.data.preview.bundle, undefined, why);
      assert.equal((await site('GET', `${prefixOf(r.data.preview.frame)}style.css`)).status, 404, why);
    }
  } finally {
    docker.answer('exec-when.json', null);
    docker.answer('exec.txt', null);
    docker.answer('inspect.json', null);
  }
});
