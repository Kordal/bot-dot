// Optional browser check that a page left open across an update loads the new version by itself (public/fresh.js):
//   NODE_PATH=<directory containing playwright> node test/browser/fresh.cjs
// The update is played by the server's GET /api/version saying other files (`web`); the page then loads itself again
// within a minute, but not over text typed and not sent. Scratch data only.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer, waitFor } = require('../helpers');

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let updated = false;
    await page.route('**/api/version', async (r) => {
      const res = await r.fetch();
      const v = await res.json();
      await r.fulfill({ response: res, json: updated ? { ...v, web: 'after-update' } : v });
    });
    let loads = 0;
    page.on('load', () => loads++);
    await page.clock.install();
    await page.goto(`${srv.base}/#chief`);
    await page.locator('textarea[name=text]').first().waitFor();
    assert.equal(loads, 1);

    // Nothing changed: an hour open, no reload.
    await page.clock.runFor(61_000);
    await page.clock.runFor(61_000);
    assert.equal(loads, 1, 'the same files: no reload');

    // The update, while the owner has typed something not sent: the page waits.
    updated = true;
    await page.locator('textarea[name=text]').first().fill('half a message');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.clock.runFor(61_000);
    await page.clock.runFor(20_000);
    assert.equal(loads, 1, 'not over unsent text');

    // Sent or cleared: it loads itself again.
    await page.locator('textarea[name=text]').first().fill('');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.clock.runFor(10_000);
    await waitFor(() => loads === 2, { what: 'the page loading itself again' });
    assert.match(page.url(), /#chief/, 'on the view it showed');
    assert.deepEqual(errors, []);
    console.log('PASS  a page open across an update loads the new version by itself, never over unsent text');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
