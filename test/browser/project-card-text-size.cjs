// Optional browser check of a card's text size (card-text-size): node test/browser/project-card-text-size.cjs [outdir]
// The large A on a card's menu draws its text larger at once and keeps the menu open; botdot keeps the size; the
// small A at the normal size is off; a refusal puts the size back. With outdir, screenshots wide and phone. Scratch data only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, writeData, waitFor } = require('../helpers');

(async () => {
  const out = process.argv[2];
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const lead = await makeBot(srv, { name: 'Demo', color: '#1d9e75' });
    assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'botdot.app' } })).status, 201);
    const c = (await srv.api('/company')).data.company;
    writeData(path.join(srv.data, 'company.json'), { ...c, phase: 'running', startedAt: new Date(Date.now() - 3_600_000).toISOString(), teams: [{ id: 't1', name: 'T', color: '#34c759', bots: [lead.id], lead: lead.id }] });
    const at = new Date().toISOString();
    writeData(path.join(srv.data, 'project-cards.json'), { [c.id]: [
      { id: 'k1', ask: 'Signups', title: 'Signups today', state: 'ready', at, answers: [], apps: [], body: { show: 'number', value: '42', sub: '+6 today', tone: 'ok' } },
      { id: 'k2', ask: 'Open bugs', title: 'Open bugs', state: 'ready', at, answers: [], apps: [], body: { show: 'list', value: '3', list: [{ ref: '#12', text: 'Login loops' }, { ref: '#14', text: 'Slow search' }] } },
    ] });
    const sized = async () => (await srv.api('/company')).data.company.cards.find((k) => k.id === 'k1').textSize;

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#company`);
    const big = page.locator('[data-pc-card="k1"] .pc-big b');
    await big.waitFor({ timeout: 20000 });
    // The card is drawn again as botdot's answers come: read it until it stands.
    const px = async () => { try { return parseFloat(await big.evaluate((el) => getComputedStyle(el).fontSize, null, { timeout: 2000 })); } catch { return NaN; } };
    const normal = await waitFor(async () => { const n = await px(); return Number.isFinite(n) && n; }, { what: 'the card drawn' });

    await page.locator('[data-pc-menu="k1"]').click();
    const smaller = page.locator('[data-pc-size="k1"][data-pc-step="-1"]');
    const larger = page.locator('[data-pc-size="k1"][data-pc-step="1"]');
    assert.ok(await smaller.isDisabled(), 'no smaller than normal');
    await larger.click();
    await larger.click();
    await waitFor(async () => (await px()) === normal * 1.5, { what: 'the text 1.5 times as large' });
    assert.ok(await larger.isVisible(), 'the menu stays open');
    await waitFor(async () => (await sized()) === 1.5, { what: 'botdot keeps 1.5' });
    if (out) await page.locator('[data-pc-card="k1"]').screenshot({ path: path.join(out, 'wide-menu.png') });
    await page.mouse.click(5, 5);
    if (out) await page.locator('.pc-row, .bc-wrap').first().screenshot({ path: path.join(out, 'wide.png') });

    // A refusal puts the size back.
    await page.route(/\/api\/company\/cards\//, (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'No.' }) }));
    await page.locator('[data-pc-menu="k1"]').click();
    await larger.click();
    await waitFor(async () => (await px()) === normal * 1.5, { what: 'back to 1.5' });
    await page.unroute(/\/api\/company\/cards\//);

    // Drawn again from botdot, on a new page: the size stays.
    await page.goto('about:blank');
    await page.goto(`${srv.base}/#company`);
    await big.waitFor({ timeout: 20000 });
    await waitFor(async () => (await px()) === normal * 1.5, { what: 'the size kept' });
    if (out) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(400);
      await page.locator('[data-pc-card="k1"]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await page.screenshot({ path: path.join(out, 'phone.png') });
    }
    assert.deepEqual(errors, []);
    console.log('project-card-text-size: ok');
  } finally {
    await browser?.close();
    await srv.stop?.();
  }
})().catch((e) => { console.error(e); process.exit(1); });
