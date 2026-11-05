// Optional browser check of Settings → Storage: node test/browser/storage.cjs [screenshot folder]
// Settings links Storage; it shows the total, the bar and a row for each group, and the largest files. A group opens to
// what it holds and a folder to its own; a file's menu deletes after the question on its row, and the file leaves the
// page. The caches clear after the same question. Wide and on a phone. Scratch data and fake Claude only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, waitFor } = require('../helpers');

const SHOTS = process.argv[2] || '';
const MB = 1024 * 1024;
const write = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.alloc(bytes, 1)); };

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Researcher' });
    const other = await makeBot(srv, { name: 'Analyst' });
    const ws = (b) => path.join(srv.data, 'workspaces', b.id);
    write(path.join(ws(bot), 'node_modules', 'a', 'big.js'), 9 * MB);
    write(path.join(ws(bot), 'node_modules', 'b', 'lib.js'), 3 * MB);
    write(path.join(ws(bot), 'exports', 'report-2026.pdf'), 6 * MB);
    write(path.join(ws(bot), 'uploads', 'photo.jpg'), 2 * MB);
    write(path.join(ws(other), 'dataset.parquet'), 12 * MB);
    write(path.join(srv.data, 'homes', bot.id, '.cache', 'pip', 'wheel.whl'), 4 * MB);
    write(path.join(srv.data, 'homes', bot.id, '.claude', 'session.jsonl'), 2 * MB);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    for (const [label, viewport] of [['wide', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
      // Each pass starts from the same files, checked again.
      write(path.join(ws(bot), 'exports', 'report-2026.pdf'), 6 * MB);
      write(path.join(srv.data, 'homes', bot.id, '.cache', 'pip', 'wheel.whl'), 4 * MB);
      await srv.api('/storage/check', { method: 'POST' });
      await waitFor(async () => !(await srv.api('/storage')).data.checking, { timeout: 20_000 });
      const page = await (await browser.newContext({ viewport, deviceScaleFactor: SHOTS ? 2 : 1 })).newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${srv.base}/#settings`);
      await page.locator('#settings-links [data-go="storage"]').click();
      await page.locator('#view-storage .st-group').first().waitFor();
      await page.waitForFunction(() => !document.querySelector('#view-storage .st-check.spin'), null, { timeout: 20_000 });
      const groups = await page.locator('#view-storage .st-group b').allTextContents();
      assert.ok(groups.includes('Bots’ files') && groups.includes('Uploads') && groups.includes('Caches'), groups.join(', '));
      const largest = await page.locator('#view-storage .st-row .st-name').allTextContents();
      assert.ok(largest[0].startsWith('dataset.parquet'), largest.join(' | '));
      assert.equal(await page.locator('#view-storage .st-bar i').count(), groups.length);
      const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      assert.ok(noScroll, 'no sideways scroll');
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${label}-overview.png`), fullPage: true });

      // Bots' files → Researcher → node_modules: a folder opens to its own.
      await page.locator('#view-storage [data-st-open="bots"]').click();
      await page.locator('#view-storage [data-st-into="Researcher"]').click();
      assert.deepEqual((await page.locator('#view-storage .st-row .st-name').allTextContents()).slice(0, 2), ['node_modules', 'exports']);
      await page.locator('#view-storage [data-st-into="node_modules"]').click();
      assert.equal(await page.locator('#view-storage h1').textContent(), 'node_modules');
      await page.locator('#view-storage .st-crumbs [data-st-to="2"]').click();
      assert.equal(await page.locator('#view-storage h1').textContent(), 'Researcher');

      // A file's menu, then Delete asks on its row.
      await page.locator('#view-storage [data-st-into="exports"]').click();
      await page.locator('#view-storage [data-st-menu]').first().click();
      assert.deepEqual(await page.locator('#view-storage .st-menu button').allTextContents(), ['Open in Files', 'Ask the Chief', 'Delete…']);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${label}-menu.png`), fullPage: true });
      await page.locator('#view-storage [data-st-delete]').click();
      assert.match(await page.locator('#view-storage .st-confirm span').textContent(), /^Delete report-2026\.pdf\? 6\.3 MB\.$/);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${label}-delete.png`), fullPage: true });
      if (label === 'wide') {
        await page.locator('#view-storage [data-st-yes]').click();
        await page.waitForFunction(() => !document.querySelector('#view-storage .st-confirm'));
        assert.equal(fs.existsSync(path.join(ws(bot), 'exports', 'report-2026.pdf')), false);
        assert.equal(await page.locator('#view-storage .st-row', { hasText: 'report-2026.pdf' }).count(), 0);
      } else {
        await page.locator('#view-storage [data-st-cancel]').click();
        assert.equal(await page.locator('#view-storage .st-confirm').count(), 0);
      }

      // Back to the overview: the caches clear after the question.
      await page.locator('#view-storage .st-crumbs [data-st-to="0"]').click();
      if (label === 'wide') {
        await page.locator('#view-storage [data-st-clear]').click();
        assert.match(await page.locator('#view-storage .st-confirm span').textContent(), /^Clear the caches\? 4\.\d MB\.$/);
        await page.locator('#view-storage [data-st-yes]').click();
        await page.waitForFunction(() => !document.querySelector('#view-storage [data-st-clear]'));
        assert.equal(fs.existsSync(path.join(srv.data, 'homes', bot.id, '.cache', 'pip')), false);
      }
      assert.deepEqual(errors, []);
      await page.context().close();
    }
    console.log('storage: ok');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await srv.stop();
  }
})();
