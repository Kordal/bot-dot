// A site's icon before a link in a reply (#530, ADR 086): botdot fetches it itself over HTTPS, keeps only a small PNG
// or ICO, refuses private addresses and keeps the answer on disk.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const favicon = require('../lib/favicon');
const { certificate } = require('./link-helpers');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const ICO = Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0]), Buffer.alloc(40, 2)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

// A site on this machine: path -> { body, type } or { redirect }, and the paths it was asked for.
async function site(pages) {
  const { key, cert } = certificate();
  const hits = [];
  const server = https.createServer({ key, cert }, (req, res) => {
    hits.push(req.url);
    const p = pages[req.url];
    if (!p) { res.writeHead(404); return res.end(); }
    if (p.redirect) { res.writeHead(302, { Location: p.redirect }); return res.end(); }
    res.writeHead(200, { 'Content-Type': p.type || 'application/octet-stream' });
    res.end(p.body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { hits, local: { port: server.address().port, ca: cert }, close: () => server.close() };
}
const loopback = async () => [{ address: '127.0.0.1', family: 4 }];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'favicon-'));

test('a host is a public DNS name, without port, path, address or local name', () => {
  assert.equal(favicon.siteHost('News.Example.com.'), 'news.example.com');
  assert.equal(favicon.siteHost('bücher.de'), 'xn--bcher-kva.de');
  for (const bad of ['', 'localhost', 'box', 'nas.local', 'printer.lan', 'my-vm.internal', '127.0.0.1', '10.0.0.1', '[::1]', 'example.com:8080', 'example.com/x', 'a@example.com', 'exa mple.com', null]) {
    assert.equal(favicon.siteHost(bad), null, String(bad));
  }
});

test('an icon is a PNG or an ICO by its bytes, never an SVG', () => {
  assert.equal(favicon.iconType(PNG), 'image/png');
  assert.equal(favicon.iconType(ICO), 'image/x-icon');
  assert.equal(favicon.iconType(SVG), null);
  assert.equal(favicon.iconType(Buffer.from('<html>')), null);
});

test("the page's own icons come first, a touch icon after, an SVG never", () => {
  const html = `<head><link rel="apple-touch-icon" href="/touch.png"><link rel="icon" type="image/svg+xml" href="/i.svg">
    <link href='/i-32.png' rel='icon' sizes='32x32'><link rel="shortcut icon" href="https://cdn.example.com/f.ico?v=2&amp;x=1">
    <link rel="stylesheet" href="/s.css"><link rel="icon" href="http://example.com/plain.png"></head>`;
  assert.deepEqual(favicon.iconLinks(html, 'https://example.com/'),
    ['https://example.com/i-32.png', 'https://cdn.example.com/f.ico?v=2&x=1', 'https://example.com/touch.png']);
});

test('the icon the home page names is fetched, kept on disk and served from there', async () => {
  const s = await site({ '/': { type: 'text/html', body: '<link rel="icon" href="/static/i.png">' }, '/static/i.png': { body: PNG } });
  try {
    let now = Date.now();
    const icons = favicon.create({ dir: tmp(), lookup: loopback, local: s.local, now: () => now });
    const [a, b] = await Promise.all([icons.icon('news.example'), icons.icon('news.example')]);
    assert.deepEqual(a, { type: 'image/png', body: PNG });
    assert.deepEqual(b, a);
    assert.deepEqual(s.hits, ['/', '/static/i.png']); // one fetch for both
    assert.deepEqual(await icons.icon('news.example'), a);
    assert.equal(s.hits.length, 2);
    now += favicon.KEEP_MS + 1000;
    await icons.icon('news.example');
    assert.equal(s.hits.length, 4); // fetched again after a week
  } finally { s.close(); }
});

test('without a named icon, /favicon.ico; an SVG or a page is not an icon', async () => {
  const s = await site({ '/': { type: 'text/html', body: '<link rel="icon" href="/i.png">' }, '/i.png': { body: SVG }, '/favicon.ico': { body: ICO } });
  try {
    const icons = favicon.create({ dir: tmp(), lookup: loopback, local: s.local });
    assert.deepEqual(await icons.icon('blog.example'), { type: 'image/x-icon', body: ICO });
  } finally { s.close(); }
});

test('a redirect is followed, an icon too large is not kept', async () => {
  const s = await site({ '/': { redirect: '/home' }, '/home': { type: 'text/html', body: '<link rel="icon" href="/big.png">' }, '/big.png': { body: Buffer.concat([PNG, Buffer.alloc(favicon.ICON_MAX)]) } });
  try {
    const icons = favicon.create({ dir: tmp(), lookup: loopback, local: s.local });
    assert.equal(await icons.icon('big.example'), null);
    assert.deepEqual(s.hits, ['/', '/home', '/big.png', '/favicon.ico']);
  } finally { s.close(); }
});

test('a site without an icon is kept as none for a day', async () => {
  const s = await site({});
  try {
    let now = Date.now();
    const icons = favicon.create({ dir: tmp(), lookup: loopback, local: s.local, now: () => now });
    assert.equal(await icons.icon('none.example'), null);
    assert.equal(await icons.icon('none.example'), null);
    assert.equal(s.hits.length, 2); // '/' and '/favicon.ico', once
    now += favicon.MISS_MS + 1000;
    await icons.icon('none.example');
    assert.equal(s.hits.length, 4);
  } finally { s.close(); }
});

test('a site that points to a private or local address gets no request', async () => {
  const s = await site({ '/favicon.ico': { body: ICO } });
  try {
    for (const address of ['127.0.0.1', '10.1.2.3', '100.96.60.62', '192.168.1.1', '169.254.169.254']) {
      const icons = favicon.create({ dir: tmp(), lookup: async () => [{ address, family: 4 }] });
      assert.equal(await icons.icon('evil.example'), null, address);
    }
    const ipv6 = favicon.create({ dir: tmp(), lookup: async () => [{ address: 'fd7a:115c:a1e0::1', family: 6 }] });
    assert.equal(await ipv6.icon('evil.example'), null);
    assert.equal(s.hits.length, 0);
  } finally { s.close(); }
});

test('a redirect to a local name is not followed', async () => {
  const s = await site({ '/': { redirect: 'https://router.lan/' }, '/favicon.ico': { redirect: 'https://127.0.0.1/favicon.ico' } });
  try {
    const icons = favicon.create({ dir: tmp(), lookup: loopback, local: s.local });
    assert.equal(await icons.icon('hop.example'), null);
    assert.deepEqual(s.hits, ['/', '/favicon.ico']);
  } finally { s.close(); }
});
