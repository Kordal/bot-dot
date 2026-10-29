// Product cards in a reply on the web page (#682, ADR 113): public/products.js reads a ```products fence by the rules
// the Android app shares (test/fixtures/products-cases.json), and md() draws it as the bot's pick and rows under it.
// Every word is text, only an https address opens, a photo comes through botdot, and a fence that can't be read is
// its code.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { read, cut, esc, words } = require('./web-page');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'products-cases.json'), 'utf8'));
const page = vm.createContext({ ...words, esc, URL, linkPaths: (html) => html });
vm.runInContext(`${read('products.js')}
  ${cut('function md(src, botId)', '// Link bare web addresses after rendering')}
  this.Products = Products; this.md = md; this.draftSource = draftSource;`, page);
const { Products, md, draftSource } = page;
const plain = (v) => JSON.parse(JSON.stringify(v));
const fence = (json) => `Four fit. Lift Pro 140 is the best value.\n\n\`\`\`products\n${json}\n\`\`\``;
const source = (name) => fixture.cases.find((c) => c.name.startsWith(name)).source;

test('web: every case of the shared fixture is read into its products, or stays code', () => {
  assert.ok(fixture.cases.length >= 10);
  for (const c of fixture.cases) assert.deepEqual(plain(Products.parse(c.source)), c.products, c.name);
});

test('web: a price is read into its number, whatever its separators', () => {
  for (const [text, n] of fixture.amounts) {
    const a = Products.amount(text);
    if (n === null) assert.ok(Number.isNaN(a), text); else assert.equal(a, n, text);
  }
});

test('web: a reply still being written waits for its products fence to close', () => {
  for (const d of fixture.drafts) assert.equal(draftSource(d.source), d.draft, d.name);
});

test('web: the first product is the pick, with Open and Save; the rest are rows that open their store', () => {
  const html = md(fence(source('the first is the pick')), 'shopper');
  assert.match(html, /^<p>Four fit\. Lift Pro 140 is the best value\.<\/p>\n<div class="products"><div class="pc-pick">/);
  const pick = html.slice(html.indexOf('pc-pick'), html.indexOf('pc-list'));
  assert.match(pick, /<span class="pc-name">Lift Pro 140<\/span><span class="pc-price"><b>€379<\/b><\/span>/);
  assert.match(pick, /4\.6<\/span><i><\/i>2140 reviews<i><\/i>amazon\.de<\/span>/);
  assert.match(pick, /<p class="pc-why">Two motors, steady at full height, 10-year frame warranty\.<\/p><span class="pc-ship">Arrives Friday<\/span>/);
  assert.match(pick, /<a class="pc-btn pri" href="https:\/\/www\.amazon\.de\/dp\/B0C1" target="_blank" rel="noopener noreferrer" data-site-icon>.*Open<\/span><\/a>/);
  assert.match(pick, /<button type="button" class="pc-btn" data-product-save="shopper" data-product="[^"]+" aria-pressed="false">.*Save<\/span><\/button>/);
  // The photo comes through botdot, never from the store; without one, only the placeholder.
  assert.match(pick, /<img alt="" loading="lazy" decoding="async" src="\/api\/product-image\?url=https%3A%2F%2Fm\.media-amazon\.com%2Fimages%2FI%2F61a\.jpg">/);
  assert.doesNotMatch(html, /src="https?:/);
  const rows = html.slice(html.indexOf('pc-list'));
  assert.equal((rows.match(/<a class="pc-row" href="https:/g) || []).length, 2);
  assert.match(rows, /Ergo Frame S2<\/span><span class="pc-facts">.*4\.4<\/span><i><\/i>x-kom\.pl<i><\/i>Arrives tomorrow<\/span><\/span><span class="pc-price"><b>€339<\/b><em>−15%<\/em><\/span>/);
  assert.doesNotMatch(rows, /<img/);
});

test('web: an old price is struck through on the pick, with how much less', () => {
  const html = md(fence(source('one product, not in a list')), 'shopper');
  assert.match(html, /<span class="pc-price"><b>1 299 zł<\/b><s>1 499 zł<\/s><em>−13%<\/em><\/span>/);
  assert.doesNotMatch(html, /pc-list/);
});

test('web: no Save outside a bot\'s reply, and no Open or Save without a store\'s address', () => {
  assert.doesNotMatch(md(fence(source('the first is the pick'))), /data-product-save/);
  const html = md(fence(JSON.stringify([{ name: 'Desk', price: '€10' }, { name: 'Chair' }])), 'shopper');
  assert.doesNotMatch(html, /pc-acts|data-product-save|<a /);
  assert.match(html, /<div class="pc-row">/);
});

test('web: nothing a bot writes in a product is markup', () => {
  const evil = '<img src=x onerror=alert(1)>"\'&';
  const html = md(fence(JSON.stringify([{ name: evil, url: 'https://shop.example/a?"><script>', price: evil, was: evil, store: evil, arrives: evil, why: evil }, { name: evil, url: 'https://shop.example/b' }])), 'shopper');
  assert.doesNotMatch(html, /<img src=x|<script>|onerror=alert\(1\)>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;&amp;/);
});

test('web: a fence that can\'t be read stays its code', () => {
  for (const json of ['[{"name": "Desk", }', '[]', '42', '[{"price": "€1"}]']) {
    const html = md(fence(json), 'shopper');
    assert.doesNotMatch(html, /class="products"/, json);
    assert.match(html, /<div class="code-block"><pre><code>/, json);
  }
});

test('web: index.html loads products.js before app.js, and the cards have their style', () => {
  const index = read('index.html');
  const at = (f) => index.indexOf(`<script src="/${f}"></script>`);
  assert.ok(at('products.js') > 0 && at('products.js') < at('app.js'));
  const css = read('style.css');
  for (const sel of ['.md .products {', '.products .pc-pick {', '.products .pc-row {', '@container products (max-width: 520px)']) assert.ok(css.includes(sel), sel);
});
