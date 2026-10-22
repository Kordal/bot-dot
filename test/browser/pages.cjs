// Optional browser check of Pages (#346): NODE_PATH=<directory containing playwright> node test/browser/pages.cjs [shots dir]
// A bot saves a page: its chip under the reply opens it beside the chat with "Page by <bot> · updated …", HTML in it
// stays text, Keep up to date makes the job with no card and the bar then says what keeps it, and the bot's settings
// list the page. Scratch data and the stand-in Claude only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, heldRun, self } = require('../helpers');

const PAGE = `# hq weekly health

Week 43 · 16–22 Oct · from the server's own numbers

| Bot | Runs | Avg time | Failed |
| --- | ---: | ---: | --- |
| Scout | 164 | 48 s | 2 |
| Chief of Staff | 121 | 1 m 12 s | 0 |
| Ops | 77 | 31 s | 9 |

## What to fix

- [ ] **Old images** take 38 GB. Prune keeps the last two versions and frees ~30 GB.
- [x] Backup job moved to 04:30, after the image build.

<script>alert(1)</script>`;

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Ops', color: '#45c78e' });
    const { run, rec, token } = await heldRun(srv, bot, 'Make me a page with hq health this week');
    await self(srv, token, 'page', { title: 'hq weekly health', markdown: PAGE, sources: 'Disk, RAM and runs per bot over the last 7 days; flag anything over 85%.' });
    srv.reply('Done. Disk is the one to watch: 81% and growing. I put a cleanup step at the end.');
    srv.release(rec);
    await srv.finished(run.id);
    srv.unhold();

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => { errors.push(`dialog: ${d.message()}`); d.dismiss(); });
    await page.goto(`${srv.base}/#bot/${bot.id}`);

    const chip = page.locator('#bot-thread .page-chip', { hasText: 'hq weekly health' });
    await chip.waitFor({ timeout: 20000 });
    await chip.click();
    const viewer = page.locator('#doc-viewer');
    await viewer.locator('.dv-md h1', { hasText: 'hq weekly health' }).waitFor();
    assert.match(await viewer.locator('.dv-title span').innerText(), /^Page by Ops · updated just now$/);
    assert.match(await viewer.locator('.dv-md').innerText(), /<script>alert\(1\)<\/script>/, 'HTML stays text');
    assert.equal(await viewer.locator('.dv-md script').count(), 0);
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-page.png') });

    await viewer.locator('[data-dv="keep"]').click();
    const sheet = page.locator('#modal');
    await sheet.locator('#pg-go').waitFor();
    assert.match(await sheet.locator('#pg-check').inputValue(), /Disk, RAM and runs per bot/, "prefilled from the page's sources");
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-keep.png') });
    await sheet.locator('#pg-go').click();
    await viewer.locator('.pg-keep', { hasText: 'Keeps up to date · Daily at 07:00' }).waitFor();
    const jobs = (await srv.api(`/bots/${bot.id}/jobs`)).data;
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].approved, true, 'no card');
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-kept.png') });

    await page.setViewportSize({ width: 390, height: 844 });
    if (shots) await page.screenshot({ path: path.join(shots, 'phone-page.png') });
    await page.setViewportSize({ width: 1440, height: 900 });
    await viewer.locator('.dv-close').click(); // while a page is open, the settings panel waits (viewer.js)
    await page.locator('#bot-settings').click();
    const row = page.locator('#page-list .pg-row', { hasText: 'hq weekly health' });
    await row.waitFor({ timeout: 20000 });
    assert.match(await row.innerText(), /Daily at 07:00/);
    if (shots) await page.locator('#bs-pages').screenshot({ path: path.join(shots, 'settings-pages.png') });
    assert.deepEqual(errors, []);
    console.log('PASS  pages in the browser');
  } finally {
    await browser?.close();
    srv.unhold?.();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
