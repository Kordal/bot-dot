// The style kit and templates of interactive pages (#400): each template comes with the kit where it links it, the
// fonts are the web page's own, nothing loads from the internet, the plain templates publish as they are, the tar
// unpacks with tar and reads back as a page's folder, and the computer's step unpacks it as box into a new folder.
// SITE_KIT_BUILD=1 also builds the Svelte template with npm (it needs the registry) and checks what it builds.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const childProcess = require('child_process');
const siteKit = require('../lib/site-kit');
const sites = require('../lib/sites');
const { ROOT } = require('./helpers');

const scratch = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-site-kit-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };
const unpack = (dir, template) => {
  fs.writeFileSync(path.join(dir, 'kit.tar'), siteKit.tar(siteKit.files(template)));
  fs.mkdirSync(path.join(dir, template));
  childProcess.execFileSync('tar', ['-xf', path.join(dir, 'kit.tar'), '-C', path.join(dir, template)]);
  return path.join(dir, template);
};
const walk = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
  ? walk(path.join(dir, e.name), base) : [{ path: path.relative(base, path.join(dir, e.name)), data: fs.readFileSync(path.join(dir, e.name)) }]));

test('each template comes with the kit where it links it, and the fonts are the web page\'s own', () => {
  assert.deepEqual(Object.keys(siteKit.TEMPLATES), ['html', 'svelte', 'roadmap']);
  for (const [name, t] of Object.entries(siteKit.TEMPLATES)) {
    const files = siteKit.files(name);
    const at = (p) => files.find((f) => f.path === p);
    assert.ok(at('index.html'), `${name} has index.html at its top`);
    for (const p of ['botdot-kit.css', 'botdot-kit.js', 'fonts/Geist.ttf', 'fonts/GeistMono.ttf', 'fonts/OFL.txt']) assert.ok(at(`${t.kitAt}/${p}`), `${name}: ${t.kitAt}/${p}`);
    assert.ok(at(`${t.kitAt}/fonts/Geist.ttf`).data.equals(fs.readFileSync(path.join(ROOT, 'public', 'fonts', 'Geist.ttf'))));
    const html = at('index.html').data.toString();
    const kit = name === 'svelte' ? '/kit' : 'kit';
    assert.match(html, new RegExp(`<link rel="stylesheet" href="${kit}/botdot-kit\\.css">`), `${name} links the stylesheet`);
    assert.match(html, new RegExp(`<script src="${kit}/botdot-kit\\.js"></script>`), `${name} loads the kit's script`);
    assert.ok(files.some((f) => /(^|\/)data\.json$/.test(f.path)), `${name} reads a data.json`);
  }
  assert.throws(() => siteKit.files('react'), /There is no template "react": pick one of html, svelte, roadmap/);
});

test('nothing in the kit or a template loads from the internet', () => {
  for (const name of Object.keys(siteKit.TEMPLATES)) {
    for (const f of siteKit.files(name).filter((x) => /\.(html|css|js|svelte)$/.test(x.path))) {
      const text = f.data.toString();
      assert.doesNotMatch(text, /(src|href)\s*=\s*["']?(https?:)?\/\//i, `${name}/${f.path} loads nothing from another address`);
      assert.doesNotMatch(text, /url\(\s*["']?(https?:)?\/\//i, `${name}/${f.path}: no font or picture from the internet`);
      assert.doesNotMatch(text, /@import/i, `${name}/${f.path}`);
    }
  }
  // Every font the stylesheet names is in the kit.
  const css = fs.readFileSync(path.join(siteKit.KIT_ROOT, 'kit', 'botdot-kit.css'), 'utf8');
  const fonts = [...css.matchAll(/url\("(fonts\/[^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(fonts, ['fonts/Geist.ttf', 'fonts/GeistMono.ttf']);
  assert.match(css, /color-scheme: dark/);
});

test('the Svelte template pins what it builds with, builds into dist with relative paths, and has its lock', () => {
  const dir = path.join(siteKit.KIT_ROOT, 'templates', 'svelte');
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  for (const [name, version] of Object.entries(pkg.devDependencies)) assert.match(version, /^\d+\.\d+\.\d+$/, `${name} is pinned`);
  assert.deepEqual(Object.keys(pkg.devDependencies).sort(), ['@sveltejs/vite-plugin-svelte', 'svelte', 'vite']);
  const lock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages[''].devDependencies.vite, pkg.devDependencies.vite, 'the lock matches package.json');
  const config = fs.readFileSync(path.join(dir, 'vite.config.js'), 'utf8');
  assert.match(config, /base: '\.\/'/);
  assert.match(config, /outDir: 'dist'/);
});

test('the tar unpacks with tar, and the plain templates publish as they are', (t) => {
  const dir = scratch(t);
  for (const name of ['html', 'roadmap']) {
    const site = unpack(dir, name);
    const files = walk(site);
    assert.deepEqual(files.map((f) => f.path).sort(), siteKit.files(name).map((f) => f.path).sort());
    assert.equal(sites.checkBundle(files).length, files.length, `${name} is a page's folder as it is`);
    assert.deepEqual(sites.untar(siteKit.tar(files)).map((f) => f.path).sort(), files.map((f) => f.path).sort(), 'and reads back as publish_interactive_page reads one');
  }
  assert.ok(siteKit.tar(siteKit.files('svelte')).toString('base64').length <= 900_000, "fits the helper's limit");
  assert.throws(() => siteKit.tar([{ path: 'a b.html', data: Buffer.from('') }]), /can't go into a tar/);
});

test('the roadmap template is the approved design: views, chips by area, a sort, three columns of cards that open', () => {
  const dir = path.join(siteKit.KIT_ROOT, 'templates', 'roadmap');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  for (const view of ['overview', 'roadmap', 'releases', 'bots']) assert.match(html, new RegExp(`data-view="${view}"`));
  for (const part of ['class="hero"', 'id="ring"', 'id="areas"', 'id="sort"', 'class="kanban"', 'class="table"']) assert.ok(html.includes(part), part);
  const data = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'));
  assert.deepEqual(data.columns.map((c) => c.id), ['waiting', 'doing', 'done']);
  for (const it of data.items) {
    assert.ok(data.columns.some((c) => c.id === it.column), `${it.id} is in a column`);
    assert.ok(data.areas.includes(it.area), `${it.id} has an area`);
  }
  assert.ok(data.items.some((it) => it.more), 'a card opens to say more');
});

test("the computer's step: box unpacks the tar into a new folder of its own, and a folder in use is left as it is", async () => {
  const calls = [];
  const fake = (f, args, opts, cb) => {
    const call = { args, opts, input: null };
    calls.push(call);
    setImmediate(() => cb(null, '', ''));
    return { stdin: { on() {}, end(input) { call.input = input; } } };
  };
  fake[util.promisify.custom] = async () => ({ stdout: '', stderr: '' });
  const real = childProcess.execFile;
  childProcess.execFile = fake;
  delete require.cache[require.resolve('../lib/computers')];
  const computers = require('../lib/computers');
  childProcess.execFile = real;
  delete require.cache[require.resolve('../lib/computers')];
  const tar = siteKit.tar(siteKit.files('html'));
  const r = await computers.unpackFolder({ bot: 'ops', screen: 2 }, { path: 'roadmap', tar: tar.toString('base64') });
  assert.equal(r.code, 0);
  const { args, input } = calls[0];
  assert.deepEqual(args.slice(0, 4), ['exec', '-i', '-u', 'box']);
  assert.deepEqual(args.slice(-3), ['sh', '/workspace/ops', 'roadmap']);
  assert.match(args.at(-4), /is not empty: give a new folder/);
  assert.match(args.at(-4), /exec tar -xf - -C "\$2" --no-same-owner/);
  assert.ok(Buffer.from(input).equals(tar), 'the tar goes on stdin');

  // What the computer runs, here: a new folder is filled, one that holds anything is refused.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-site-kit-'));
  try {
    const run = (folder) => childProcess.spawnSync('sh', ['-c', args.at(-4), 'sh', dir, folder], { input: tar });
    assert.equal(run('a/b').status, 0);
    assert.ok(fs.existsSync(path.join(dir, 'a', 'b', 'kit', 'fonts', 'Geist.ttf')));
    const again = run('a/b');
    assert.equal(again.status, 3);
    assert.match(again.stderr.toString(), /a\/b is not empty/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  const helper = require('../lib/docker-helper');
  const b64 = tar.toString('base64');
  assert.equal(helper.validate('unpackFolder', [{ bot: 'ops', screen: 2 }, { path: 'roadmap', tar: b64 }]), true);
  assert.equal(helper.validate('unpackFolder', [{ bot: 'ops', screen: 2 }, { path: 'roadmap', tar: 'not base64!' }]), false);
  assert.equal(helper.validate('unpackFolder', [{ bot: 'ops', screen: 2 }, { path: 'roadmap', tar: b64, command: 'x' }]), false);
  assert.equal(helper.validate('unpackFolder', [{ bot: 'ops', screen: 2 }, { path: 'a\0b', tar: b64 }]), false);
});

test('the Svelte template builds with npm and its dist publishes', { skip: process.env.SITE_KIT_BUILD !== '1' && 'set SITE_KIT_BUILD=1 (needs the npm registry)' }, (t) => {
  const site = unpack(scratch(t), 'svelte');
  childProcess.execFileSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: site, stdio: 'pipe', timeout: 300_000 });
  childProcess.execFileSync('npm', ['run', 'build'], { cwd: site, stdio: 'pipe', timeout: 300_000 });
  const files = walk(path.join(site, 'dist'));
  assert.equal(sites.checkBundle(files).length, files.length);
  for (const p of ['index.html', 'data.json', 'kit/botdot-kit.css', 'kit/botdot-kit.js', 'kit/fonts/Geist.ttf']) assert.ok(files.some((f) => f.path === p), p);
  assert.match(files.find((f) => f.path === 'index.html').data.toString(), /src="\.\/assets\/index-[\w-]+\.js"/, 'relative paths');
});
