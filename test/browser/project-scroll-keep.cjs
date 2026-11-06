// Optional browser check that a button keeps the project's page where it was: node test/browser/project-scroll-keep.cjs
// Scrolled down to the To-do, a filter draws the page again at the same place, also when the draw empties the page and
// lays it out for a moment (as WebKit does, so the desktop app on a Mac jumped to the top); another project's page
// opens at its top. A phone the same. Scratch data only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, writeData } = require('../helpers');

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const b = await makeBot(srv, { name: 'Demo', color: '#1d9e75' });
    assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'fernhill.app' } })).status, 201);
    const c = { ...(await srv.api('/company')).data.company, board: undefined };
    const at = new Date().toISOString();
    writeData(path.join(srv.data, 'company.json'), {
      ...c, phase: 'running', startedAt: at, teams: [{ id: 't1', name: 'T', color: '#34c759', bots: [b.id], lead: b.id }],
      todos: Array.from({ length: 40 }, (_, i) => ({ id: `d${i}`, text: `Task ${i}`, done: false, at })),
    });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await (await browser.newContext({ viewport, colorScheme: 'dark' })).newPage();
      await page.addInitScript(() => localStorage.setItem('botdot.projectChat', 'hidden'));
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${srv.base}/#company`);
      await page.locator('[data-cf-todo="d30"]').waitFor({ timeout: 20000 });
      // The home's draw empties the page and reads its layout first, as WebKit's does.
      await page.evaluate(() => {
        const draw = Company.steps.home;
        Company.steps.home = (root, c) => { root.innerHTML = ''; void root.scrollHeight; draw(root, c); };
      });
      const top = () => page.locator('#view-company').evaluate((el) => el.scrollTop);
      await page.locator('#view-company').evaluate((el) => { el.scrollTop = el.querySelector('[data-cf-todo="d30"]').getBoundingClientRect().top - el.getBoundingClientRect().top - 200; });
      const was = await top();
      assert.ok(was > 300, `scrolled down (${was})`);
      // A click that does not scroll the button into view first, as the owner's own.
      for (const f of ['you', 'all']) {
        await page.evaluate((k) => document.querySelector(`[data-cf-filter="${k}"]`).click(), f);
        await page.locator(`[data-cf-filter="${f}"].on`).waitFor();
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        assert.equal(await top(), was, `${viewport.width}: ${f} keeps the page where it was`);
      }
      // Another screen of the project (its settings) opens at its top.
      await page.evaluate(() => Company.openSettings());
      await page.waitForFunction(() => document.querySelector('#view-company').scrollTop === 0);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('project-scroll-keep: ok');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
