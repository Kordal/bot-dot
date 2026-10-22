// Optional browser check of the Pages view (#361): NODE_PATH=<directory containing playwright> node test/browser/pages-all.cjs [shots dir]
// Two bots save pages, one is kept up to date: Settings links to Pages, which lists it under "Kept up to date" and the
// other under "Other pages", each with its bot; a tap opens the page in the viewer beside its bot's chat. Scratch data
// and the stand-in Claude only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, heldRun, self } = require('../helpers');

async function save(srv, bot, title, markdown) {
  const { run, rec, token } = await heldRun(srv, bot, `Make the page ${title}`);
  await self(srv, token, 'page', { title, markdown });
  srv.reply('Saved.');
  srv.release(rec);
  await srv.finished(run.id);
}

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const ops = await makeBot(srv, { name: 'Ops', color: '#45c78e' });
    const writer = await makeBot(srv, { name: 'Writer', color: '#c78e45' });
    await save(srv, ops, 'hq weekly health', '# hq weekly health\n\nDisk 81%.');
    await save(srv, writer, 'Reddit launch memo', '# Reddit launch memo\n\n- Post on Tuesday.');
    await save(srv, ops, 'Router ports', '# Router ports\n\n| Port | What |\n| --- | --- |\n| 22 | SSH |');
    srv.unhold();
    await srv.api(`/bots/${ops.id}/pages/hq-weekly-health/keep`, { method: 'POST', body: { every: 'day', time: '07:00' } });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#settings`);
    await page.locator('#settings-links [data-go="pages"]').click();
    const view = page.locator('#view-pages');
    await view.locator('.pg-row', { hasText: 'Router ports' }).waitFor({ timeout: 20000 });
    const text = await view.innerText();
    assert.ok(text.indexOf('Kept up to date') < text.indexOf('hq weekly health'));
    assert.ok(text.indexOf('hq weekly health') < text.indexOf('Other pages'));
    assert.ok(text.indexOf('Other pages') < text.indexOf('Router ports'));
    assert.match(await view.locator('.pg-row', { hasText: 'hq weekly health' }).innerText(), /Ops · updated just now · Daily at 07:00/);
    assert.match(await view.locator('.pg-row', { hasText: 'Reddit launch memo' }).innerText(), /Writer · updated/);
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-pages.png') });

    await view.locator('.pg-row', { hasText: 'Reddit launch memo' }).click();
    const viewer = page.locator('#doc-viewer');
    await viewer.locator('.dv-md h1', { hasText: 'Reddit launch memo' }).waitFor();
    assert.match(await viewer.locator('.dv-title span').innerText(), /^Page by Writer · updated/);
    assert.match(page.url(), new RegExp(`#bot/${writer.id}$`), "beside its bot's chat");
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-opened.png') });

    await viewer.locator('.dv-close').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${srv.base}/#pages`);
    await page.reload();
    await page.locator('#view-pages .pg-row', { hasText: 'Router ports' }).waitFor({ timeout: 20000 });
    if (shots) await page.screenshot({ path: path.join(shots, 'phone-pages.png') });
    assert.deepEqual(errors, []);
    console.log('PASS  the Pages view in the browser');
  } finally {
    await browser?.close();
    srv.unhold?.();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
