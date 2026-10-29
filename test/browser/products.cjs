// Optional browser check of product cards (#682, ADR 113): NODE_PATH=<directory containing playwright> node test/browser/products.cjs
// A bot's reply with a ```products fence shows its pick as a card (photo beside it, on top in a narrow chat) and the
// rest as rows; the photos come through botdot and the page asks no store for anything; a photo botdot has none of
// shows the placeholder; Save puts the product among the bot's files and shows it saved, and again takes it out.
// Scratch data and the stand-in Claude only.
//   PRODUCT_SHOTS=<folder>  save pictures of the chat there, wide and phone
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot } = require('../helpers');

const IMG = (n) => `https://images.shop.example/desk-${n}.png`;
const PRODUCTS = [
  { name: 'Lift Pro 140', url: 'https://shop.example/lift-pro-140', image: IMG(1), price: '€379', store: 'amazon.de', rating: 4.6, reviews: 2140, arrives: 'Arrives Friday', why: 'Two motors, steady at full height, 10-year frame warranty.' },
  { name: 'Ergo Frame S2', url: 'https://shop.example/ergo-frame-s2', image: IMG(2), price: '€339', was: '€399', store: 'x-kom.pl', rating: 4.4, arrives: 'Arrives tomorrow' },
  { name: 'Oak Rise 140', url: 'https://shop.example/oak-rise-140', image: IMG(3), price: '€349', store: 'ikea.pl', rating: 4.3, arrives: 'Arrives in 3–5 days' },
  { name: 'Basic Stand 140', url: 'https://shop.example/basic-stand-140', image: 'https://images.shop.example/none.png', price: '€299', store: 'allegro.pl', rating: 4.0, arrives: 'Arrives Monday' },
];
const REPLY = `Four fit. Lift Pro 140 is the best value: two motors, 4.6 from 2140 reviews, here Friday.\n\n\`\`\`products\n${JSON.stringify(PRODUCTS, null, 1)}\n\`\`\``;

// A desk, drawn as a product photo on white.
const DESK = (top, legs) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400"><rect width="400" height="400" fill="#f4f4f4"/>
  <rect x="70" y="150" width="260" height="16" rx="4" fill="${top}"/><rect x="110" y="166" width="12" height="150" fill="${legs}"/><rect x="278" y="166" width="12" height="150" fill="${legs}"/>
  <rect x="80" y="312" width="72" height="8" rx="3" fill="${legs}"/><rect x="248" y="312" width="72" height="8" rx="3" fill="${legs}"/><rect x="170" y="110" width="60" height="38" rx="3" fill="#222"/></svg>`;

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Shop Scout' });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    // botdot keeps the photos of three of them already (lib/product-image.js), as if it had fetched them.
    const draw = await browser.newPage({ viewport: { width: 400, height: 400 } });
    const kept = path.join(srv.data, 'product-images');
    fs.mkdirSync(kept, { recursive: true });
    for (const [n, top, legs] of [[1, '#d9a86c', '#2a2a2a'], [2, '#3a3a3a', '#111'], [3, '#c8a274', '#e8e8e8']]) {
      await draw.setContent(`<body style="margin:0">${DESK(top, legs)}</body>`);
      const png = await draw.screenshot({ type: 'png' });
      fs.writeFileSync(path.join(kept, `${crypto.createHash('sha256').update(IMG(n)).digest('hex').slice(0, 40)}.img`), png);
    }
    fs.writeFileSync(path.join(kept, `${crypto.createHash('sha256').update('https://images.shop.example/none.png').digest('hex').slice(0, 40)}.none`), '');

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [], requests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => requests.push(r.url()));
    srv.reply(REPLY);
    const run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Standing desk, 140 cm wide, under €400' } })).data;
    await srv.finished(run.id);
    await page.goto(`${srv.base}/#bot/${bot.id}`);
    const cards = page.locator('#bot-thread .bubble .md .products').last();
    await cards.waitFor();
    assert.equal(await cards.locator('.pc-pick').count(), 1);
    assert.equal(await cards.locator('.pc-row').count(), 3);
    assert.match(await cards.locator('.pc-pick').innerText(), /Lift Pro 140\n€379\n4\.6\n2140 reviews\namazon\.de\n+Two motors/);
    assert.equal(await cards.locator('.pc-row').nth(0).locator('em').innerText(), '−15%');
    // The photos come through botdot; the one botdot has none of shows the placeholder.
    await page.waitForFunction(() => [...document.querySelectorAll('.products .pc-img img')].every((i) => i.complete));
    await page.waitForTimeout(300);
    assert.equal(await cards.locator('.pc-img img').count(), 3);
    assert.ok(await cards.locator('.pc-pick .pc-img img').evaluate((i) => i.naturalWidth > 0));
    assert.equal(await cards.locator('.pc-row').nth(2).locator('.pc-img img').count(), 0, 'no broken picture');
    assert.ok(!requests.some((u) => u.includes('shop.example') && !u.includes('/api/product-image')), 'the page asks no store');
    // The rows and Open go to the store.
    assert.equal(await cards.locator('.pc-row').nth(0).getAttribute('href'), 'https://shop.example/ergo-frame-s2');
    assert.equal(await cards.locator('.pc-pick a.pc-btn').getAttribute('href'), 'https://shop.example/lift-pro-140');
    assert.equal(await cards.locator('.site-icon').count(), 0, 'no site icons in the cards');

    if (process.env.PRODUCT_SHOTS) {
      fs.mkdirSync(process.env.PRODUCT_SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(process.env.PRODUCT_SHOTS, 'wide.png') });
    }

    // Save, and again.
    const save = cards.locator('[data-product-save]');
    assert.equal(await save.innerText(), 'Save');
    await save.click();
    await page.waitForFunction(() => document.querySelector('[data-product-save]').getAttribute('aria-pressed') === 'true');
    assert.equal(await save.innerText(), 'Saved');
    let urls = [];
    for (let i = 0; i < 20 && !urls.length; i++) { urls = (await srv.api(`/bots/${bot.id}/saved-products`)).data.urls; if (!urls.length) await page.waitForTimeout(100); }
    assert.deepEqual(urls, ['https://shop.example/lift-pro-140']);
    assert.ok((await srv.api(`/bots/${bot.id}/files`)).data.files.some((f) => f.name === 'Saved-products.md'));
    if (process.env.PRODUCT_SHOTS) await cards.screenshot({ path: path.join(process.env.PRODUCT_SHOTS, 'saved.png') });
    // Drawn again, it is still saved.
    await page.reload();
    await page.locator('#bot-thread .products [data-product-save][aria-pressed="true"]').waitFor();
    await page.locator('#bot-thread .products [data-product-save]').click();
    await page.waitForFunction(() => document.querySelector('[data-product-save]').getAttribute('aria-pressed') === 'false');
    for (let i = 0; i < 20 && urls.length; i++) { urls = (await srv.api(`/bots/${bot.id}/saved-products`)).data.urls; if (urls.length) await page.waitForTimeout(100); }
    assert.deepEqual(urls, []);

    // A phone: the pick's photo on top, as wide as the card.
    await page.setViewportSize({ width: 1700, height: 1000 });
    await page.waitForTimeout(300);
    if (process.env.PRODUCT_SHOTS) await page.screenshot({ path: path.join(process.env.PRODUCT_SHOTS, "wider.png") });
    await page.setViewportSize({ width: 390, height: 1100 });
    await page.waitForTimeout(400);
    const pick = page.locator('#bot-thread .products .pc-pick').last();
    const img = await pick.locator('.pc-img').boundingBox();
    const text = await pick.locator('.pc-t').boundingBox();
    assert.ok(img.y + img.height <= text.y + 1, 'the photo is above the words');
    assert.ok(Math.abs(img.width / img.height - 16 / 9) < 0.05, 'the photo is 16:9');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll');
    if (process.env.PRODUCT_SHOTS) await page.screenshot({ path: path.join(process.env.PRODUCT_SHOTS, 'phone.png') });

    assert.deepEqual(errors, []);
    console.log('product cards: ok');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
