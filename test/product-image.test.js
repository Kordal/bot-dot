// A product's photo on a product card (#682, ADR 113): botdot fetches it itself over HTTPS, keeps only a JPEG, PNG,
// WebP or GIF told by its bytes, refuses local and private addresses, and keeps the answer on disk.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const productImage = require('../lib/product-image');
const { certificate } = require('./link-helpers');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4, 0), Buffer.from('WEBP'), Buffer.alloc(20, 3)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20, 4)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

// A store on this machine: path -> { body } or { redirect }, and the paths it was asked for.
async function store(pages) {
  const { key, cert } = certificate();
  const hits = [];
  const server = https.createServer({ key, cert }, (req, res) => {
    hits.push(req.url);
    const p = pages[req.url];
    if (!p) { res.writeHead(404); return res.end(); }
    if (p.redirect) { res.writeHead(302, { Location: p.redirect }); return res.end(); }
    res.writeHead(200, { 'Content-Type': p.type || 'image/jpeg' });
    res.end(p.body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { hits, local: { port: server.address().port, ca: cert }, close: () => server.close() };
}
const loopback = async () => [{ address: '127.0.0.1', family: 4 }];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'product-image-'));

test('a photo is fetched from an https address at a public name only', () => {
  assert.equal(productImage.imageUrl(' https://m.media-amazon.com/images/I/61a.jpg#x '), 'https://m.media-amazon.com/images/I/61a.jpg');
  assert.equal(productImage.imageUrl('https://cdn.example.com:443/a.webp?w=400'), 'https://cdn.example.com/a.webp?w=400');
  for (const bad of ['', 'http://cdn.example.com/a.jpg', 'https://localhost/a.jpg', 'https://127.0.0.1/a.jpg', 'https://10.0.0.1/a.jpg',
    'https://[::1]/a.jpg', 'https://nas.local/a.jpg', 'https://box/a.jpg', 'https://cdn.example.com:8443/a.jpg', 'https://u:p@cdn.example.com/a.jpg',
    'data:image/png;base64,AAAA', 'javascript:alert(1)', `https://cdn.example.com/${'a'.repeat(2000)}`, null]) {
    assert.equal(productImage.imageUrl(bad), null, String(bad).slice(0, 60));
  }
});

test('a photo is a JPEG, a PNG, a WebP or a GIF by its bytes, never an SVG', () => {
  assert.equal(productImage.imageType(JPEG), 'image/jpeg');
  assert.equal(productImage.imageType(PNG), 'image/png');
  assert.equal(productImage.imageType(WEBP), 'image/webp');
  assert.equal(productImage.imageType(GIF), 'image/gif');
  assert.equal(productImage.imageType(SVG), null);
  assert.equal(productImage.imageType(Buffer.from('<html>')), null);
});

test('a photo is fetched once, kept on disk and fetched again after a week', async () => {
  const s = await store({ '/i/desk.jpg': { body: JPEG } });
  try {
    let now = Date.now();
    const photos = productImage.create({ dir: tmp(), lookup: loopback, local: s.local, now: () => now });
    const url = 'https://images.shop.example/i/desk.jpg';
    const [a, b] = await Promise.all([photos.image(url), photos.image(url)]);
    assert.deepEqual(a, { image: { type: 'image/jpeg', body: JPEG } });
    assert.deepEqual(b, a);
    assert.deepEqual(s.hits, ['/i/desk.jpg']);
    assert.deepEqual(await photos.image(url), a);
    assert.equal(s.hits.length, 1);
    now += productImage.KEEP_MS + 1000;
    await photos.image(url);
    assert.equal(s.hits.length, 2);
  } finally { s.close(); }
});

test('a redirect is followed; an SVG, a page or a missing photo is none, and that is kept for a day', async () => {
  const s = await store({ '/a': { redirect: '/b.webp' }, '/b.webp': { body: WEBP }, '/c.svg': { body: SVG, type: 'image/svg+xml' }, '/d': { body: Buffer.from('<html>'), type: 'image/png' } });
  try {
    let now = Date.now();
    const photos = productImage.create({ dir: tmp(), lookup: loopback, local: s.local, now: () => now });
    assert.deepEqual(await photos.image('https://shop.example/a'), { image: { type: 'image/webp', body: WEBP } });
    assert.deepEqual(await photos.image('https://shop.example/c.svg'), { image: null });
    assert.deepEqual(await photos.image('https://shop.example/d'), { image: null });
    assert.deepEqual(await photos.image('https://shop.example/gone.jpg'), { image: null });
    const asked = s.hits.length;
    await photos.image('https://shop.example/gone.jpg');
    assert.equal(s.hits.length, asked);
    now += productImage.MISS_MS + 1000;
    await photos.image('https://shop.example/gone.jpg');
    assert.equal(s.hits.length, asked + 1);
  } finally { s.close(); }
});

test('a name that resolves to a private address gets no request', async () => {
  const s = await store({ '/a.jpg': { body: JPEG } });
  try {
    const photos = productImage.create({ dir: tmp(), lookup: async () => [{ address: '192.168.1.5', family: 4 }] });
    assert.deepEqual(await photos.image('https://shop.example/a.jpg'), { image: null, again: true });
    assert.deepEqual(s.hits, []);
  } finally { s.close(); }
});

test('a store that fails or answers nothing is asked again by the next card', async () => {
  let down = true;
  const { key, cert } = require('./link-helpers').certificate();
  const hits = [];
  const server = https.createServer({ key, cert }, (req, res) => {
    hits.push(req.url);
    if (down) { res.writeHead(503); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(PNG);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const photos = productImage.create({ dir: tmp(), lookup: loopback, local: { port: server.address().port, ca: cert } });
    assert.deepEqual(await photos.image('https://shop.example/p.png'), { image: null, again: true });
    down = false;
    assert.deepEqual(await photos.image('https://shop.example/p.png'), { image: { type: 'image/png', body: PNG } });
    assert.equal(hits.length, 2);
  } finally { server.close(); }
});

test('no more than four stores are asked at once, and what is past its time leaves the folder', async () => {
  let open = 0, most = 0;
  const { key, cert } = require('./link-helpers').certificate();
  const server = https.createServer({ key, cert }, (req, res) => {
    open++; most = Math.max(most, open);
    setTimeout(() => { open--; res.writeHead(200); res.end(GIF); }, 30);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    let now = Date.now();
    const dir = tmp();
    const photos = productImage.create({ dir, lookup: loopback, local: { port: server.address().port, ca: cert }, now: () => now });
    await Promise.all(Array.from({ length: 10 }, (_, i) => photos.image(`https://shop.example/${i}.gif`)));
    assert.ok(most <= 4, `${most} at once`);
    assert.equal(fs.readdirSync(dir).length, 10);
    // An hour on, the next photo kept tidies the folder: the ten are older than a week by then.
    const weekAgo = new Date(Date.now() - productImage.KEEP_MS - 1000);
    for (const n of fs.readdirSync(dir)) fs.utimesSync(path.join(dir, n), weekAgo, weekAgo);
    now += 3600 * 1000 + 1;
    await photos.image('https://shop.example/new.gif');
    assert.deepEqual(fs.readdirSync(dir).length, 1, 'only the new one is left');
  } finally { server.close(); }
});
