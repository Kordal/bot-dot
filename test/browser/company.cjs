// Optional browser check of the Company place (#669): node test/browser/company.cjs [shots dir]
// The switch "Bots | Company" opens the Company place; with no company the start screen is "New project" with one
// field (#801): its clip adds a link as a source chip; Go makes the company and the About step shows. Scratch data only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer } = require('../helpers');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    for (const [name, viewport] of [['wide', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
      const page = await (await browser.newContext({ viewport, colorScheme: 'dark' })).newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${srv.base}/`);
      const sw = page.locator('#place-switch [data-place="company"]');
      await sw.waitFor({ timeout: 20000 });
      await sw.click();
      await page.locator('#view-company h1', { hasText: 'New project' }).waitFor();
      assert.equal(await page.locator('[data-example]').count(), 0, 'no examples (#801)');
      assert.equal(await page.locator('#company-side [data-project]').count(), 0, 'no project yet');
      const go = page.locator('#co-ask .co-go');
      assert.equal(await go.isDisabled(), true);
      await page.locator('#co-ask [data-attach]').click();
      await page.locator('.ct-menu [data-add-link]').click();
      await page.locator('#co-link input').fill('linkedin.com/company/fernhill');
      await page.locator('#co-link input').press('Enter');
      await page.locator('.co-sources li', { hasText: 'linkedin.com/company/fernhill' }).locator('[data-unsource]').waitFor();
      if (shots) await page.screenshot({ path: path.join(shots, `${name}-start.png`), fullPage: true });
      if (name === 'wide') {
        await page.locator('#co-what').fill('fernhill.app');
        await go.click();
        await page.locator('.co-steps li.on', { hasText: 'About' }).waitFor();
        const c = (await srv.api('/company')).data.company;
        assert.deepEqual([c.kind, c.name, c.sources.map((s) => s.url)], ['site', 'Fernhill', ['linkedin.com/company/fernhill']]);
        if (shots) await page.screenshot({ path: path.join(shots, `${name}-about.png`) });
        await page.reload();
        await page.locator('.co-steps li.on', { hasText: 'About' }).waitFor({ timeout: 20000 });
        await page.locator('#place-switch [data-place="bots"]').click();
        assert.equal(await page.locator('#company-side').isVisible(), false);
        await srv.api('/company', { method: 'DELETE' });
      }
      assert.deepEqual(errors, []);
    }
    console.log('company: ok');
  } finally {
    if (browser) await browser.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
