// botdot.app (ADR 172), as `npm run build` left it in build/: it links only to what it has, says what the README and
// the desktop docs say, keeps every picture described and sized, loads nothing from another site and no JavaScript of
// SvelteKit's, and its changelog is whats-new/. Run: npm test (in site/), which builds first.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(SITE, '..');
const OUT = path.join(SITE, 'build');
const whatsNew = createRequire(import.meta.url)(path.join(ROOT, 'lib', 'whats-new.js'));

assert.ok(fs.existsSync(path.join(OUT, 'index.html')), 'build/ is there: run npm run build first');
const read = (f) => fs.readFileSync(path.join(OUT, f), 'utf8');
// A page's URL as GitHub Pages serves it: / is index.html, /changelog is changelog.html.
const fileOf = (url) => (url === '/' ? 'index.html' : fs.existsSync(path.join(OUT, `${url.slice(1)}.html`)) ? `${url.slice(1)}.html` : url.slice(1));
const PAGES = ['/', '/changelog'];
const attrs = (html, name) => [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'g'))].map((m) => m[1]);

test('the changelog holds every note of whats-new/, newest first, drawn as text', () => {
  const notes = whatsNew.read(path.join(ROOT, 'whats-new')).filter((n) => !n.error);
  const html = read('changelog.html');
  assert.equal((html.match(/<article>/g) || []).length, notes.length);
  const dates = [...html.matchAll(/<time datetime="([\d-]+)">/g)].map((m) => m[1]);
  assert.deepEqual(dates, [...dates].sort().reverse());
  assert.ok(html.includes(`<h3>${notes.at(-1).title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</h3>`), 'the newest note');
  const md = read('changelog.md');
  assert.ok(md.startsWith('# botdot changelog\n'));
  assert.equal((md.match(/^### /gm) || []).length, notes.length);
});

test('every link and picture of a page is in the site, and every #anchor on its page', () => {
  for (const url of PAGES) {
    const html = read(fileOf(url));
    for (const ref of [...attrs(html, 'href'), ...attrs(html, 'src')]) {
      if (/^(https?:|mailto:)/.test(ref)) continue;
      const [file, hash] = ref.split('#');
      const target = file === '' ? url : path.posix.resolve(url === '/' ? '/' : path.posix.dirname(url), file);
      assert.ok(fs.existsSync(path.join(OUT, fileOf(target))), `${url}: ${ref} is missing`);
      if (hash) assert.ok(attrs(read(fileOf(target)), 'id').includes(hash), `${url}: #${hash} is not on ${target}`);
    }
    assert.ok(attrs(html, 'id').includes('main'), `${url}: the skip link's target`);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${url}: one h1`);
    assert.match(html, /<title>[^<]{8,}<\/title>/, `${url}: a title`);
    assert.match(html, /<link rel="canonical" href="https:\/\/botdot\.app\//, `${url}: its address`);
  }
});

test('nothing is loaded from another site, and no JavaScript but the Copy button\'s', () => {
  for (const url of PAGES) {
    const html = read(fileOf(url));
    for (const [tag] of html.matchAll(/<(script|link|img)\b[^>]*>/g)) {
      if (/^<link\b/.test(tag) && /rel="(canonical|alternate)"/.test(tag)) continue;
      assert.doesNotMatch(tag, /(src|href)="https?:/, `${url}: ${tag}`);
    }
    const scripts = attrs(html, 'src').filter((s) => s.endsWith('.js'));
    assert.deepEqual(scripts, url === '/' ? ['/site.js'] : [], `${url}: scripts`);
    assert.doesNotMatch(html, /modulepreload|__sveltekit/, `${url}: no SvelteKit in the browser`);
  }
  for (const css of fs.readdirSync(path.join(OUT, '_app/immutable/assets')).filter((f) => f.endsWith('.css'))) {
    assert.doesNotMatch(read(`_app/immutable/assets/${css}`), /url\("?https?:/, css);
  }
});

test('every picture says what it shows and has its own size, so the page does not jump', () => {
  for (const url of PAGES) {
    for (const [img] of read(fileOf(url)).matchAll(/<img\b[^>]*>/g)) {
      assert.match(img, /\salt="[^"]{12,}"/, img);
      const src = img.match(/src="([^"]+)"/)[1];
      const w = Number(img.match(/width="(\d+)"/)?.[1]);
      const h = Number(img.match(/height="(\d+)"/)?.[1]);
      // A lossy WebP's size is in its VP8 header: what the page says must be the picture's own shape.
      const buf = fs.readFileSync(path.join(OUT, src));
      const vp8 = buf.indexOf('VP8 ');
      assert.ok(vp8 > 0, `${src} is a lossy WebP`);
      assert.deepEqual([w, h], [buf.readUInt16LE(vp8 + 14) & 0x3fff, buf.readUInt16LE(vp8 + 16) & 0x3fff], src);
    }
  }
});

test('the install commands are the README quickstart\'s, and the downloads are the desktop docs\'', () => {
  const html = read('index.html');
  const cmd = html.match(/<pre id="cmd"><code>([\s\S]*?)<\/code><\/pre>/)[1].replace(/<[^>]+>/g, '').replace(/^\$ /gm, '').trim().split('\n');
  assert.equal(cmd.length, 2);
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  for (const line of cmd) assert.ok(readme.includes(`\n${line}\n`), `README's quickstart has: ${line}`);
  const desktop = fs.readFileSync(path.join(ROOT, 'docs', 'desktop.md'), 'utf8');
  const downloads = attrs(html, 'href').filter((h) => h.includes('/releases/download/'));
  assert.equal(downloads.length, 7);
  for (const d of downloads) assert.ok(desktop.includes(`(${d})`), `docs/desktop.md links ${d}`);
});

test('the GitHub links point at files the repository has', () => {
  const texts = [...PAGES.map((u) => read(fileOf(u))), read('llms.txt')];
  const files = texts.flatMap((t) => [...t.matchAll(/https:\/\/(?:github\.com\/Kordal\/bot-dot\/blob|raw\.githubusercontent\.com\/Kordal\/bot-dot)\/main\/([^\s)"#]+)/g)].map((m) => m[1]));
  assert.ok(files.length > 5);
  for (const f of files) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
});

test('llms.txt is the llmstxt.org shape: a title, a summary, then lists of links', () => {
  const lines = read('llms.txt').split('\n');
  assert.equal(lines[0], '# botdot');
  assert.ok(lines.some((l) => l.startsWith('> ')));
  const links = lines.filter((l) => l.startsWith('- ['));
  assert.ok(links.length >= 8);
  for (const l of links) assert.match(l, /^- \[[^\]]+\]\(https:\/\/[^)]+\)(: .+)?$/, l);
  assert.ok(links.some((l) => l.includes('https://botdot.app/changelog.md')));
  for (const page of read('sitemap.xml').matchAll(/<loc>https:\/\/botdot\.app(\/[^<]*)<\/loc>/g)) {
    assert.ok(fs.existsSync(path.join(OUT, fileOf(page[1]))), `sitemap: ${page[1]}`);
  }
});
