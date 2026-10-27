// Optional browser check of Files (#603): NODE_PATH=<directory containing playwright> node test/browser/files.cjs [shots dir]
// A bot's chat opens Files from its head: folders first with how many items they hold, a lock on what botdot keeps,
// a click selects and shows the preview, the right-click menu, the grid with an image as itself, a selection of
// several with its floating bar, Move to… moving into another folder, Copy to… copying, and a phone's list, sheets
// and long-press selection. Scratch data only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot } = require('../helpers');

const PNG = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'icon-192.png'));

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'News Monitor', color: '#8b7cf6' });
    const ws = path.join(srv.data, 'workspaces', bot.id);
    const put = (rel, data) => { fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true }); fs.writeFileSync(path.join(ws, rel), data); };
    put('summary-w43.md', '# Supplier prices, week 43\n\nTwo of six suppliers changed prices by more than 5%.\n\n- Acme: cables up 8%.\n- Northwind: paper down 6%.\n');
    put('prices-w43.csv', 'supplier,item,price\nAcme,cables,108\nNorthwind,paper,94\n');
    put('prices-w42.csv', 'supplier,item,price\nAcme,cables,100\nNorthwind,paper,100\n');
    put('supplier-acme.png', PNG);
    put('fetch.log', 'fetched 6 suppliers\n');
    put('CLAUDE.md', '# Rules\n');
    for (let i = 0; i < 8; i++) put(`reports/2026-w${36 + i}.md`, `# Week ${36 + i}\n`);
    for (let i = 0; i < 3; i++) put(`notes/n${i}.md`, 'note');
    fs.mkdirSync(path.join(ws, 'uploads'), { recursive: true });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 860 }, colorScheme: 'dark' })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const answers = [];
    page.on('dialog', (d) => { const a = answers.shift(); if (a === undefined) { errors.push(`dialog: ${d.message()}`); d.dismiss(); } else if (a === false) d.dismiss(); else d.accept(a === true ? undefined : a); });
    await page.goto(`${srv.base}/#bot/${bot.id}`);
    await page.locator('#bot-files').click();
    const fx = page.locator('#files');
    await fx.locator('.fx-row[data-path="summary-w43.md"]').waitFor();
    const names = await fx.locator('.fx-rows .fx-row .fx-name').allInnerTexts();
    assert.deepEqual(names.slice(0, 3), ['notes', 'reports', 'uploads'], 'folders first');
    assert.match(await fx.locator('.fx-row[data-path="reports"] .fx-size').innerText(), /^8 items$/);
    assert.equal(await fx.locator('.fx-row[data-path="CLAUDE.md"] .fx-k-lock').count(), 1, 'a lock on what botdot keeps');

    await fx.locator('.fx-row[data-path="summary-w43.md"]').click();
    await fx.locator('.fx-pv .md h1', { hasText: 'Supplier prices, week 43' }).waitFor();
    await fx.locator('.fx-row[data-path="summary-w43.md"]').click({ button: 'right' });
    const menu = fx.locator('.fx-menu');
    assert.deepEqual(await menu.locator('.fx-mi').allInnerTexts().then((t) => t.map((x) => x.split('\n')[0])), ['Open', 'Rename', 'Move to…', 'Copy to…', 'Download', 'Keep in mind', 'Delete']);
    if (shots) await page.screenshot({ path: path.join(shots, '01-main.png') });
    await page.keyboard.press('Escape');
    await fx.locator('.fx-row[data-path="CLAUDE.md"]').click({ button: 'right' });
    assert.deepEqual(await menu.locator('.fx-mi').allInnerTexts().then((t) => t.map((x) => x.split('\n')[0])), ['Open', 'Copy to…', 'Download', 'Keep in mind'], 'nothing that writes');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await fx.locator('[data-fx="view"][data-show="grid"]').click();
    await fx.locator('.fx-card[data-path="supplier-acme.png"] img').waitFor();
    assert.ok(await fx.locator('.fx-card[data-path="supplier-acme.png"] img').evaluate((img) => img.complete && img.naturalWidth === 192), 'the image as itself');
    await fx.locator('.fx-card[data-path="prices-w43.csv"]').click();
    await fx.locator('.fx-card[data-path="prices-w42.csv"]').click({ modifiers: ['Control'] });
    await fx.locator('.fx-card[data-path="supplier-acme.png"]').click({ modifiers: ['Control'] });
    await fx.locator('.fx-float', { hasText: '3 selected' }).waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, '02-grid.png') });

    await fx.locator('.fx-float [data-fx="move-to"]').click();
    const dialog = fx.locator('.fx-dialog');
    await dialog.locator('.fx-node', { hasText: 'reports' }).waitFor();
    await dialog.locator('.fx-node', { hasText: 'reports' }).click();
    if (shots) await page.screenshot({ path: path.join(shots, '03-move.png') });
    await dialog.locator('[data-fx="dialog-go"]').click();
    await fx.locator('.fx-card[data-path="prices-w43.csv"]').waitFor({ state: 'detached' });
    assert.ok(fs.existsSync(path.join(ws, 'reports', 'prices-w43.csv')) && fs.existsSync(path.join(ws, 'reports', 'supplier-acme.png')));

    await fx.locator('[data-fx="view"][data-show="list"]').click();
    await fx.locator('.fx-row[data-path="summary-w43.md"]').click({ button: 'right' });
    await menu.locator('[data-fx="copy-to"]').click();
    await dialog.locator('.fx-node', { hasText: 'notes' }).click();
    await dialog.locator('[data-fx="dialog-go"]').click();
    await fx.locator('.fx-row[data-path="summary-w43.md"]').waitFor();
    assert.ok(fs.existsSync(path.join(ws, 'notes', 'summary-w43.md')), 'copied');

    await fx.locator('.fx-row[data-path="reports"]').dblclick();
    await fx.locator('.fx-row[data-path="reports/prices-w43.csv"]').waitFor();
    assert.match(await fx.locator('.fx-trail').innerText(), /On botdot\s*\/\s*reports/);
    await page.keyboard.press('Backspace');
    await fx.locator('.fx-row[data-path="reports"]').waitFor();

    await page.setViewportSize({ width: 390, height: 844 });
    await fx.locator('[data-fx="go"]').first().click().catch(() => {});
    await fx.locator('.fx-row[data-path="reports"]').click();
    await fx.locator('.fx-ptitle b', { hasText: 'reports' }).waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, '05-phone.png') });
    await fx.locator('.fx-row[data-path="reports/2026-w43.md"] [data-fx="more"]').click();
    await fx.locator('.fx-sheet .fx-sheet-row', { hasText: 'Move to…' }).waitFor();
    await page.waitForTimeout(400);
    if (shots) await page.screenshot({ path: path.join(shots, '07-phone-sheet.png') });
    await fx.locator('.fx-scrim').click({ position: { x: 100, y: 60 } });
    const row = fx.locator('.fx-row[data-path="reports/2026-w42.md"]');
    const box = await row.boundingBox();
    await page.mouse.move(box.x + 100, box.y + 20);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    await fx.locator('.fx-ptitle', { hasText: '1 selected' }).waitFor();
    await fx.locator('.fx-row[data-path="reports/2026-w41.md"]').click();
    await fx.locator('.fx-ptitle', { hasText: '2 selected' }).waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, '06-phone-select.png') });
    await fx.locator('[data-fx="clear"]').click();
    await fx.locator('[data-fx="places"]').click();
    await fx.locator('.fx-sheet .fx-sheet-row', { hasText: 'Kept in mind' }).waitFor();
    await page.waitForTimeout(400);
    if (shots) await page.screenshot({ path: path.join(shots, '08-phone-places.png') });

    await fx.locator('.fx-scrim').click({ position: { x: 100, y: 60 } });
    await page.setViewportSize({ width: 1440, height: 860 });
    await fx.locator('[data-fx="close"]').click();
    assert.ok(await fx.evaluate((el) => el.classList.contains('hidden')));
    assert.deepEqual(errors, []);
    console.log('PASS  files in the browser');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    await srv.stop();
  }
})();
