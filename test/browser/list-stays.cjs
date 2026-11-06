// Optional browser check that the list, the keypad and a phone's home stay as they are when nothing in them changed
// (#1065): node test/browser/list-stays.cjs
// The list is drawn again ten times, as a working line elsewhere makes it: its rows and keys are the same nodes, a key
// keeps its focus, and a click between a press and its release opens the chat. A real change still draws it.
// Scratch data and fake Claude only. CHROME_PATH picks the browser.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer, makeBot, sleep } = require('../helpers');

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Quotz' });
    await makeBot(srv, { name: 'Mailer' });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const errors = [];
    for (const width of [1280, 390]) {
      const page = await (await browser.newContext({ viewport: { width, height: 860 } })).newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${srv.base}/`);
      await page.waitForFunction(() => document.querySelector('#contacts [data-contact]') && document.querySelector('#kp-keys [data-key]'));
      await sleep(500);
      const marks = await page.evaluate(() => {
        const all = [...document.querySelectorAll('#contacts [data-contact], #kp-keys [data-key], #kp-sections [data-section-key], #kp-chief, #kp-board [data-board]')];
        all.forEach((el) => { el.dataset.mark = 'kept'; });
        document.querySelector('#kp-keys [data-key]')?.focus();
        let drawn = 0;
        const watch = new MutationObserver((list) => { drawn += list.filter((m) => m.type === 'childList').length; });
        for (const id of ['contacts', 'kp-keys', 'kp-sections', 'kp-chief', 'kp-board', 'kp-phone-board']) { const el = document.getElementById(id); if (el) watch.observe(el, { childList: true }); }
        for (let i = 0; i < 10; i++) renderContacts();
        const left = all.filter((el) => !el.isConnected).length;
        const recs = watch.takeRecords().filter((m) => m.type === 'childList');
        drawn += recs.length;
        const where = [...new Set(recs.map((m) => m.target.id || m.target.className))];
        const focused = document.activeElement?.dataset?.mark === 'kept';
        watch.disconnect();
        return { count: all.length, left, drawn, focused, where };
      });
      assert.ok(marks.count > 4, `${width}: rows and keys found (${marks.count})`);
      assert.deepEqual([marks.left, marks.drawn], [0, 0], `${width}: nothing drawn again (${marks.where})`);
      if (width > 1000) assert.ok(marks.focused, 'a key keeps its focus');
      // A press, ten redraws, the release: the chat opens.
      const row = page.locator(width > 1000 ? `#kp-keys [data-key]:has-text("Quotz")` : `#contacts [data-contact="${bot.id}"], #kp-sections [data-section-key]:has-text("Quotz")`).first();
      if (await row.isVisible()) {
        const b = await row.boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.down();
        await page.evaluate(() => { for (let i = 0; i < 10; i++) renderContacts(); });
        await page.mouse.up();
        await page.waitForFunction((id) => location.hash.includes(id), bot.id, { timeout: 3000 });
      }
      // A real change draws the list again.
      const changed = await page.evaluate((id) => { state.bots.find((b) => b.id === id).name = 'Quotz Two'; renderContacts(); return document.querySelector('#contacts')?.textContent.includes('Quotz Two'); }, bot.id);
      assert.ok(changed, `${width}: a change is drawn`);
    }
    assert.deepEqual(errors, []);
    console.log('list-stays: ok');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
