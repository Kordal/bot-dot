// Optional browser check of a page with blocks (#395): NODE_PATH=<directory containing playwright> node test/browser/page-blocks.cjs [shots dir]
// A bot saves a page with a hero, a row of kpis (one bound to a tile of the Board), charts side by side, pills, a
// callout and a block that cannot be drawn: the viewer draws them with the kit, the bound kpi follows the tile's new
// value without a reload, and a tooltip shows on a chart. Scratch data and the stand-in Claude only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, heldRun, self } = require('../helpers');

const fence = (type, v) => `\`\`\`${type}\n${JSON.stringify(v)}\n\`\`\``;
const PAGE = [
  fence('hero', { eyebrow: 'Report · kordal/bot-dot', title: 'bot-dot: features', lead: 'What is done, what is under way and what waits for you. Built from the backlog and GitHub, refreshed every hour.', tags: ['weekly', 'live'] }),
  fence('kpi', [
    { label: 'Done', value: 42, of: 58, points: [30, 31, 34, 33, 36, 38, 42], sub: '6 this week', color: 'ok' },
    { label: 'In progress', value: 7, points: [7, 8, 7, 7, 8, 7, 7], change: false, sub: 'no change' },
    { tile: 'Waiting for you', bind: 'value', label: 'Waiting for you', good: 'down', color: 'warn' },
    { label: 'Open PRs', value: 2, points: [3, 4, 3, 3, 2, 2, 2], sub: 'CI: 1 green, 1 running', color: '#8b7cf6' },
  ]),
  fence('grid', { columns: 2, blocks: [
    { type: 'chart', title: 'Progress by area', style: 'hbar', bars: [{ label: 'Chat', value: 11 }, { label: 'Bots, files, pages', value: 7 }, { label: 'Jobs', value: 8 }, { label: 'Rooms', value: 6 }], max: 14 },
    { type: 'chart', title: 'Closed weekly', style: 'bar', labels: ['35', '36', '37', '38', '39', '40', '41', '42'], series: [{ label: 'Closed', points: [8, 10, 9, 13, 12, 16, 18, 17], color: 'ok' }] },
  ] }),
  '## Status',
  fence('status', [{ text: 'CI green', level: 'ok' }, { text: 'Disk 81%', level: 'warn' }, { text: 'Backups', level: 'ok' }, { text: 'iOS', level: 'plan' }]),
  fence('callout', { title: 'Waits for you', text: 'Approve the pull request for **#380** to ship the What\'s new change.', level: 'warn' }),
  fence('kpi', '{ not json'),
  'The rest is plain Markdown, <b>never HTML</b>.',
].join('\n\n');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'bot-dot Manager', color: '#45c78e' });
    const tile = (await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'value', title: 'Waiting for you', bot: bot.id, value: 2 } })).data;
    const { run, rec, token } = await heldRun(srv, bot, 'A features page');
    for (const v of [1, 2]) await srv.asChief(`/dashboard/tiles/${tile.id}/value`, { method: 'PUT', body: { value: v } });
    const saved = await self(srv, token, 'page', { title: 'bot-dot: features', markdown: PAGE });
    assert.equal(saved.data.problems.length, 1);
    await srv.asChief(`/dashboard/tiles/${tile.id}/value`, { method: 'PUT', body: { value: 3 } });
    srv.reply('Done: the page has live numbers.');
    srv.release(rec);
    await srv.finished(run.id);
    srv.unhold();

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#bot/${bot.id}`);
    await page.locator('#bot-thread .page-chip').first().click();
    const viewer = page.locator('#doc-viewer');
    await viewer.locator('.dv-page .pb-title', { hasText: 'bot-dot: features' }).waitFor();
    await viewer.locator('[data-dv="full"]').click();
    assert.equal(await viewer.locator('.dv-page .pb-card .kit-kpi').count(), 4);
    assert.equal(await viewer.locator('.dv-page .kit-chart').count(), 2);
    assert.equal(await viewer.locator('.dv-page .pb-pills .kit-pill').count(), 4);
    assert.equal(await viewer.locator('.dv-page .pb-error').count(), 1);
    assert.equal(await viewer.locator('.dv-page b', { hasText: 'never HTML' }).count(), 0, 'HTML stays text');
    const bound = viewer.locator('.dv-page .kit-kpi', { hasText: 'Waiting for you' });
    assert.match(await bound.innerText(), /^Waiting for you\n3\n/);

    // The tile gets a new value: the page redraws the kpi from the live feed.
    await srv.asChief(`/dashboard/tiles/${tile.id}/value`, { method: 'PUT', body: { value: 1 } });
    await bound.locator('.kit-num', { hasText: /^1$/ }).waitFor({ timeout: 10000 });
    const plot = viewer.locator('.dv-page .kit-plot').first();
    const box = await plot.boundingBox();
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
    await plot.locator('.kit-tip').waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-blocks.png') });

    await page.setViewportSize({ width: 390, height: 844 });
    if (shots) await page.screenshot({ path: path.join(shots, 'phone-blocks.png'), fullPage: false });
    assert.deepEqual(errors, []);
    console.log('PASS  a page with blocks in the browser');
  } finally {
    await browser?.close();
    srv.unhold?.();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
