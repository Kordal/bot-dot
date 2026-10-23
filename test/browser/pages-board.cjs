// Optional browser check of pages on the Board (#451): NODE_PATH=<directory containing playwright> node test/browser/pages-board.cjs
// A page put on the Board is a tile with its kpis or first lines; a tap opens it in the viewer, whose "On Board" takes it
// off; the switch on its row of the Pages view puts it back. SHOTS=<folder> keeps a picture of each (wide and phone).
// Scratch data and the stand-in Claude only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, waitFor, heldRun, self } = require('../helpers');

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const ops = await makeBot(srv, { name: 'Server Watch', allowedTools: [] });
    const writer = await makeBot(srv, { name: 'Writer', allowedTools: [] });
    const save = async (bot, title, markdown) => {
      const { run, rec, token } = await heldRun(srv, bot, `Make the page ${title}`);
      assert.equal((await self(srv, token, 'page', { title, markdown })).status, 200);
      srv.release(rec);
      await srv.finished(run.id);
    };
    await save(ops, 'Weekly server health', '# Weekly server health\n\n```kpi\n[{"label":"Up","value":"3/3"},{"label":"Disk","value":41,"unit":"%","points":[30,33,35,41]},{"label":"Alerts","value":0}]\n```\n');
    await save(writer, 'Reddit launch memo', '# Reddit launch memo\n\nPost on Tuesday at 15:00 CET in r/selfhosted, then answer every comment for two hours.\n');
    await save(writer, 'Q3 notes', '# Q3 notes\n\nNothing yet.\n');
    await srv.api('/dashboard/tiles', { method: 'POST', body: { kind: 'value', title: 'Living room', section: 'Home', value: '21.5', unit: '°C' } });
    for (const [b, slug] of [[ops, 'weekly-server-health'], [writer, 'reddit-launch-memo']]) await srv.api(`/bots/${b.id}/pages/${slug}/board`, { method: 'PUT', body: { on: true } });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const shot = async (p, name) => { if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`) }); };
    await page.goto(srv.base);
    await page.waitForFunction(() => typeof setView === 'function' && state.bots?.length === 2 && state.dash);
    await page.evaluate(() => setView('dashboard'));
    const tiles = page.locator('#view-dashboard .tile.kind-page');
    await waitFor(async () => (await tiles.count()) === 2, { what: 'two page tiles' });
    assert.equal(await tiles.first().locator('.tile-title').innerText(), 'Weekly server health');
    assert.equal(await tiles.first().locator('.tile-page svg').count(), 1, 'a page mark');
    assert.ok((await tiles.nth(1).innerText()).includes('Post on Tuesday'), 'its first lines');
    assert.ok((await page.locator('#kp-board .kit-label').allInnerTexts()).includes('Weekly server health'), 'on home');
    await shot(page, 'wide-board');

    await tiles.nth(1).click();
    const btn = page.locator('[data-dv="board"]');
    await btn.waitFor();
    assert.equal(await btn.innerText(), 'On Board');
    await shot(page, 'wide-page');
    await btn.click();
    await waitFor(async () => (await page.locator('[data-dv="board"]').innerText()) === 'Board', { what: 'the button off' });
    await waitFor(async () => (await srv.api('/dashboard')).data.tiles.filter((t) => t.kind === 'page').length === 1, { what: 'the tile gone' });

    await page.evaluate(() => setView('pages'));
    const sw = page.locator('[data-page-board$="/reddit-launch-memo"]');
    await sw.waitFor({ state: 'attached' });
    assert.equal(await sw.isChecked(), false);
    await sw.evaluate((el) => { el.checked = true; el.dispatchEvent(new Event('change')); });
    await waitFor(async () => (await srv.api('/dashboard')).data.tiles.filter((t) => t.kind === 'page').length === 2, { what: 'back on the Board' });
    await shot(page, 'wide-pages');

    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    phone.on('pageerror', (e) => errors.push(e.message));
    await phone.goto(srv.base);
    await phone.waitForFunction(() => typeof setView === 'function' && state.dash?.tiles?.some((t) => t.kind === 'page'));
    await phone.evaluate(() => setView('dashboard'));
    await phone.locator('#view-dashboard .tile.kind-page').first().waitFor();
    await shot(phone, 'phone-board');
    await phone.evaluate(() => setView('pages'));
    await phone.locator('[data-page-board]').first().waitFor({ state: 'attached' });
    await shot(phone, 'phone-pages');

    assert.deepEqual(errors, []);
    console.log('ok: pages on the Board');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
