// Optional browser check of Settings → Backups (ADR 158): node test/browser/backup-download.cjs [shots dir]
// The row says when the account's data last went off-site, as the front door told it; Download, with a passphrase typed
// twice, saves an encrypted .bdb named with the account that restores with that passphrase. Wide and phone, in
// Chromium (or BROWSER=webkit). Scratch data only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const playwright = require('playwright');
const { startServer, makeBot } = require('../helpers');

const SHOTS = process.argv[2];
const PASS = 'correct horse battery';

(async () => {
  const srv = await startServer();
  const other = await startServer();
  let browser;
  const saved = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-download-'));
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    await makeBot(srv, { name: 'Home Keeper' });
    const engine = playwright[process.env.BROWSER || 'chromium'];
    browser = await engine.launch({ headless: true, ...(process.env.CHROME_PATH && !process.env.BROWSER ? { executablePath: process.env.CHROME_PATH } : {}) });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const at = `${viewport.width} wide`;
      const page = await (await browser.newContext({ viewport, acceptDownloads: true })).newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const shot = (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${viewport.width}-${name}.png`) });
      const card = page.locator('#backups-card');
      const open = async () => {
        await page.goto('about:blank');
        await page.goto(`${srv.base}/#settings`);
        await card.locator('.bs-val').filter({ hasNotText: 'Checking…' }).waitFor();
        if (!(await card.evaluate((d) => d.open))) await card.locator('summary').click();
      };

      // Off until the front door says otherwise.
      await srv.api('/backups/offsite', { method: 'POST', headers: { 'x-botdot-room': '1' }, body: { state: 'off' } });
      await open();
      assert.equal(await card.locator('.bs-val').textContent(), 'Off', at);
      await shot('off');

      const when = new Date(Date.now() - 3 * 3600_000).toISOString();
      await srv.api('/backups/offsite', { method: 'POST', headers: { 'x-botdot-room': '1' }, body: { state: 'done', lastSuccess: when, late: false } });
      await open();
      assert.equal(await card.locator('.bs-val').textContent(), '3h ago', at);

      // Two that differ: nothing is asked of the server.
      await card.locator('input[name=p1]').fill(PASS);
      await card.locator('input[name=p2]').fill(`${PASS}!`);
      await card.locator('button').click();
      await page.locator('.toast', { hasText: "The two don't match" }).waitFor();
      await card.locator('input[name=p2]').fill(PASS);
      await shot('download');
      const [download] = await Promise.all([page.waitForEvent('download'), card.locator('button').click()]);
      assert.match(download.suggestedFilename(), /^bot-dot-tester-\d{8}-\d{6}\.bdb$/, at);
      const file = path.join(saved, `${viewport.width}.bdb`);
      await download.saveAs(file);
      const bytes = fs.readFileSync(file);
      assert.equal(bytes.subarray(0, 10).toString(), 'BDBACKUP2\n', `${at}: a backup`);
      assert.ok(!bytes.includes('Home Keeper'), `${at}: encrypted`);
      assert.equal(await card.locator('input[name=p1]').inputValue(), '', `${at}: the passphrase is not left on the page`);

      // It restores with that passphrase.
      const up = await other.api('/backups/upload', { method: 'POST', raw: bytes });
      const wrong = await other.api('/backups/restore', { method: 'POST', body: { file: up.data.file, passphrase: 'not the passphrase' } });
      assert.match(wrong.data.error, /Wrong passphrase/, at);

      // A failed run: the row says so, red, and when the last good one was.
      await srv.api('/backups/offsite', { method: 'POST', headers: { 'x-botdot-room': '1' }, body: { state: 'failed', lastSuccess: when, late: true } });
      await open();
      assert.equal(await card.locator('.bs-val').textContent(), 'Failed', at);
      assert.ok(await card.locator('.bs-val.bs-late').count(), `${at}: red`);
      assert.match(await card.locator('.bs-body').textContent(), /Last backup 3h ago/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${at}: no sideways scroll`);
      await shot('failed');
      assert.deepEqual(errors, [], at);
    }
    console.log('backup download: ok');
  } finally {
    await browser?.close();
    await srv.stop();
    await other.stop();
    fs.rmSync(saved, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
