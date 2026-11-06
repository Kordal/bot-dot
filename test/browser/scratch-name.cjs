// Optional browser check of Start from scratch (#857): node test/browser/scratch-name.cjs [shots dir]
// It asks the project's name first, Back returns to the start screen with what was typed, and Go makes the empty
// project under that name, its folder named after it, with the sources added on the start screen. Scratch data only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, writeData } = require('../helpers');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const seen = (await srv.api('/whats-new')).data.entries || [];
    if (seen.length) await srv.api('/whats-new/seen', { method: 'POST', body: { id: seen[0].id } });
    writeData(path.join(srv.data, 'company.json'), { projects: [{ id: 'p1', name: 'Botdot', start: 'botdot.app', kind: 'site', phase: 'running', startedAt: new Date().toISOString(), teams: [] }] });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    for (const [label, viewport] of [['wide', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
      const page = await (await browser.newContext({ viewport, colorScheme: 'dark' })).newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${srv.base}/#company`);
      // "+" → New project (#853), as the rail's + or the phone's sheet opens it.
      await page.waitForFunction(() => typeof Company !== 'undefined' && Company.projects().length);
      await page.evaluate(() => Company.startNew());
      await page.locator('#co-what').fill('A half typed idea');
      // A link added before Start from scratch stays the project's source.
      await page.locator('#co-ask [data-attach]').click();
      await page.locator('.ct-menu [data-add-link]').click();
      await page.locator('#co-link input').fill(`https://garden.club/${label}`);
      await page.locator('#co-link input').press('Enter');
      await page.locator('.co-sources li', { hasText: `garden.club/${label}` }).waitFor();
      await page.locator('[data-start-empty]').click();
      const name = page.locator('#co-name input');
      await name.waitFor();
      assert.equal(await page.locator('#co-what').count(), 0, 'the idea field is gone while naming');
      assert.ok(await page.locator('#co-name .co-go').isDisabled(), 'Go waits for a name');
      if (shots) await page.screenshot({ path: path.join(shots, `${label}-name.png`) });
      await page.locator('[data-start-back]').click();
      assert.equal(await page.locator('#co-what').inputValue(), 'A half typed idea', 'Back keeps what was typed');
      await page.locator('[data-start-empty]').click();
      await name.fill(`Garden club ${label}`);
      await name.press('Enter');
      await page.locator('.cf-top h1, .co-pick-line, h1', { hasText: `Garden club ${label}` }).first().waitFor();
      if (shots) await page.screenshot({ path: path.join(shots, `${label}-made.png`) });
      const made = (await srv.api('/company/list')).data.projects.find((p) => p.name === `Garden club ${label}`);
      assert.ok(made, 'made under the name');
      assert.equal(made.folder.name, `Garden club ${label}`);
      assert.deepEqual(made.sources.map((x) => x.url), [`https://garden.club/${label}`], 'the link of the start screen kept');
      // And the project's settings list it.
      await page.evaluate(() => Company.openSettings());
      await page.locator('#ps-general .ps-list .ps-item', { hasText: `garden.club/${label}` }).waitFor();
      assert.deepEqual(errors, []);
    }
    console.log('PASS scratch-name');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
