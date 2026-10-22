// Optional browser check of a reply opened as a document (#348): NODE_PATH=<directory containing playwright> node test/browser/document-page.cjs [shots dir]
// A long reply has "Open as document", a short one none; the button opens the document in a tab of its own at its
// own address, which survives a reload: its title, its sections beside it, Back to chat, and Export downloads a Word
// file and a Markdown file. Scratch data and the stand-in Claude only.
const assert = require('node:assert/strict');
const path = require('path');
const { chromium } = require('playwright');
const { startServer, makeBot } = require('../helpers');

const SHOTS = process.argv[2];
const REPORT = `## Ads budget for the Belgian contractor

**Recommendation: use Meta for the first month.** It is the only one of the three where €150 buys enough clicks to learn from. None of the figures below are Belgium-specific for contractors, so the real numbers are unknown until a test runs.

## What €150/month buys

| Channel | Cost range found | Rough result at €150 (my arithmetic) |
| --- | --- | --- |
| **Meta** | CPM about $7–10 for Belgium. CPC $1.20 in one source, €0.18 in another. | About 15–20k impressions. About 125 clicks at $1.20, or up to roughly 800 at €0.18. |
| **Google Search** | No Belgian figure found. US contractor CPC is about $5–8, and remodeling keywords run $8–20. | Roughly 20–30 clicks, and fewer if the real Belgian CPC is nearer the high end. |
| **TikTok** | CPM about €4–9 for Belgian SMEs. No CPC found. | About 17–37k impressions, but the platform floor is the problem. |

## Meta

- The sources are ecommerce-based and not contractor-specific.
- Belgian reach needs separate Dutch and French targeting.

## Google Search

All sources are US-based. Splitting Dutch and French halves an already small budget.

## TikTok

The minimum daily budget eats most of €150 in a few days.`;

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Qwotz Research' });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    srv.reply('Short answer: yes.');
    let run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Quick?' } })).data;
    await srv.finished(run.id);
    srv.reply(REPORT);
    run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Where should €150/month of ads go?' } })).data;
    await srv.finished(run.id);

    await page.goto(`${srv.base}/#bot/${bot.id}`);
    const long = page.locator('#bot-thread .bubble', { hasText: 'Recommendation' }).last();
    await long.waitFor();
    assert.equal(await page.locator('#bot-thread .bubble', { hasText: 'Short answer' }).locator('.doc-open').count(), 0, 'a short reply has no button');
    const open = long.locator('.doc-open');
    assert.equal(await open.textContent(), 'Open as document');
    assert.equal(await open.getAttribute('target'), '_blank');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'chat.png') });

    const [tab] = await Promise.all([context.waitForEvent('page'), open.click()]);
    tab.on('pageerror', (e) => errors.push(e.message));
    await tab.locator('.doc-md table').waitFor();
    assert.equal(new URL(tab.url()).hash, `#doc/run/${run.id}`);
    assert.equal(await tab.title(), 'Ads budget for the Belgian contractor · botdot');
    assert.match(await tab.locator('.doc-crumb').textContent(), /Qwotz Research.*Ads budget for the Belgian contractor/);
    assert.deepEqual(await tab.locator('.doc-toc a').allTextContents(), ['What €150/month buys', 'Meta', 'Google Search', 'TikTok']);
    assert.equal(await tab.locator('.app').isVisible(), false, 'none of the app');
    assert.equal(await tab.locator('a', { hasText: 'Back to chat' }).getAttribute('href'), `/#bot/${bot.id}`);
    const width = await tab.locator('.doc-md').evaluate((a) => a.getBoundingClientRect().width);
    assert.ok(width >= 700, `reading width, not half a pane (${width})`);

    await tab.locator('[data-doc="menu"]').click();
    assert.equal(await tab.locator('.doc-menu').isVisible(), true);
    if (SHOTS) await tab.screenshot({ path: path.join(SHOTS, 'document.png') });
    // Google Docs is not connected on this server: the item leads to connecting it (#351).
    await tab.locator('[data-gd-state]', { hasText: 'Connect…' }).waitFor();
    const [word] = await Promise.all([tab.waitForEvent('download'), tab.locator('[data-format="docx"]').click()]);
    assert.equal(word.suggestedFilename(), 'Ads-budget-for-the-Belgian-contractor.docx');
    await tab.locator('[data-doc="menu"]').click();
    const [mdFile] = await Promise.all([tab.waitForEvent('download'), tab.locator('[data-format="md"]').click()]);
    assert.equal(require('fs').readFileSync(await mdFile.path(), 'utf8'), REPORT);

    if (SHOTS) { await tab.emulateMedia({ media: 'print' }); await tab.screenshot({ path: path.join(SHOTS, 'print.png') }); await tab.emulateMedia({ media: 'screen' }); }
    await tab.reload();
    await tab.locator('.doc-md table').waitFor();
    await tab.setViewportSize({ width: 390, height: 844 });
    assert.equal(await tab.locator('.doc-toc').isVisible(), false, 'no sections beside it on a phone');
    if (SHOTS) await tab.screenshot({ path: path.join(SHOTS, 'phone.png') });
    assert.deepEqual(errors, []);
    console.log('ok: a reply opens as a document');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
