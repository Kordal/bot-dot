// Optional browser check: NODE_PATH=<directory containing playwright> node test/browser/sub-back.cjs [shots dir]
// Vault opened from Setup goes back to Setup, and says so; opened from Settings, back to Settings.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer } = require('../helpers');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const back = page.locator('#view-vault .sub-back');

    await page.goto(`${srv.base}/#setup`);
    await page.locator('#view-setup [data-setup-go="vault"]').click();
    await back.waitFor();
    assert.equal((await back.innerText()).trim(), 'Setup');
    if (shots) await page.screenshot({ path: path.join(shots, 'vault-from-setup.png') });
    await back.click();
    await page.locator('#view-setup:not(.hidden)').waitFor();

    await page.locator('#more-btn').click();
    await page.locator('#settings-links [data-go="vault"]').click();
    await page.locator('#view-vault .sub-back', { hasText: 'Settings' }).waitFor();
    await back.click();
    await page.locator('#view-settings:not(.hidden)').waitFor();

    assert.deepEqual(errors, []);
    console.log('PASS  sub pages go back where they were opened from');
  } finally {
    if (browser) await browser.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
