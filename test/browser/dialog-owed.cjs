// Optional browser check that what the feed says while a dialog is open is drawn when it closes (#1067):
//   node test/browser/dialog-owed.cjs
// A dialog is open; a bot appears and the feed says so: nothing is read under the dialog. The dialog closes: the list
// is read at once and shows the new bot, not a minute later. Scratch data and fake Claude only. CHROME_PATH picks the browser.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer, makeBot, sleep } = require('../helpers');

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    await makeBot(srv, { name: 'Quotz' });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/`);
    await page.waitForFunction(() => state.feed?.readyState === 1 && document.querySelector('#contacts [data-contact]'));
    await sleep(1000);
    let reads = 0;
    page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/bots' && r.method() === 'GET') reads++; });
    await page.evaluate(() => openModal('<p>A dialog</p><button data-dismiss>Close</button>'));
    await makeBot(srv, { name: 'Mailer' }); // the feed says `bots`
    await sleep(1500);
    assert.equal(reads, 0, 'nothing is read under the dialog');
    assert.equal(await page.evaluate(() => state.refreshOwed), true);
    await page.click('#modal [data-dismiss]');
    await page.waitForFunction(() => document.querySelector('#contacts')?.textContent.includes('Mailer'), null, { timeout: 3000 });
    assert.ok(reads >= 1, 'read when the dialog closed');
    assert.equal(await page.evaluate(() => state.refreshOwed), false);
    assert.deepEqual(errors, []);
    console.log('dialog-owed: ok');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
