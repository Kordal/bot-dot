// Optional browser check of objectives that update themselves (#699): node test/browser/objective-sources.cjs [shots dir]
// A running project with Stripe connected: "Update from an app" in a goal's Show as menu opens the form with the
// connected apps; Save sets the source, and the card shows the app and when it last updated, or that it couldn't.
// Stop updating takes it away. A phone too. Scratch data only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, writeData, fakeConnectedApp } = require('../helpers');

(async () => {
  const shots = process.argv[2] || null;
  const app = await fakeConnectedApp({ connected: ['stripe'] });
  const srv = await startServer({ env: { ...app.env, BOT_DOT_SOURCES_EVERY_MS: '600000' } });
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    await app.connect(srv);
    assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'mealwise.app' } })).status, 201);
    const base = { ...(await srv.api('/company')).data.company, board: undefined }; // every piece on the board (#780)
    const file = path.join(srv.data, 'company.json');
    const objectives = [
      { id: 'o1', name: 'Paying users', current: 12, target: 50, color: '#34c759', history: [{ day: 1, value: 0 }, { day: 6, value: 12 }] },
      { id: 'o2', name: 'Weekly users', current: 140, target: 500, color: '#ff7a45', source: { app: 'stripe', what: 'Weekly users', every: 'daily', triedAt: new Date().toISOString(), failed: 'no access to analytics' } },
    ];
    writeData(file, { ...base, phase: 'running', startedAt: new Date(Date.now() - 8 * 86_400_000).toISOString(), objectives });
    srv.reply('17');

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    for (const [name, viewport] of [['wide', { width: 1440, height: 1000 }], ['phone', { width: 390, height: 844 }]]) {
      const page = await (await browser.newContext({ viewport, colorScheme: 'dark' })).newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${srv.base}/#company`);
      const paying = page.locator('[data-cf-goal="o1"]');
      await paying.waitFor({ timeout: 20000 });
      assert.equal(await page.locator('[data-cf-goal="o2"] .cf-src.failed').innerText(), "Stripe · Couldn't update");
      if (name === 'wide') {
        await paying.locator('[data-cf-show]').click();
        await paying.locator('[data-cf-source]').click();
        const form = paying.locator('.cf-source');
        await form.locator('select option[value="stripe"]').waitFor({ state: 'attached' });
        await form.locator('input').fill('Active subscriptions');
        if (shots) await page.screenshot({ path: path.join(shots, `${name}-form.png`) });
        await form.locator('button[type="submit"]').click();
        await paying.locator('.cf-source').waitFor({ state: 'detached' });
        const kept = (await srv.api('/company')).data.company.objectives[0].source;
        assert.deepEqual([kept.app, kept.what, kept.every], ['stripe', 'Active subscriptions', 'daily']);
        await paying.locator('.cf-src', { hasText: /^Stripe · (just now|\d+[smh] ago|Updating…)$/ }).waitFor();
        await page.waitForFunction(() => /ago|now/.test(document.querySelector('[data-cf-goal="o1"] .cf-src')?.textContent || ''), null, { timeout: 15000 });
      }
      if (shots) await page.screenshot({ path: path.join(shots, `${name}-cards.png`) });
      if (name === 'wide') {
        await paying.locator('[data-cf-show]').click();
        await paying.locator('[data-cf-source]').click();
        await paying.locator('[data-cf-source-stop]').click();
        await paying.locator('.cf-src').waitFor({ state: 'detached' });
      }
      assert.deepEqual(errors, []);
    }
    console.log('OK objective sources: form, last update, failure, stop');
  } finally {
    await browser?.close();
    await srv.stop();
    app.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
