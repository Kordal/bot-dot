// Optional browser check of the table block (#396): NODE_PATH=<directory containing playwright> node test/browser/table-block.cjs [shots dir]
// A bot saves a page with a table of its own rows and a table bound to a tile of the Board. In the viewer the owner
// sorts by a header, searches, filters and pages; the tile gets new rows and the bound table follows them without
// losing its sort and filter; at a phone's width the tables are lists. Scratch data and the stand-in Claude only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, heldRun, self } = require('../helpers');

const fence = (type, v) => `\`\`\`${type}\n${JSON.stringify(v)}\n\`\`\``;
const STATES = ['Done', 'In progress', 'Planned'];
const FEATURES = Array.from({ length: 23 }, (_, i) => [`Feature ${String(i + 1).padStart(2, '0')}`, ['Chat', 'Rooms', 'Jobs'][i % 3], STATES[i % 3], `#${300 + i}${i % 4 === 0 ? ` · PR #${400 + i}` : ''}`, new Date(Date.now() - i * 36e5 * 7).toISOString()]);
const COLUMNS = [{ label: 'Feature' }, { label: 'Area' }, { label: 'State', type: 'status', levels: { Done: 'ok', 'In progress': 'info', Planned: 'plan' } }, { label: 'Source', type: 'ref', link: 'https://github.com/owner/repo/issues/{n}' }, { label: 'Changed', type: 'date' }];
const issues = (n) => Array.from({ length: n }, (_, i) => ({ title: `Issue ${String.fromCharCode(65 + i)}`, state: i % 2 ? 'closed' : 'open', number: `#${10 + i}` }));
const PAGE = [
  fence('hero', { eyebrow: 'Report', title: 'Features', lead: 'Everything, sortable.' }),
  fence('table', { title: 'Features', columns: COLUMNS, rows: FEATURES, filter: 'State', sort: 'Feature' }),
  fence('table', { tile: 'Issues', bind: 'value', title: 'Open issues', columns: [{ label: 'Title', item: 'title' }, { label: 'State', item: 'state', type: 'status' }, { label: 'Number', item: 'number', type: 'ref' }], filter: 'State' }),
].join('\n\n');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'bot-dot Manager', color: '#45c78e' });
    const tile = (await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'list', title: 'Issues', bot: bot.id, value: issues(4) } })).data;
    const { run, rec, token } = await heldRun(srv, bot, 'A features page');
    const saved = await self(srv, token, 'page', { title: 'Features', markdown: PAGE });
    assert.deepEqual(saved.data.problems, []);
    srv.reply('Done.');
    srv.release(rec);
    await srv.finished(run.id);
    srv.unhold();

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#bot/${bot.id}`);
    await page.locator('#bot-thread .page-chip').first().click();
    const viewer = page.locator('#doc-viewer');
    await viewer.locator('.dv-page .pb-title', { hasText: 'Features' }).waitFor();
    await viewer.locator('[data-dv="full"]').click();
    const [own, bound] = [viewer.locator('.kit-table').nth(0), viewer.locator('.kit-table').nth(1)];
    const firstCells = (t) => t.locator('.kit-tbl tbody tr td:first-child').allInnerTexts();

    // Its own rows: sorted by the bot's column, a page of ten, the footer, the pills and the links.
    assert.deepEqual((await firstCells(own)).slice(0, 2), ['Feature 01', 'Feature 02']);
    assert.match(await own.locator('.kit-tfoot').innerText(), /^10 of 23\s+‹\s+1 \/ 3/);
    assert.equal(await own.locator('.kit-tbl .kit-pill.ok').first().innerText(), 'Done');
    assert.equal(await own.locator('.kit-ref a').first().getAttribute('href'), 'https://github.com/owner/repo/issues/300');
    await own.locator('th button', { hasText: 'Feature' }).click();
    assert.deepEqual((await firstCells(own)).slice(0, 1), ['Feature 23'], 'a second tap sorts down');
    await own.locator('.kit-pager button[aria-label="Next"]').click();
    assert.match(await own.locator('.kit-tfoot').innerText(), /2 \/ 3/);
    await own.locator('[data-tfilter="Planned"]').click();
    assert.match(await own.locator('.kit-tfoot').innerText(), /^7 of 7 · 23 in all/);
    await own.locator('.kit-find').fill('feature 1');
    assert.deepEqual(await firstCells(own), ['Feature 18', 'Feature 15', 'Feature 12']);
    assert.equal(await own.locator('.kit-find').evaluate((el) => el === document.activeElement), true, 'the search box keeps the focus');

    // Bound to a tile: sorted down and filtered, it follows the tile's new rows and keeps both.
    assert.equal(await bound.locator('.kit-tbl tbody tr').count(), 4);
    await bound.locator('th button', { hasText: 'Title' }).click();
    await bound.locator('th button', { hasText: 'Title' }).click();
    await bound.locator('[data-tfilter="open"]').click();
    assert.deepEqual(await firstCells(bound), ['Issue C', 'Issue A']);
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-table.png') });
    await srv.asChief(`/dashboard/tiles/${tile.id}/value`, { method: 'PUT', body: { value: issues(7) } });
    await bound.locator('td', { hasText: 'Issue G' }).waitFor({ timeout: 10000 });
    assert.deepEqual(await firstCells(bound), ['Issue G', 'Issue E', 'Issue C', 'Issue A']);
    assert.equal(await bound.locator('[data-tfilter="open"]').getAttribute('class'), 'on');
    assert.match(await bound.locator('th.on').innerText(), /Title▼/);

    // A phone: the tables are lists, the first column with its reference under it and its pill on the right.
    await page.setViewportSize({ width: 390, height: 844 });
    await own.locator('.kit-tlist').waitFor();
    assert.equal(await own.locator('.kit-tbl').isVisible(), false);
    const row = own.locator('.kit-trow').first();
    assert.match(await row.innerText(), /^Feature 18\n#317\nPlanned$/);
    if (shots) await page.screenshot({ path: path.join(shots, 'phone-table.png') });
    assert.deepEqual(errors, []);
    console.log('PASS  a table block in the browser');
  } finally {
    await browser?.close();
    srv.unhold?.();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
