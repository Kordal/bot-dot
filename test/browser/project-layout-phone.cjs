// Optional browser check of an arranged board on a phone (ADR 147): node test/browser/project-layout-phone.cjs [shots dir]
// A board arranged on a laptop (a list card top left, New card far below it) is one column on a phone: every tile as
// wide as the board, in the canvas's reading order, its text at its normal size, no empty canvas between the tiles, the
// card's first 5 items, no sideways scroll. A long press there moves nothing. A laptop still draws the canvas.
// Scratch data only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, writeData, waitFor } = require('../helpers');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const lead = await makeBot(srv, { name: 'Infra Admin', color: '#f0a030' });
    assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'quotz.app' } })).status, 201);
    const c = (await srv.api('/company')).data.company;
    writeData(path.join(srv.data, 'company.json'), { ...c, name: 'Quotz', phase: 'running', startedAt: new Date(Date.now() - 3_600_000).toISOString(), teams: [{ id: 't1', name: 'Dev Team', color: '#34c759', bots: [lead.id], lead: lead.id }] });
    const list = Array.from({ length: 12 }, (_, i) => ({ ref: `#${200 - i}`, text: `Bring production up to date with staging, step ${i + 1}`, tag: 'launch-blocker', level: 'err' }));
    writeData(path.join(srv.data, 'project-cards.json'), { [c.id]: [
      { id: 'k1', ask: 'Open issues', title: 'Open issues · Buildr', state: 'ready', at: new Date().toISOString(), triedAt: new Date().toISOString(), answers: [], apps: [], body: { show: 'list', value: '55', sub: '17 for you', list } },
    ] });
    // As on the owner's laptop: the card at the top left, New card far below it.
    const put = await srv.api('/company/layout', { method: 'PUT', body: { layout: { 'card:k1': [0, 0, 700, 220], 'new-card': [300, 1100, 300, 120] } } });
    assert.equal(put.status, 200, JSON.stringify(put.data));
    const saved = JSON.stringify((await srv.api('/company')).data.company.layout);

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const errors = [];
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', hasTouch: true, isMobile: true })).newPage();
    phone.on('pageerror', (e) => errors.push(e.message));
    await phone.goto(`${srv.base}/#company`);
    await phone.locator('.bc-tile[data-tile="card:k1"] [data-pc-card="k1"]').waitFor({ timeout: 20000 });
    await phone.waitForTimeout(800); // the page slides in on a phone
    assert.equal(await phone.locator('.bc-wrap.bc-column').count(), 1, 'a column');

    const wrap = await phone.locator('.bc-wrap').boundingBox();
    const tiles = await phone.locator('.bc-tile').evaluateAll((l) => l.map((t) => ({ id: t.dataset.tile, ...JSON.parse(JSON.stringify(t.getBoundingClientRect())) })).sort((a, b) => a.y - b.y));
    assert.deepEqual(tiles.map((t) => t.id).slice(0, 2), ['card:k1', 'new-card'], 'the canvas\'s order');
    for (const t of tiles) assert.ok(Math.abs(t.width - wrap.width) < 1, `${t.id} as wide as the board: ${t.width} of ${wrap.width}`);
    for (let i = 1; i < tiles.length; i++) assert.ok(tiles[i].y - (tiles[i - 1].y + tiles[i - 1].height) <= 24, `no empty canvas above ${tiles[i].id}`);
    const size = await phone.locator('[data-pc-card="k1"] .pc-text').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize) * (el.getBoundingClientRect().height / el.offsetHeight || 1));
    assert.ok(size >= 13, `readable: ${size}px`);
    const shown = await phone.locator('[data-pc-card="k1"] .pc-list li').evaluateAll((l) => l.filter((x) => x.offsetParent).length);
    assert.equal(shown, 5, 'the first 5 items, as in the flow');
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll');
    if (shots) await phone.screenshot({ path: path.join(shots, 'phone.png'), fullPage: true });

    // A long press, then a drag: nothing moves, nothing is saved.
    const cdp = await phone.context().newCDPSession(phone);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const card = await phone.locator('.bc-tile[data-tile="card:k1"]').boundingBox();
    const mid = { x: card.x + card.width / 2, y: card.y + card.height / 2 };
    await touch('touchStart', mid.x, mid.y);
    await phone.waitForTimeout(650);
    for (let i = 1; i <= 8; i++) await touch('touchMove', mid.x + 5 * i, mid.y + 6 * i);
    await touch('touchEnd');
    await phone.waitForTimeout(400);
    assert.equal(await phone.locator('.bc-held, .bc-tile.moving').count(), 0, 'nothing picked up');
    assert.equal(JSON.stringify((await srv.api('/company')).data.company.layout), saved, 'nothing saved');

    // A laptop: the canvas, the card where it was put.
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#company`);
    await page.locator('.bc-tile[data-tile="card:k1"] [data-pc-card="k1"]').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('.bc-wrap.bc-column').count(), 0, 'the canvas on a laptop');
    const w = await page.locator('.bc-wrap').boundingBox();
    const k = await page.locator('.bc-tile[data-tile="card:k1"]').boundingBox();
    assert.ok(Math.abs(k.width - 700 * (w.width / 1200)) < 2, 'drawn at its size on the canvas');
    if (shots) await page.screenshot({ path: path.join(shots, 'wide.png') });

    // The window made narrow: the column; wide again: the canvas.
    await page.setViewportSize({ width: 420, height: 900 });
    await waitFor(async () => (await page.locator('.bc-wrap.bc-column').count()) === 1, { what: 'a column when narrow' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await waitFor(async () => (await page.locator('.bc-wrap.bc-column').count()) === 0, { what: 'the canvas when wide' });

    assert.deepEqual(errors, []);
    console.log('project-layout-phone: ok');
  } finally {
    if (browser) await browser.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
