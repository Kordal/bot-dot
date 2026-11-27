// An HTML file the owner opens, shown rendered (ADR 281, amending ADR 072): botdot copies the bytes the viewer read into a
// preview store of its own, keyed by their hash, and the sandbox's address serves that copy and nothing else. Its parts:
// the store, the preview's signed address, and the answer to the front door's request for it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const sites = require('../lib/sites');

const scratch = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-preview-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const PAGE = Buffer.from('<h1>Mockup</h1><script>document.title = "hi"</script>');

// What the front door asks of the account's server for one file: GET /sandbox/<token>/<path>.
async function ask(t, lib, p, { known = () => false, method = 'GET' } = {}) {
  const server = http.createServer((req, res) => lib.serve(req, res, known));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const res = await fetch(`http://127.0.0.1:${server.address().port}${p}`, { method });
  return { status: res.status, type: res.headers.get('content-type'), text: await res.text(), headers: res.headers };
}

test('a preview is kept once by the hash of its bytes, in a folder of its own, and at most 1 MB', (t) => {
  const dir = scratch(t);
  const lib = sites.create(dir);
  const a = lib.putPreview(PAGE);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(lib.putPreview(Buffer.from(PAGE)), a, 'the same bytes, the same copy');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'previews')), [`${a}.html`]);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'previews', `${a}.html`)), PAGE);
  assert.notEqual(lib.putPreview(Buffer.from('<p>other</p>')), a);
  assert.throws(() => lib.putPreview(Buffer.alloc(sites.PREVIEW_MAX + 1)), /too large/i);
  assert.equal(fs.readdirSync(path.join(dir, 'previews')).length, 2, 'nothing left of the one refused');
});

test('a preview ends with its address: copies older than an address lasts are removed when another is made', (t) => {
  const dir = scratch(t);
  const lib = sites.create(dir);
  const old = lib.putPreview(Buffer.from('<p>old</p>'));
  const file = path.join(dir, 'previews', `${old}.html`);
  const long = (Date.now() - sites.TOKEN_MS - 60_000) / 1000;
  fs.utimesSync(file, long, long);
  const fresh = lib.putPreview(PAGE);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'previews')), [`${fresh}.html`]);
  // Opened again, a copy that is kept lasts again.
  const mid = (Date.now() - sites.TOKEN_MS / 2) / 1000;
  fs.utimesSync(path.join(dir, 'previews', `${fresh}.html`), mid, mid);
  lib.putPreview(PAGE);
  assert.ok(fs.statSync(path.join(dir, 'previews', `${fresh}.html`)).mtimeMs > Date.now() - 60_000);
});

test('a preview keeps at most a hundred copies, the oldest going first', (t) => {
  const dir = scratch(t);
  const lib = sites.create(dir);
  const first = lib.putPreview(Buffer.from('<p>0</p>'));
  const at = (Date.now() - 3_600_000) / 1000;
  fs.utimesSync(path.join(dir, 'previews', `${first}.html`), at, at);
  for (let i = 1; i <= sites.PREVIEWS_KEPT; i++) lib.putPreview(Buffer.from(`<p>${i}</p>`));
  const names = fs.readdirSync(path.join(dir, 'previews'));
  assert.equal(names.length, sites.PREVIEWS_KEPT);
  assert.ok(!names.includes(`${first}.html`));
});

test("a preview's address names that preview and nothing else: it is no page's, and a page's is not its", () => {
  const hash = 'a'.repeat(64);
  const { token, expires } = sites.signPreview(hash);
  assert.deepEqual(sites.verifyPreview(token), { hash });
  assert.ok(Date.parse(expires) - Date.now() <= sites.TOKEN_MS + 1000);
  assert.equal(sites.verify(token), null, 'not the address of a page');
  const page = sites.sign({ botId: 'b1', slug: 'roadmap', version: 2 }).token;
  assert.equal(sites.verifyPreview(page), null, 'a page address opens no preview');
  assert.equal(sites.verifyPreview(sites.signPreview('not-a-hash').token), null, 'only a hash of this kind');
  assert.equal(sites.verifyPreview(sites.signPreview('../../pages'.padEnd(64, 'a')).token), null);
});

test('a preview address that is wrong or has run out opens nothing', () => {
  const now = Date.now();
  const { token } = sites.signPreview('b'.repeat(64), now);
  assert.equal(sites.verifyPreview(token, now + sites.TOKEN_MS - 1000)?.hash, 'b'.repeat(64));
  assert.equal(sites.verifyPreview(token, now + sites.TOKEN_MS + 1), null, 'ran out');
  const [body, mac] = token.split('.');
  assert.equal(sites.verifyPreview(`${body}.${mac.replace(/.$/, mac.endsWith('A') ? 'B' : 'A')}`), null, 'a changed signature');
  const other = Buffer.from(JSON.stringify({ k: 'p', h: 'c'.repeat(64), e: now + sites.TOKEN_MS })).toString('base64url');
  assert.equal(sites.verifyPreview(`${other}.${mac}`), null, 'a changed body');
  assert.equal(sites.verifyPreview(''), null);
  assert.equal(sites.verifyPreview(undefined), null);
});

test("the sandbox serves a preview's one file as a page, and no other path of it", async (t) => {
  const dir = scratch(t);
  const lib = sites.create(dir);
  const hash = lib.putPreview(PAGE);
  const { token } = sites.signPreview(hash);
  const own = await ask(t, lib, `/sandbox/${token}/index.html`);
  assert.equal(own.status, 200);
  assert.equal(own.text, PAGE.toString());
  assert.equal(own.type, 'text/html; charset=utf-8');
  assert.equal(own.headers.get('cache-control'), 'private, no-cache');
  assert.equal((await ask(t, lib, `/sandbox/${token}/`)).text, PAGE.toString(), 'its folder is the file');
  assert.equal((await ask(t, lib, `/sandbox/${token}/index.html`, { method: 'HEAD' })).status, 200);
  assert.equal((await ask(t, lib, `/sandbox/${token}/index.html`, { method: 'POST' })).status, 405);
  for (const p of ['app.js', 'style.css', 'data.json', 'assets/logo.svg', `${hash}.html`, '..%2Fpages.json', '%2e%2e%2findex.html', 'index.htm']) {
    const r = await ask(t, lib, `/sandbox/${token}/${p}`);
    assert.equal(r.status, 404, `${p}: ${r.status} ${r.text}`);
    assert.doesNotMatch(r.text, /Mockup/);
  }
});

test("a preview's address serves that preview, and another file in the same folder stays unseen", async (t) => {
  const dir = scratch(t);
  const lib = sites.create(dir);
  const one = lib.putPreview(PAGE);
  const two = lib.putPreview(Buffer.from('<p>two</p>'));
  fs.writeFileSync(path.join(dir, 'previews', 'notes.txt'), 'private');
  fs.mkdirSync(path.join(dir, 'sites', 'b1', 'roadmap', '1'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sites', 'b1', 'roadmap', '1', 'index.html'), '<h1>a page</h1>');
  assert.equal((await ask(t, lib, `/sandbox/${sites.signPreview(one).token}/index.html`)).text, PAGE.toString());
  assert.equal((await ask(t, lib, `/sandbox/${sites.signPreview(two).token}/index.html`)).text, '<p>two</p>');
  // A hash nobody put (or a copy swept) is not found, never read from somewhere else.
  const none = await ask(t, lib, `/sandbox/${sites.signPreview('d'.repeat(64)).token}/index.html`);
  assert.equal(none.status, 404);
  // A page's own address still names its page: the preview store does not answer for it.
  const page = sites.sign({ botId: 'b1', slug: 'roadmap', version: 1 }).token;
  assert.equal((await ask(t, lib, `/sandbox/${page}/index.html`, { known: () => true })).text, '<h1>a page</h1>');
  assert.equal((await ask(t, lib, `/sandbox/${page}/index.html`, { known: () => false })).status, 404);
});

test('a tampered or run-out preview address is refused, and the copy is not read', async (t) => {
  const dir = scratch(t);
  const lib = sites.create(dir);
  const hash = lib.putPreview(PAGE);
  const { token } = sites.signPreview(hash);
  const forged = token.replace(/.$/, token.endsWith('A') ? 'B' : 'A');
  const bad = await ask(t, lib, `/sandbox/${forged}/index.html`);
  assert.equal(bad.status, 403);
  assert.doesNotMatch(bad.text, /Mockup/);
  const ran = sites.signPreview(hash, Date.now() - sites.TOKEN_MS - 1000).token;
  const out = await ask(t, lib, `/sandbox/${ran}/index.html`);
  assert.equal(out.status, 403);
  assert.doesNotMatch(out.text, /Mockup/);
  assert.equal((await ask(t, lib, `/sandbox/not-a-token/index.html`)).status, 403);
  // A copy removed while its address still works: not found.
  fs.rmSync(path.join(dir, 'previews', `${hash}.html`));
  assert.equal((await ask(t, lib, `/sandbox/${token}/index.html`)).status, 404);
});

test('a copy that is a link is not served', async (t) => {
  const dir = scratch(t);
  const lib = sites.create(dir);
  const secret = path.join(dir, 'secret.txt');
  fs.writeFileSync(secret, 'the vault');
  const hash = 'e'.repeat(64);
  fs.mkdirSync(path.join(dir, 'previews'), { recursive: true });
  fs.symlinkSync(secret, path.join(dir, 'previews', `${hash}.html`));
  const r = await ask(t, lib, `/sandbox/${sites.signPreview(hash).token}/index.html`);
  assert.equal(r.status, 404);
  assert.doesNotMatch(r.text, /vault/);
});

// ---------- a bundle: the HTML file's folder (ADR 282, amending ADR 281) ----------

const fileView = require('../lib/file-view');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const f = (p, text = p) => ({ path: p, data: Buffer.from(text) });
const FOLDER = () => [f('index.html', 'old index'), f('style.css', 'h1{color:red}'), f('app.js', 'console.log(1)'), f('img/logo.png', 'PNG'), f('data.bin', 'no'), f('.env', 'secret'), f('my notes.txt', 'spaces'), f('notes.txt', 'ok')];
const BYTES = Buffer.from('<link rel=stylesheet href=style.css><h1>Mockup</h1>');

test('a folder becomes a bundle of what a page may hold, with the file the owner opened as it was read', () => {
  const files = sites.previewBundle(FOLDER(), 'index.html', BYTES);
  assert.deepEqual(files.map((x) => x.path), ['app.js', 'img/logo.png', 'index.html', 'notes.txt', 'style.css'], 'allowed kinds and plain names, sorted: no .bin, no dot file, no name with a space');
  assert.deepEqual(files.find((x) => x.path === 'index.html').data, BYTES, "the entry is the bytes the viewer read, not a second read of the folder's");
  // The entry may be missing from the folder's list (it was named another way) and is then added.
  assert.ok(sites.previewBundle([f('style.css')], 'page.html', BYTES).some((x) => x.path === 'page.html'));
  assert.ok(sites.previewBundle([f('a.html'), f('b.HTM')], 'b.HTM', BYTES).some((x) => x.path === 'b.HTM'), 'an .HTM entry');
});

test('a folder over the limits, or an entry that is no plain file name, is no bundle: the preview stays the one file', () => {
  const many = Array.from({ length: sites.MAX_FILES + 1 }, (_, i) => f(`f${i}.txt`));
  assert.equal(sites.previewBundle(many, 'index.html', BYTES), null, 'more than 300 files, whatever their kind');
  assert.ok(sites.previewBundle(many.slice(0, sites.MAX_FILES - 1), 'index.html', BYTES), 'at 300 it is one');
  assert.equal(sites.previewBundle(Array.from({ length: sites.MAX_FILES + 1 }, (_, i) => f(`f${i}.bin`)), 'index.html', BYTES), null, 'the files that are not kept count too');
  const big = { path: 'big.png', data: Buffer.alloc(sites.MAX_BYTES) };
  assert.equal(sites.previewBundle([big], 'index.html', BYTES), null, 'over 5 MB with the entry');
  assert.ok(sites.previewBundle([{ path: 'big.png', data: Buffer.alloc(sites.MAX_BYTES - BYTES.length) }], 'index.html', BYTES), 'exactly 5 MB');
  for (const entry of ['my page.html', '.page.html', '../index.html', '/index.html', 'sub/index.html', 'index.txt', '', 'a\\b.html']) assert.equal(sites.previewBundle([f('style.css')], entry, BYTES), null, entry);
  assert.equal(sites.previewBundle([f('data.bin'), f('.env')], 'index.html', BYTES), null, 'nothing beside it that a page may hold: the one file');
  assert.equal(sites.previewBundle([f('index.html')], 'index.html', BYTES), null, 'only itself');
  assert.equal(sites.previewBundle(null, 'index.html', BYTES), null);
  assert.equal(sites.previewBundle(FOLDER(), 'index.html', 'text'), null, 'bytes are a buffer');
});

test('a bundle is kept once under the hash of its sorted paths and file hashes, whatever the entry or the order', (t) => {
  const dir = scratch(t);
  const lib = sites.create(dir);
  const a = sites.previewBundle(FOLDER(), 'index.html', BYTES);
  const hash = lib.putBundle(a);
  assert.match(hash, /^[0-9a-f]{64}$/);
  const manifest = a.map((x) => `${x.path}\0${crypto.createHash('sha256').update(x.data).digest('hex')}\n`).join('');
  assert.equal(hash, crypto.createHash('sha256').update(manifest).digest('hex'), 'sha256 over the sorted manifest of path and file hash');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'previews')), [hash]);
  assert.equal(fs.readFileSync(path.join(dir, 'previews', hash, 'img', 'logo.png'), 'utf8'), 'PNG');
  assert.equal(fs.readFileSync(path.join(dir, 'previews', hash, 'style.css'), 'utf8'), 'h1{color:red}');
  assert.equal(lib.putBundle([...a].reverse()), hash, 'the same files, the same copy');
  assert.equal(lib.putBundle(a.map((x) => ({ ...x, data: Buffer.from(x.data) }))), hash);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'previews')), [hash], 'nothing else made');
  const other = sites.previewBundle([f('style.css', 'h1{color:blue}'), ...FOLDER().slice(2)], 'index.html', BYTES);
  assert.notEqual(lib.putBundle(other), hash, 'a changed file is another bundle');
  assert.notEqual(lib.putBundle(sites.previewBundle(FOLDER(), 'index.html', Buffer.from('<p>another</p>'))), hash, 'so is a changed entry');
  assert.equal(fs.readdirSync(path.join(dir, 'previews')).length, 3);
  assert.equal(sites.bundleHash(a), hash);
});

test('a bundle holds only what a page may: a path with .., an absolute one or a kind that is not allowed is refused', (t) => {
  const dir = scratch(t);
  const lib = sites.create(dir);
  for (const bad of ['../x.html', '/etc/passwd.txt', 'a/../b.css', '.hidden.css', 'x.exe', 'a b.css']) assert.throws(() => lib.putBundle([f('index.html'), f(bad)]), /not one a page may hold/, bad);
  assert.throws(() => lib.putBundle([]), /not one a page may hold/);
  assert.throws(() => lib.putBundle(Array.from({ length: sites.MAX_FILES + 1 }, (_, i) => f(`f${i}.txt`))), /not one a page may hold/);
  assert.deepEqual(fs.existsSync(path.join(dir, 'previews')) ? fs.readdirSync(path.join(dir, 'previews')) : [], [], 'nothing was written, outside the folder either');
  assert.equal(fs.existsSync(path.join(dir, 'x.html')), false);
});

test('a bundle ends with its address, and at most twenty are kept, the oldest going first, beside the single copies', (t) => {
  const dir = scratch(t);
  const lib = sites.create(dir);
  const put = (n) => lib.putBundle(sites.previewBundle([f('style.css', `${n}`)], 'index.html', Buffer.from(`<p>${n}</p>`)));
  const old = put('old');
  const long = (Date.now() - sites.TOKEN_MS - 60_000) / 1000;
  fs.utimesSync(path.join(dir, 'previews', old), long, long);
  const fresh = put('fresh');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'previews')), [fresh], 'what ran out goes when another is put');
  // Put again, it lasts again.
  const mid = (Date.now() - sites.TOKEN_MS / 2) / 1000;
  fs.utimesSync(path.join(dir, 'previews', fresh), mid, mid);
  put('fresh');
  assert.ok(fs.statSync(path.join(dir, 'previews', fresh)).mtimeMs > Date.now() - 60_000);
  const single = lib.putPreview(PAGE);
  const first = put('0');
  const at = (Date.now() - 3_600_000) / 1000;
  fs.utimesSync(path.join(dir, 'previews', first), at, at);
  for (let i = 1; i <= sites.BUNDLES_KEPT; i++) put(`n${i}`);
  const names = fs.readdirSync(path.join(dir, 'previews'));
  assert.equal(names.filter((n) => !n.endsWith('.html')).length, sites.BUNDLES_KEPT);
  assert.ok(!names.includes(first), 'the oldest went');
  assert.ok(names.includes(`${single}.html`), 'a single copy is not counted among the bundles');
});

test('the sweep, on put and at start, removes what is not a copy: other names, a folder where a file goes, a link', (t) => {
  const dir = scratch(t);
  const previews = path.join(dir, 'previews');
  fs.mkdirSync(path.join(previews, 'not-a-hash'), { recursive: true });
  fs.mkdirSync(path.join(previews, `${'1'.repeat(64)}.html`));
  fs.mkdirSync(path.join(previews, `${'2'.repeat(64)}.3a4b5c6d.tmp`));
  fs.writeFileSync(path.join(previews, '3'.repeat(64)), 'a file where a bundle goes');
  fs.symlinkSync(dir, path.join(previews, '4'.repeat(64)));
  const keep = path.join(previews, '5'.repeat(64));
  fs.mkdirSync(keep);
  fs.writeFileSync(path.join(keep, 'index.html'), 'ok');
  sites.create(dir); // start
  assert.deepEqual(fs.readdirSync(previews), ['5'.repeat(64)]);
  assert.ok(fs.existsSync(dir), 'a link is removed, never followed');
});

test("a bundle's address names that bundle and its entry, and opens no page, no single copy and no other bundle", () => {
  const hash = 'a'.repeat(64);
  const { token, expires } = sites.signBundle(hash, 'index.html');
  assert.deepEqual(sites.verifyBundle(token), { hash, entry: 'index.html' });
  assert.ok(Date.parse(expires) - Date.now() <= sites.TOKEN_MS + 1000);
  assert.equal(sites.verify(token), null, 'not the address of a page');
  assert.equal(sites.verifyPreview(token), null, 'not the address of a single copy');
  assert.equal(sites.verifyBundle(sites.signPreview(hash).token), null, "a single copy's address opens no bundle");
  assert.equal(sites.verifyBundle(sites.sign({ botId: 'b1', slug: 'roadmap', version: 2 }).token), null, "a page's address opens no bundle");
  assert.equal(sites.verifyBundle(sites.signBundle('not-a-hash', 'index.html').token), null);
  for (const entry of ['../index.html', '/index.html', 'a/b.html', '.x.html', 'a b.html', 'index.txt', '', 'a\\b.html']) assert.equal(sites.verifyBundle(sites.signBundle(hash, entry).token), null, entry);
  // Run out, changed by a character, changed in its body.
  const now = Date.now();
  const t = sites.signBundle(hash, 'about.html', now).token;
  assert.equal(sites.verifyBundle(t, now + sites.TOKEN_MS - 1000)?.entry, 'about.html');
  assert.equal(sites.verifyBundle(t, now + sites.TOKEN_MS + 1), null, 'ran out');
  const [body, mac] = t.split('.');
  assert.equal(sites.verifyBundle(`${body}.${mac.replace(/.$/, mac.endsWith('A') ? 'B' : 'A')}`), null);
  const other = Buffer.from(JSON.stringify({ k: 'b', h: 'c'.repeat(64), n: 'about.html', e: now + sites.TOKEN_MS })).toString('base64url');
  assert.equal(sites.verifyBundle(`${other}.${mac}`), null, 'a body for another bundle with the first one signature');
  assert.equal(sites.verifyBundle(''), null);
});

async function bundled(t, entry = 'index.html', files = FOLDER(), bytes = BYTES) {
  const dir = scratch(t);
  const lib = sites.create(dir);
  const hash = lib.putBundle(sites.previewBundle(files, entry, bytes));
  return { dir, lib, hash, token: sites.signBundle(hash, entry).token };
}

test("the sandbox serves a bundle's files, each as its own kind, with no other path of it", async (t) => {
  const { lib, token } = await bundled(t);
  const base = `/sandbox/${token}`;
  const page = await ask(t, lib, `${base}/index.html`);
  assert.equal(page.status, 200);
  assert.equal(page.text, BYTES.toString(), 'the entry as it was read, not the folder\'s old index');
  assert.equal(page.type, 'text/html; charset=utf-8');
  assert.equal((await ask(t, lib, `${base}/`)).text, BYTES.toString(), 'the folder itself is its index.html');
  const css = await ask(t, lib, `${base}/style.css`);
  assert.deepEqual([css.status, css.type, css.text], [200, 'text/css; charset=utf-8', 'h1{color:red}']);
  assert.deepEqual([(await ask(t, lib, `${base}/app.js`)).type, (await ask(t, lib, `${base}/img/logo.png`)).type, (await ask(t, lib, `${base}/img/logo.png`)).text], ['text/javascript; charset=utf-8', 'image/png', 'PNG']);
  assert.equal((await ask(t, lib, `${base}/./style.css`)).text, 'h1{color:red}');
  assert.equal((await ask(t, lib, `${base}/style.css`, { method: 'HEAD' })).status, 200);
  assert.equal((await ask(t, lib, `${base}/style.css`, { method: 'POST' })).status, 405);
  assert.equal((await ask(t, lib, `${base}/style.css`)).headers.get('cache-control'), 'private, no-cache');
});

test("a file that is not in the bundle is not found: what was left out, a path that leaves the bundle, an absolute one", async (t) => {
  const { dir, lib, token } = await bundled(t);
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'the vault');
  fs.writeFileSync(path.join(dir, 'previews', 'loose.css'), 'loose');
  const base = `/sandbox/${token}`;
  for (const p of ['nope.css', 'data.bin', '.env', 'my%20notes.txt', 'img/', 'img', 'img/other.png', 'sub/style.css', 'style.css/x',
    '..%2Fsecret.txt', '..%2F..%2Fsecret.txt', '%2e%2e%2fsecret.txt', '..%5Csecret.txt', '/secret.txt', '%2Fsecret.txt', '%2Fetc%2Fpasswd', '/etc/passwd', '..%2Floose.css', 'img/..%2F..%2Fsecret.txt', 'style.css%00.png', '%00', `${'a'.repeat(300)}.css`]) {
    const r = await ask(t, lib, `${base}/${p}`);
    assert.equal(r.status, 404, `${p}: ${r.status} ${r.text}`);
    assert.doesNotMatch(r.text, /vault|loose|Mockup/);
  }
  // A path of the folder the bundle is in (the hash's name, the store itself) is not one of its files either.
  assert.equal((await ask(t, lib, `${base}/${'a'.repeat(64)}/index.html`)).status, 404);
});

test("a bundle's address opens that bundle only: not another bundle, not a single copy, not a page", async (t) => {
  const one = await bundled(t, 'index.html', [f('style.css', 'ONE-CSS'), f('only-one.js', 'ONE')], Buffer.from('<p>one</p>'));
  const lib = one.lib;
  const two = lib.putBundle(sites.previewBundle([f('style.css', 'TWO-CSS'), f('only-two.js', 'TWO')], 'index.html', Buffer.from('<p>two</p>')));
  const single = lib.putPreview(PAGE);
  fs.mkdirSync(path.join(one.dir, 'sites', 'b1', 'roadmap', '1'), { recursive: true });
  fs.writeFileSync(path.join(one.dir, 'sites', 'b1', 'roadmap', '1', 'index.html'), '<h1>a page</h1>');
  const tokenTwo = sites.signBundle(two, 'index.html').token;
  assert.equal((await ask(t, lib, `/sandbox/${one.token}/style.css`)).text, 'ONE-CSS');
  assert.equal((await ask(t, lib, `/sandbox/${tokenTwo}/style.css`)).text, 'TWO-CSS');
  assert.equal((await ask(t, lib, `/sandbox/${one.token}/only-two.js`)).status, 404, "one's address holds none of two's files");
  assert.equal((await ask(t, lib, `/sandbox/${tokenTwo}/only-one.js`)).status, 404);
  // A hash is no path: the other bundle can't be asked for by name from the first one's address.
  for (const p of [`..%2F${two}%2Fstyle.css`, `${two}/style.css`]) assert.equal((await ask(t, lib, `/sandbox/${one.token}/${p}`)).status, 404, p);
  // The address of a bundle whose hash was never put (or was swept) finds nothing, and it never falls back to a single copy or a page.
  assert.equal((await ask(t, lib, `/sandbox/${sites.signBundle('d'.repeat(64), 'index.html').token}/index.html`)).status, 404);
  assert.equal((await ask(t, lib, `/sandbox/${sites.signBundle(single, 'index.html').token}/index.html`)).status, 404, 'a single copy is no bundle');
  assert.equal((await ask(t, lib, `/sandbox/${sites.signPreview(one.hash).token}/index.html`)).status, 404, 'a bundle is no single copy');
  assert.equal((await ask(t, lib, `/sandbox/${sites.signPreview(one.hash).token}/style.css`)).status, 404);
  const page = sites.sign({ botId: 'b1', slug: 'roadmap', version: 1 }).token;
  assert.equal((await ask(t, lib, `/sandbox/${page}/style.css`, { known: () => true })).status, 404, 'a page address opens no bundle');
  assert.equal((await ask(t, lib, `/sandbox/${page}/index.html`, { known: () => true })).text, '<h1>a page</h1>');
  // Wrong or run-out: refused before any file is looked for.
  const forged = one.token.replace(/.$/, one.token.endsWith('A') ? 'B' : 'A');
  const bad = await ask(t, lib, `/sandbox/${forged}/style.css`);
  assert.equal(bad.status, 403);
  assert.doesNotMatch(bad.text, /ONE/);
  assert.equal((await ask(t, lib, `/sandbox/${sites.signBundle(one.hash, 'index.html', Date.now() - sites.TOKEN_MS - 1000).token}/style.css`)).status, 403);
});

test('an entry beside an index.html of its own is served by its name, the folder itself and index.html being the other page', async (t) => {
  const files = [f('index.html', '<h1>home</h1>'), f('style.css')];
  const { lib, hash, token } = await bundled(t, 'about.html', files, Buffer.from('<h1>about</h1>'));
  assert.equal(lib.frameNameOf(hash, 'about.html'), 'about.html', 'its frame ends in its own name');
  assert.equal((await ask(t, lib, `/sandbox/${token}/about.html`)).text, '<h1>about</h1>');
  assert.equal((await ask(t, lib, `/sandbox/${token}/index.html`)).text, '<h1>home</h1>', 'a link to index.html goes there');
  assert.equal((await ask(t, lib, `/sandbox/${token}/`)).text, '<h1>home</h1>');
});

test("an entry with no index.html beside it is also served as index.html, so its frame ends in the name every app takes", async (t) => {
  const { lib, hash, token } = await bundled(t, 'page.html', [f('style.css'), f('other.html', '<p>other</p>')], Buffer.from('<h1>page</h1>'));
  assert.equal(lib.frameNameOf(hash, 'page.html'), 'index.html');
  for (const p of ['index.html', '', 'page.html']) assert.equal((await ask(t, lib, `/sandbox/${token}/${p}`)).text, '<h1>page</h1>', p);
  assert.equal((await ask(t, lib, `/sandbox/${token}/other.html`)).text, '<p>other</p>');
  const same = await bundled(t, 'index.html');
  assert.equal(same.lib.frameNameOf(same.hash, 'index.html'), 'index.html');
});

test('a bundle file that is a link is not served, and a bundle removed while its address works is not found', async (t) => {
  const { dir, lib, hash, token } = await bundled(t);
  const secret = path.join(dir, 'secret.txt');
  fs.writeFileSync(secret, 'the vault');
  fs.symlinkSync(secret, path.join(dir, 'previews', hash, 'link.txt'));
  fs.symlinkSync(dir, path.join(dir, 'previews', hash, 'img', 'up'));
  for (const p of ['link.txt', 'img/up/secret.txt']) {
    const r = await ask(t, lib, `/sandbox/${token}/${p}`);
    assert.equal(r.status, 404, p);
    assert.doesNotMatch(r.text, /vault/);
  }
  fs.rmSync(path.join(dir, 'previews', hash), { recursive: true });
  assert.equal((await ask(t, lib, `/sandbox/${token}/style.css`)).status, 404);
});

test("the folder of a file on this server is read for the bundle: every file counted, links and special files refused, only the kept read", async (t) => {
  const dir = scratch(t);
  const keep = sites.keepable;
  const site = path.join(dir, 'site');
  fs.mkdirSync(path.join(site, 'img'), { recursive: true });
  fs.mkdirSync(path.join(site, '.git'));
  fs.writeFileSync(path.join(site, 'index.html'), 'i');
  fs.writeFileSync(path.join(site, 'img', 'a.png'), 'a');
  fs.writeFileSync(path.join(site, 'movie.mp4'), 'm');
  const limits = { maxFiles: sites.MAX_FILES, maxBytes: sites.MAX_BYTES, keep };
  const got = await fileView.readFolder(site, limits);
  assert.deepEqual(got.map((x) => x.path).sort(), ['img/a.png', 'index.html'], 'the allowed files, with their paths');
  assert.equal(got.find((x) => x.path === 'img/a.png').data.toString(), 'a');
  // Counted, not only the kept: a folder of 4 files with a limit of 3 is no bundle, nor is one over the bytes.
  assert.equal(await fileView.readFolder(site, { ...limits, maxFiles: 2 }), null);
  assert.ok(await fileView.readFolder(site, { ...limits, maxFiles: 3 }));
  assert.equal(await fileView.readFolder(site, { ...limits, maxBytes: 2 }), null, 'every file counts toward the bytes');
  // A link anywhere refuses the whole folder.
  fs.writeFileSync(path.join(dir, 'outside.txt'), 'out');
  fs.symlinkSync(path.join(dir, 'outside.txt'), path.join(site, 'img', 'link.png'));
  assert.equal(await fileView.readFolder(site, limits), null);
  fs.rmSync(path.join(site, 'img', 'link.png'));
  fs.symlinkSync(dir, path.join(site, 'up'));
  assert.equal(await fileView.readFolder(site, limits), null, 'a link to a folder');
  fs.rmSync(path.join(site, 'up'));
  assert.ok(await fileView.readFolder(site, limits));
  assert.equal(await fileView.readFolder(path.join(dir, 'nowhere'), limits), null);
  assert.equal(await fileView.readFolder(path.join(site, 'index.html'), limits), null, 'a file is no folder');
  // Folders deeper than a page may keep are not entered.
  let deep = site;
  for (let i = 0; i < 10; i++) deep = path.join(deep, `d${i}`);
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(deep, 'x.css'), 'x');
  assert.deepEqual((await fileView.readFolder(site, limits)).map((x) => x.path).sort(), ['img/a.png', 'index.html']);
});

// The script that readies a folder of the account's computer: GNU find, as the computer has (a Mac's has no -printf).
const gnuFind = (() => { try { execFileSync('find', ['.', '-maxdepth', '0', '-printf', 'x'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const run = (script) => execFileSync('sh', ['-c', script], { encoding: 'utf8' }).trim();

test('the computer folder script answers the real path of a folder inside its roots, and one word for why not', { skip: gnuFind ? false : 'needs GNU find, which the computer has (CI runs it)' }, (t) => {
  const root = fs.realpathSync(scratch(t));
  const site = path.join(root, 'site');
  fs.mkdirSync(path.join(site, 'img'), { recursive: true });
  fs.writeFileSync(path.join(site, 'index.html'), 'i');
  fs.writeFileSync(path.join(site, 'img', 'a.png'), 'a');
  fs.symlinkSync(site, path.join(root, 'alias'));
  const ask1 = (p, more = {}) => run(fileView.folderScript(p, { roots: [root], ...more }));
  assert.equal(ask1(site), `ok ${site}`);
  assert.equal(ask1(path.join(root, 'alias')), `ok ${site}`, 'a link to a folder is followed by the script, which says where it really is');
  assert.equal(ask1(root), `ok ${root}`, 'a root itself');
  assert.equal(ask1(path.join(root, 'nowhere')), 'gone');
  assert.equal(ask1(path.join(site, 'index.html')), 'not-folder');
  assert.equal(ask1(os.tmpdir()), 'outside');
  assert.equal(ask1(`${root}/../`), 'outside');
  assert.equal(ask1(site, { maxFiles: 1 }), 'many');
  assert.equal(ask1(site, { maxBytes: 1 }), 'many');
  assert.equal(ask1(site, { maxFiles: 2, maxBytes: 2 }), `ok ${site}`);
  assert.equal(ask1(`${site}'; echo hacked; echo '`), 'gone', 'the path is one quoted word');
  assert.equal(fileView.folderAnswer(`ok ${site}\n`), site);
  assert.throws(() => fileView.folderAnswer('many\n'), /can't be copied/);
  assert.throws(() => fileView.folderAnswer('outside'), /can't be copied/);
  assert.throws(() => fileView.folderAnswer('ok relative/path'), /can't be copied/);
  assert.throws(() => fileView.folderAnswer(''), /can't be copied/);
});
