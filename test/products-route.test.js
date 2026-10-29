// A product card's photo and its Save (#682, ADR 113): GET /api/product-image refuses an address that is no public
// https one, answers a 404 the browser keeps for a day when there is no photo; Save puts the product in one Markdown
// file among the bot's files and takes it out again. Only the owner asks; the Chief's tools can't.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot } = require('./helpers');

let srv, bot;
before(async () => { srv = await startServer(); bot = await makeBot(srv); });
after(async () => { await srv.stop(); });

const desk = { name: 'Lift Pro [140]', url: 'https://www.amazon.de/dp/B0C1', price: '€379', store: 'amazon.de' };
const saved = async () => (await srv.api(`/bots/${bot.id}/saved-products`)).data.urls;
const fileText = (file) => fs.readFileSync(path.join(srv.data, 'workspaces', bot.id, file), 'utf8');

test('features name product-cards', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('product-cards'));
});

test('a photo address that is no public https one is refused', async () => {
  for (const url of ['', 'http://shop.example/a.jpg', 'https://localhost/a.jpg', 'https://10.0.0.1/a.jpg', 'https://nas.local/a.jpg', 'https://shop.example:8443/a.jpg']) {
    assert.equal((await srv.api(`/product-image?url=${encodeURIComponent(url)}`)).status, 400, url);
  }
});

test('an address no store answers is a 404 kept a few minutes, so the next card asks again', async () => {
  const res = await fetch(`${srv.base}/api/product-image?url=${encodeURIComponent('https://nothing.invalid/a.jpg')}`);
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('cache-control'), 'private, max-age=300');
});

test('Save puts a product in the bot\'s file of saved products, and again takes it out', async () => {
  assert.deepEqual(await saved(), []);
  let r = await srv.api(`/bots/${bot.id}/saved-products`, { method: 'POST', body: { product: desk } });
  assert.equal(r.status, 200);
  assert.equal(r.data.saved, true);
  assert.match(r.data.file, /^uploads\/\d{14}-[0-9a-f]{4}-Saved-products\.md$/);
  const file = r.data.file;
  assert.match(fileText(file), /^# Saved products\n\n- \[Lift Pro 140\]\(https:\/\/www\.amazon\.de\/dp\/B0C1\) · €379 · amazon\.de · \d{4}-\d{2}-\d{2}\n$/);
  // Saved twice, it is there once; another product goes under it, in the same file.
  await srv.api(`/bots/${bot.id}/saved-products`, { method: 'POST', body: { product: desk } });
  r = await srv.api(`/bots/${bot.id}/saved-products`, { method: 'POST', body: { product: { name: 'Oak Rise', url: 'https://www.ikea.com/p/2' } } });
  assert.equal(r.data.file, file);
  assert.deepEqual(await saved(), [desk.url, 'https://www.ikea.com/p/2']);
  // The owner sees it among the bot's files, and so does the bot.
  const files = (await srv.api(`/bots/${bot.id}/files`)).data.files;
  assert.ok(files.some((f) => f.file === file && f.name === 'Saved-products.md'));
  r = await srv.api(`/bots/${bot.id}/saved-products`, { method: 'POST', body: { product: desk, saved: false } });
  assert.equal(r.data.saved, false);
  assert.deepEqual(await saved(), ['https://www.ikea.com/p/2']);
  // The last one out takes the file with it.
  await srv.api(`/bots/${bot.id}/saved-products`, { method: 'POST', body: { product: { url: 'https://www.ikea.com/p/2' }, saved: false } });
  assert.deepEqual(await saved(), []);
  assert.equal(fs.existsSync(path.join(srv.data, 'workspaces', bot.id, file)), false);
});

test('a product without an https address is not saved; an unknown bot is a 404', async () => {
  for (const product of [{ name: 'A' }, { name: 'A', url: 'http://shop.example/a' }, { name: 'A', url: 'javascript:alert(1)' }, null]) {
    assert.equal((await srv.api(`/bots/${bot.id}/saved-products`, { method: 'POST', body: { product } })).status, 400);
  }
  assert.equal((await srv.api(`/bots/${bot.id}/saved-products`, { method: 'POST', raw: 'null' })).status, 400);
  assert.equal((await srv.api('/bots/nobody/saved-products')).status, 404);
});

test("the Chief's tools can't ask for a photo or save a product", async () => {
  assert.equal((await srv.asChief('/product-image?url=https%3A%2F%2Fshop.example%2Fa.jpg')).status, 403);
  assert.equal((await srv.asChief(`/bots/${bot.id}/saved-products`)).status, 403);
  assert.equal((await srv.asChief(`/bots/${bot.id}/saved-products`, { method: 'POST', body: { product: desk } })).status, 403);
});

test('Save keeps what else the file holds, and an address with brackets', () => {
  const savedProducts = require('../lib/saved-products');
  const ws = fs.mkdtempSync(path.join(require('os').tmpdir(), 'saved-'));
  fs.mkdirSync(path.join(ws, 'uploads'));
  const mine = 'uploads/20261029070000-ab12-Saved-products.md';
  fs.writeFileSync(path.join(ws, mine), '# My list\n\nGifts for the family.\n- [Old lamp](https://shop.example/lamp) · €20\n');
  const odd = 'https://shop.example/item_(red)';
  assert.equal(savedProducts.set(ws, { name: 'Red one', url: odd }).file, mine);
  assert.deepEqual(savedProducts.list(ws), ['https://shop.example/lamp', odd]);
  assert.match(fs.readFileSync(path.join(ws, mine), 'utf8'), /^# My list\n\nGifts for the family\.\n- \[Old lamp\]\(https:\/\/shop\.example\/lamp\) · €20\n- \[Red one\]\(https:\/\/shop\.example\/item_%28red%29\) · \d{4}-\d{2}-\d{2}\n$/);
  savedProducts.set(ws, { url: odd }, false);
  savedProducts.set(ws, { url: 'https://shop.example/lamp' }, false);
  assert.equal(fs.readFileSync(path.join(ws, mine), 'utf8'), '# My list\n\nGifts for the family.\n', 'the owner\'s words stay');
});
