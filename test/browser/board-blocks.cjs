// Optional browser check of the Board drawn from blocks (#394): NODE_PATH=<directory containing playwright> node test/browser/board-blocks.cjs
// A Board with three headings: a value with its recent values (a kpi with its change and sparkline), two switches and
// a button (one Controls box), a list, a note a bot wrote (written by AI), a kpi with a bar, a status pill, a callout
// and a chart of two series. At 1440px the headings name their bots, the Live marker counts, the filter shows one
// heading, the chart's tooltip says its values; on a phone (390px) the tiles go one across and the kpis two across.
// SHOTS=<folder> keeps a picture of each. Scratch data and the stand-in Claude only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot } = require('../helpers');

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const home = await makeBot(srv, { name: 'Home Helper' });
    const watch = await makeBot(srv, { name: 'Server Watch' });
    const add = async (body) => { const r = await srv.api('/dashboard/tiles', { method: 'POST', body }); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data; };
    const temp = await add({ kind: 'value', title: 'Living room', section: 'Home', bot: home.id, unit: '°C', size: 'wide' });
    for (const v of [20.7, 20.8, 21, 21.2, 21.1, 21.4, 21.5]) await srv.asChief(`/dashboard/tiles/${temp.id}/value`, { method: 'PUT', body: { value: v } });
    await add({ kind: 'switch', title: 'Heating', section: 'Home', bot: home.id, read: { type: 'script', script: 'echo on' }, turnOn: { type: 'script', script: 'true' }, turnOff: { type: 'script', script: 'true' } });
    await add({ kind: 'switch', title: 'LED strip', section: 'Home', bot: home.id, read: { type: 'script', script: 'echo off' }, turnOn: { type: 'script', script: 'true' }, turnOff: { type: 'script', script: 'true' } });
    await add({ kind: 'button', title: 'All lights off', section: 'Home', bot: home.id, do: { type: 'script', script: 'true' } });
    await add({ kind: 'list', title: 'Shopping', section: 'Home', bot: home.id, value: ['Leeks', 'Potatoes', 'Gruyère'] });
    const note = await add({ kind: 'note', title: 'Morning summary', section: 'Today', bot: home.id, size: 'wide' });
    await srv.asChief(`/dashboard/tiles/${note.id}/value`, { method: 'PUT', body: { value: '**Rail strike called off:** trains run as normal.\n\nNothing urgent on your other topics.' } });
    const mail = await add({ kind: 'value', title: 'Unread mail', section: 'Today', bot: home.id });
    for (const v of [9, 11, 10, 12, 14]) await srv.asChief(`/dashboard/tiles/${mail.id}/value`, { method: 'PUT', body: { value: v } });
    await add({ kind: 'custom', title: 'Disk', section: 'Server', bot: watch.id, every: 30, read: { type: 'script', script: 'echo \'{"used": 62, "free": "380 GB"}\'' }, face: [{ type: 'kpi', bind: 'value.used', unit: '%', max: 100, sub: '{{value.free}} free', spark: false, change: false, good: 'down' }] });
    await add({ kind: 'custom', title: 'Backups', section: 'Server', bot: watch.id, value: { state: 'ok', last: '03:12' }, face: [{ type: 'status', text: 'All good', level: '{{value.state}}' }, { type: 'text', text: 'last {{value.last}} · 4/4', muted: true }] });
    await add({ kind: 'custom', title: 'Updates', section: 'Server', bot: watch.id, value: 3, face: [{ type: 'kpi', bind: 'value', sub: 'waiting for your OK', subColor: 'warn', spark: false, change: false }, { type: 'callout', level: 'warn', text: 'Kernel update needs a restart.' }] });
    const cpu = await add({ kind: 'custom', title: 'CPU and RAM', section: 'Server', bot: watch.id, size: 'wide', value: { cpu: 30, ram: 60 }, face: [{ type: 'chart', label: 'last hour', unit: '%', series: [{ bind: 'value.cpu', label: 'CPU', color: '#3b82f6' }, { bind: 'value.ram', label: 'RAM', color: 'ok' }] }] });
    for (const [c, r] of [[42, 61], [38, 62], [55, 64], [47, 63], [64, 68], [51, 66], [58, 67]]) await srv.asChief(`/dashboard/tiles/${cpu.id}/value`, { method: 'PUT', body: { value: { cpu: c, ram: r } } });
    await srv.api('/dashboard/refresh', { method: 'POST' });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const shot = async (name) => { if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`), fullPage: false }); };
    await page.goto(srv.base);
    await page.waitForFunction(() => typeof setView === 'function' && state.bots?.length === 2);
    await page.locator('[data-board]:visible').first().click(); // the keypad's line of the Board
    await page.waitForSelector('#view-dashboard .dash-grid');
    await page.waitForFunction(() => document.querySelectorAll('#view-dashboard [data-tile]').length === 11);
    const heads = await page.locator('#view-dashboard h3.dash-sec').allInnerTexts();
    assert.equal(heads.length, 3);
    assert.match(heads[0], /^Home\nHome Helper\n\d+s ago$/, 'each heading with its bots, and how long ago its values were read');
    assert.equal(heads[1], 'Today\nHome Helper');
    assert.match(heads[2], /^Server\nServer Watch\n\d+s ago$/);
    assert.equal(await page.locator('h3.dash-sec .tile-src').first().getAttribute('title'), 'script · 1 min', 'where they come from, on hover');
    assert.equal(await page.locator('.board-head p').count(), 0, 'no count of sources');
    assert.match(await page.locator('[data-board-refresh]').innerText(), /^\d+s ago$/, 'the refresh button: its arrows and the age, no label');
    // A tap reads every tile now (#452); its arrows turn until the answer is in.
    const sent = page.waitForRequest((r) => r.url().endsWith('/api/dashboard/refresh') && /"all":true/.test(r.postData() || ''));
    await page.locator('[data-board-refresh]').click();
    await sent;
    await page.waitForSelector('[data-board-refresh].spin');
    await page.waitForSelector('[data-board-refresh]:not(.spin)');
    assert.equal(await page.locator('.ctl-box .ctl-row').count(), 3, 'two switches and a button, one box');
    assert.equal(await page.locator('.ctl-box .sw.on').count(), 1, 'Heating is on');
    assert.match(await page.locator(`[data-tile="${temp.id}"] .kit-delta`).innerText(), /^▲ 0\.8 since \d\d:\d\d$/);
    assert.equal(await page.locator(`[data-tile="${temp.id}"] .kit-spark`).count(), 1);
    assert.equal(await page.locator(`[data-tile="${note.id}"] .tile-ai`).innerText(), 'written by AI');
    assert.equal(await page.locator('.kit-pill.ok').innerText(), 'All good');
    await shot('board-wide');
    // The chart's tooltip, over its last point.
    const plot = page.locator(`[data-tile="${cpu.id}"] .kit-plot`);
    await plot.scrollIntoViewIfNeeded();
    const box = await plot.boundingBox();
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2);
    assert.match(await page.locator('.kit-tip').innerText(), /CPU 58 % · RAM 67 %/);
    await shot('board-tooltip');
    // One heading at a time.
    await page.locator('[data-filter="Server"]').click();
    assert.deepEqual((await page.locator('#view-dashboard h3.dash-sec').allInnerTexts()).map((h) => h.replace(/\d+s ago$/, 'ago')), ['Server\nServer Watch\nago']);
    await page.locator('[data-filter=""]').click();

    // A window of 1000: the list and the Board beside it, three across.
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.waitForTimeout(300);
    const cols = await page.locator('#view-dashboard .dash-grid').first().evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    assert.equal(cols, 3);
    assert.ok((await page.locator(`[data-tile="${cpu.id}"] .kit-bar, [data-tile] .kit-bar`).first().boundingBox()).height < 10, 'the bar is a bar');
    await shot('board-1000');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const width = (sel) => page.locator(sel).first().evaluate((el) => el.getBoundingClientRect().width);
    const grid = await width('#view-dashboard .dash-grid');
    assert.ok(Math.abs((await width(`[data-tile="${temp.id}"]`)) - grid) < 2, 'one across');
    const half = await width(`[data-tile="${mail.id}"]`);
    assert.ok(half < grid / 2 + 1 && half > grid / 3, `a tile of one number two across (${half} of ${grid})`);
    await shot('board-phone');
    await page.evaluate(() => document.querySelector('#view-dashboard').scrollTo(0, 99999));
    await shot('board-phone-end');
    assert.deepEqual(errors, []);
    console.log('ok: the Board from blocks, wide and on a phone');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
