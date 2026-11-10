// Optional browser check of Passwords: node test/browser/vault-search.cjs [shots dir]
// An unlocked Bitwarden with a long account line: its name, the account line and Sync/Lock never overlap, the line
// ends in "… · 58 items". A list of 12 has the search field: typing filters the rows, nothing found says so, and
// Escape clears it. Wide and phone, Chromium. The server's answers for the Vault are stand-ins; scratch data only.
const assert = require('node:assert/strict');
const path = require('node:path');
const playwright = require('playwright');
const { startServer } = require('../helpers');

const SHOTS = process.argv[2];
const BW = { configured: true, installed: true, unlocked: true, email: 'someone-with-a-long-name@agentmail.example', items: 58, lastSync: new Date().toISOString() };
const ITEMS = ['Albert Heijn|ah.be', 'Amazon|amazon.com.be', 'Beszel|100.64.229.89', 'Beszel STG|100.69.196.6', 'bpost|bpost.be', 'Bank|bank.example',
  'Calendar|cal.example', 'Docs|docs.example', 'Energy|energy.example', 'Forum|forum.example', 'Garden shop|garden.example', 'Health|health.example']
  .map((s, i) => { const [name, site] = s.split('|'); return { id: `i${i}`, name, site, username: `user${i}`, kind: 'login', type: 'login', allowedBots: [], allowedHosts: [] }; });

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    browser = await playwright.chromium.launch({ headless: true });
    const errors = [];
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const at = `${viewport.width} wide`;
      const page = await (await browser.newContext({ viewport })).newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('**/api/vault', (r) => r.fulfill({ json: ITEMS }));
      await page.route('**/api/vault/bitwarden', (r) => r.fulfill({ json: BW }));
      await page.goto(`${srv.base}/`);
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => setView('vault'));
      await page.locator('#vault-search').waitFor();
      await page.waitForTimeout(600); // the page slides in
      const shot = (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${viewport.width}-${name}.png`) });

      // The Bitwarden row: name, account line, buttons side by side, none over another.
      const boxes = await page.$$eval('.bw-bar > *', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, over: e.tagName === 'B' && e.scrollWidth > e.clientWidth + 0.5, t: e.textContent.trim() }; }));
      assert.equal(boxes[0].over, false, `${at}: "Bitwarden" fits its box`);
      for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].l >= boxes[i - 1].r - 0.5, `${at}: "${boxes[i].t}" starts after "${boxes[i - 1].t}"`);
      assert.equal(boxes[0].t, 'Bitwarden');
      assert.match(boxes[1].t, / · 58 items$/);
      await shot('vault');

      const rows = () => page.locator('.vault-list [data-edit-login]:visible').count();
      assert.equal(await rows(), 12);
      await page.fill('#vault-search', 'beszel');
      assert.equal(await rows(), 2, `${at}: two Beszel`);
      await page.fill('#vault-search', '100.69');
      assert.equal(await rows(), 1, `${at}: by address`);
      await shot('found');
      await page.fill('#vault-search', 'zzz');
      assert.equal(await rows(), 0);
      assert.equal(await page.locator('#vault-none').isVisible(), true, `${at}: nothing found says so`);
      await shot('none');
      await page.press('#vault-search', 'Escape');
      assert.equal(await rows(), 12, `${at}: Escape clears it`);
      assert.equal(await page.locator('#vault-none').isVisible(), false);
    }
    assert.deepEqual(errors, []);
    console.log('ok: Passwords search and the Bitwarden row');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
