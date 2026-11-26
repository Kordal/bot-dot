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
