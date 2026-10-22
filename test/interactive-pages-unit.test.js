// A bot's interactive page (#399, ADR 072), its parts: what a bundle may hold, reading the folder the computer sends,
// the versions kept, the signed address, the zip, and the computer's own step (a tar of the folder, made by box).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const childProcess = require('child_process');
const sites = require('../lib/sites');
const pagesLib = require('../lib/pages');

const file = (p, text = 'x') => ({ path: p, data: Buffer.from(text) });
const tarOf = (dir) => childProcess.execFileSync('tar', ['--format=ustar', '-cf', '-', '-C', dir, '.']);
const scratch = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-sites-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('a bundle holds index.html at its top and plain files of the kinds a page may serve, within its limits', () => {
  const ok = sites.checkBundle([file('index.html'), file('assets/index-3f2a.js'), file('data.json', '{}'), file('fonts/Geist.woff2')]);
  assert.deepEqual(ok.map((f) => f.path), ['assets/index-3f2a.js', 'data.json', 'fonts/Geist.woff2', 'index.html']);
  assert.throws(() => sites.checkBundle([]), /The folder is empty/);
  assert.throws(() => sites.checkBundle([file('app.js')]), /it has no index\.html at its top/);
  assert.throws(() => sites.checkBundle([file('index.html'), file('run.sh'), file('app.wasm'), file('Makefile')]), /These kinds of files are not allowed: \.sh, \.wasm, Makefile \(no extension\)/);
  assert.throws(() => sites.checkBundle([file('index.html'), file('.env'), file('../x.js'), file('a b.js')]), /These names can't be served: \.env, \.\.\/x\.js, a b\.js/);
  assert.throws(() => sites.checkBundle([file('index.html'), { path: 'big.png', data: Buffer.alloc(sites.MAX_BYTES) }]), /it takes 5\.0 MB: a page holds at most 5 MB/);
  assert.throws(() => sites.checkBundle(Array.from({ length: 301 }, (_, i) => file(`f${i}.js`))), /a page holds at most 300/);
});

test('the folder comes as a tar of plain files: a link or anything else in it refuses the whole folder', (t) => {
  const dir = scratch(t);
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>Roadmap</h1>');
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
  const files = sites.untar(tarOf(dir));
  assert.deepEqual(files.map((f) => [f.path, f.data.toString()]).sort(), [['assets/app.js', 'console.log(1)'], ['index.html', '<h1>Roadmap</h1>']]);
  fs.symlinkSync('/etc/passwd', path.join(dir, 'passwd.txt'));
  assert.throws(() => sites.untar(tarOf(dir)), /passwd\.txt is a link or a special file/);
  assert.throws(() => sites.untar(tarOf(dir).subarray(0, 700)), /cut off|link/);
});

test('versions: each publish a new one, the last ten kept, roll back, and a Markdown page and an interactive one never share a slug', (t) => {
  const data = scratch(t);
  const pages = pagesLib.create(data);
  const ws = path.join(data, 'ws');
  const bundle = (n) => [file('index.html', `<h1>v${n}</h1>`), file('data.json', `{"n":${n}}`)];
  const first = pages.publish('ops', { title: 'Roadmap', files: bundle(1), tiles: ['Disk', 'Disk', ' CI runs '], sources: 'GitHub issues' });
  assert.deepEqual([first.created, first.version, first.page.slug, first.page.kind], [true, 1, 'roadmap', 'interactive']);
  for (let n = 2; n <= 12; n++) assert.equal(pages.publish('ops', { page: 'roadmap', files: bundle(n) }).version, n);
  const { page, site } = pages.find('ops', ws, 'roadmap');
  assert.equal(page.version, 12);
  assert.deepEqual(site.versions.map((v) => v.n), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  assert.deepEqual(site.tiles, ['Disk', 'CI runs'], 'kept from the first publish');
  assert.ok(!fs.existsSync(path.join(data, 'sites', 'ops', 'roadmap', '2')), 'older versions go from the disk');
  assert.equal(pages.setCurrent('ops', 'roadmap', 5).version, 5);
  assert.equal(fs.readFileSync(pages.sites.fileOf('ops', 'roadmap', 5, '').file, 'utf8'), '<h1>v5</h1>');
  assert.throws(() => pages.setCurrent('ops', 'roadmap', 2), /Version 2 of this page is no longer kept/);
  assert.equal(pages.hasVersion('ops', 'roadmap', 5), true);
  assert.equal(pages.hasVersion('ops', 'roadmap', 2), false);
  assert.equal(pages.hasVersion('other', 'roadmap', 5), false);
  assert.deepEqual(pages.list('ops', ws).map((p) => [p.slug, p.kind]), [['roadmap', 'interactive']]);
  assert.throws(() => pages.save('ops', ws, { title: 'Roadmap', markdown: '# x' }), /is an interactive page of yours/);
  assert.throws(() => pages.save('ops', ws, { page: 'roadmap', markdown: '# x' }), /publish a new version of it with publish_interactive_page/);
  pages.save('ops', ws, { title: 'Weekly', markdown: '# Weekly' });
  assert.throws(() => pages.publish('ops', { title: 'Weekly', files: bundle(1) }), /is a Markdown page of yours/);
  assert.throws(() => pages.publish('ops', { page: 'weekly', files: bundle(1) }), /You have no interactive page "weekly"/);
  assert.match(pages.promptNote('ops', ws), /"Roadmap" \(interactive page "roadmap"\)/);
  pages.forgetBot('ops');
  assert.ok(!fs.existsSync(path.join(data, 'sites', 'ops')), "a deleted bot's pages go with it");
});

test('a bot keeps at most PAGES_MAX interactive pages; a new version of one is still published', (t) => {
  const pages = pagesLib.create(scratch(t));
  for (let i = 0; i < sites.PAGES_MAX; i++) pages.publish('ops', { title: `Page ${i}`, files: [file('index.html')] });
  assert.throws(() => pages.publish('ops', { title: 'One more', files: [file('index.html')] }), /You have 20 interactive pages, the most a bot keeps/);
  assert.equal(pages.publish('ops', { page: 'page-0', files: [file('index.html')] }).version, 2);
  assert.equal(pages.hasVersion('ops', 'page-0', 2), true, 'read anew after the write');
});

test('a signed address names one version for a while, and a changed or old one is refused', () => {
  const { token, expires } = sites.sign({ botId: 'ops', slug: 'roadmap', version: 3 }, 1_000_000);
  assert.equal(Date.parse(expires), 1_000_000 + sites.TOKEN_MS);
  assert.deepEqual(sites.verify(token, 1_000_000 + 1000), { botId: 'ops', slug: 'roadmap', version: 3 });
  assert.equal(sites.verify(token, 1_000_000 + sites.TOKEN_MS + 1), null, 'ran out');
  const [body, mac] = token.split('.');
  const other = Buffer.from(JSON.stringify({ b: 'ops', s: 'roadmap', v: 4, e: 9e15 })).toString('base64url');
  assert.equal(sites.verify(`${other}.${mac}`), null, 'another version under the same signature');
  assert.equal(sites.verify(`${body}.${'A'.repeat(32)}`), null);
  assert.equal(sites.verify('../../x'), null);
  assert.equal(sites.frameUrl('https://h:8443', 'ann', token), `https://h:8443/ann/${token}/index.html`);
  assert.equal(sites.sitesOrigin({ headers: { 'x-botdot-sites': 'https://h.example.com:8443' } }), 'https://h.example.com:8443');
  assert.equal(sites.sitesOrigin({ headers: { 'x-botdot-sites': "https://h.example.com:8443; script-src *" } }), null, 'never more than an origin in the app\'s rules');
});

test('the download is a zip any unzip reads', (t) => {
  const dir = scratch(t);
  const zip = sites.zip([file('index.html', '<h1>x</h1>'), file('assets/app.js', 'let a = 1')]);
  fs.writeFileSync(path.join(dir, 'page.zip'), zip);
  const listed = childProcess.execFileSync('python3', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip()); print(sorted(z.namelist())); print(z.read("assets/app.js").decode())', path.join(dir, 'page.zip')], { encoding: 'utf8' });
  assert.equal(listed, "None\n['assets/app.js', 'index.html']\nlet a = 1\n");
});

test("the computer's step: box makes a tar of the folder in its own folder, and too large a folder is said so", async () => {
  let reply = () => ({ stdout: Buffer.from('tar'), stderr: Buffer.from('') });
  const calls = [];
  const fake = (f, args, opts, cb) => { calls.push({ args, opts }); setImmediate(() => { const r = reply(); cb(r.error || null, r.stdout, r.stderr); }); return { stdin: { on() {}, end() {} } }; };
  fake[util.promisify.custom] = async () => ({ stdout: '', stderr: '' });
  const real = childProcess.execFile;
  childProcess.execFile = fake;
  delete require.cache[require.resolve('../lib/computers')];
  const computers = require('../lib/computers');
  childProcess.execFile = real;
  delete require.cache[require.resolve('../lib/computers')];
  const r = await computers.packFolder({ bot: 'ops', screen: 2 }, { path: 'roadmap/dist' });
  assert.deepEqual(r, { code: 0, tar: Buffer.from('tar').toString('base64'), stderr: '' });
  const { args, opts } = calls[0];
  assert.deepEqual(args.slice(0, 3), ['exec', '-u', 'box']);
  assert.deepEqual(args.slice(-3), ['sh', '/workspace/ops', 'roadmap/dist']);
  assert.match(args.at(-4), /exec tar --format=ustar -cf - -C "\$2" \.$/);
  assert.equal(opts.encoding, 'buffer');
  reply = () => ({ error: Object.assign(new Error('too much'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }) });
  assert.match((await computers.packFolder({ bot: 'ops', screen: 2 }, { path: 'x' })).error, /too large for a page/);
  const helper = require('../lib/docker-helper');
  assert.equal(helper.validate('packFolder', [{ bot: 'ops', screen: 2 }, { path: 'roadmap/dist' }]), true);
  assert.equal(helper.validate('packFolder', [{ bot: 'ops', screen: 2 }, { path: 'x', command: 'rm -rf /' }]), false);
  assert.equal(helper.validate('packFolder', [{ bot: 'ops', screen: 2 }, { path: 'a\0b' }]), false);
});
