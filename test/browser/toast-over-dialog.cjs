// Optional browser check that a toast raised while a dialog is open can be read:
//   NODE_PATH=<directory containing playwright> node test/browser/toast-over-dialog.cjs
// Importing a skill from a link the server refuses says why, on top of the dialog and not under it or its
// dimmed backdrop; so does a toast raised before the dialog opened and one raised again. Scratch data only.
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { chromium } = require('playwright');
const { startServer, waitFor } = require('../helpers');

const REFUSAL = 'That link is not a skill.';

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const errors = [];
    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('**/api/skills/import/preview', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: REFUSAL }) }));
      await page.goto(`${srv.base}/#skills`);
      // What is drawn where the toast is: 'toast' when the pixel just inside its left end has its own colour.
      // Read from a screenshot, because a page behind a dialog is inert and so cannot be asked what is at a point.
      const onTop = async () => {
        const t = await page.evaluate(() => {
          const el = document.querySelector('#toast');
          const r = el.getBoundingClientRect();
          if (el.classList.contains('hidden') || !r.width) return null;
          return { text: el.textContent, x: Math.round(r.left + 7), y: Math.round(r.top + r.height / 2), color: getComputedStyle(el).backgroundColor.match(/\d+/g).slice(0, 3).map(Number) };
        });
        if (!t) return null;
        const png = await page.screenshot({ clip: { x: t.x, y: t.y, width: 1, height: 1 } });
        // One pixel: the first row's filter byte, then its red, green and blue.
        const idat = [];
        for (let i = 8; i < png.length; i += 12 + png.readUInt32BE(i)) if (png.toString('latin1', i + 4, i + 8) === 'IDAT') idat.push(png.subarray(i + 8, i + 8 + png.readUInt32BE(i)));
        const drawn = [...zlib.inflateSync(Buffer.concat(idat)).subarray(1, 4)];
        return { text: t.text, hit: drawn.every((c, i) => Math.abs(c - t.color[i]) <= 2) ? 'toast' : `rgb(${drawn})` };
      };
      const at = `${viewport.width} wide`;

      await page.locator('#import-skill').click();
      await page.locator('#import-form input[name=url]').fill('https://example.com/not-a-skill');
      await page.locator('#import-go').click();
      await waitFor(async () => (await onTop())?.text === REFUSAL, { what: 'the refusal as a toast' });
      assert.deepEqual(await onTop(), { text: REFUSAL, hit: 'toast' }, `${at}: the refusal is on top of the import dialog`);

      // Refused again while the first toast still shows: still on top.
      await page.locator('#import-go').click();
      await waitFor(async () => (await page.locator('#import-go').innerText()) === 'Preview', { what: 'the second refusal' });
      assert.equal((await onTop()).hit, 'toast', `${at}: a second toast is on top too`);

      // A toast that was showing before a dialog opened does not cover what it did not cover before, and the next one is on top.
      await page.locator('#import-form [data-dismiss]').first().click();
      await page.evaluate(() => toast('Saved'));
      await page.locator('#import-skill').click();
      await page.evaluate(() => toast('Not saved', true));
      assert.deepEqual(await onTop(), { text: 'Not saved', hit: 'toast' }, `${at}: a toast after the dialog opened is on top`);
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log('PASS: a toast raised while a dialog is open is drawn on top of it, at phone and desktop width; no browser errors.');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
