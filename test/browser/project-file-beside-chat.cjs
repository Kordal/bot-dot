// Optional browser check of a file opened from a project's chat column: node test/browser/project-file-beside-chat.cjs [shots dir]
// A wide window's project page has one chat as a column on its right (#825). A file a reply names opens where the
// board is, and the chat stays in its column; its ✕ (or Esc) brings the board back. The bot view keeps the file beside
// its chat, and a window below 1001 px keeps the viewer as before. Scratch data and the stand-in Claude only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, writeData, unfoldTeams } = require('../helpers');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const unseen = (await srv.api('/whats-new')).data.entries;
    if (unseen.length) await srv.api('/whats-new/seen', { method: 'POST', body: { id: unseen[0].id } });
    const a = await makeBot(srv, { name: 'Store Shipper', color: '#7f77dd' });
    const b = await makeBot(srv, { name: 'Claude Coder', color: '#888780' });
    assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'botdot.app' } })).status, 201);
    await srv.api('/company', { method: 'PATCH', body: { name: 'Botdot Launch' } });
    await srv.api('/company/teams', { method: 'POST', body: { name: 'Launch team', bots: [a.id, b.id], lead: a.id } });
    const c = { ...(await srv.api('/company')).data.company, board: undefined };
    writeData(path.join(srv.data, 'company.json'), { ...c, phase: 'running', startedAt: new Date(Date.now() - 86_400_000).toISOString(), objectives: [], todos: [] });
    const dir = path.join(srv.data, 'workspaces', a.id, 'stores');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'setup.md'), '# App Store Connect setup\n\n1. Accept the Free Apps agreement.\n');
    srv.reply('The steps are ready in stores/setup.md.');
    const run = (await srv.api(`/bots/${a.id}/run`, { method: 'POST', body: { prompt: 'Write the steps.' } })).data;
    await srv.finished(run.id);
    // A bot in no project: its own view.
    const solo = await makeBot(srv, { name: 'Home Helper', color: '#d85a30' });
    fs.mkdirSync(path.join(srv.data, 'workspaces', solo.id), { recursive: true });
    fs.writeFileSync(path.join(srv.data, 'workspaces', solo.id, 'list.md'), '# Shopping list\n\n- Milk\n');
    srv.reply('Your list is in list.md.');
    const run2 = (await srv.api(`/bots/${solo.id}/run`, { method: 'POST', body: { prompt: 'Make my list.' } })).data;
    await srv.finished(run2.id);

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const box = (sel) => page.locator(sel).boundingBox();
    const parent = () => page.$eval('#doc-viewer', (el) => (el.parentElement.id || el.parentElement.className));

    // The project page: the bot's chat in the column, then its file.
    await page.goto(`${srv.base}/#company`);
    await page.locator('.cf-top h1', { hasText: 'Botdot Launch' }).waitFor({ timeout: 20000 });
    await unfoldTeams(page);
    await page.locator(`.sp-keys [data-cf-bot="${a.id}"]`).first().click();
    await page.locator('#chat-row a.file-path').first().click();
    await page.locator('#doc-viewer .dv-md h1', { hasText: 'App Store Connect setup' }).waitFor();
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    const viewer = await box('#doc-viewer');
    const chat = await box('#chat-row');
    assert.ok(await page.locator('#chat-row a.file-path').isVisible(), 'the chat stays visible');
    assert.ok(await page.locator('#view-bot textarea').first().isVisible(), 'and its field');
    assert.ok(viewer.x + viewer.width <= chat.x + 1, 'the file is left of the chat');
    assert.ok(viewer.width > 600, `the file has the board's width (${viewer.width})`);
    assert.equal(await page.locator('#view-company').isVisible(), false, 'the file takes the board\'s place');
    assert.equal(await page.locator('#doc-viewer .dv-full').isVisible(), false, 'no full window: it is already wide');
    assert.ok(await page.locator('#doc-viewer .dv-close').isVisible(), 'its close');
    assert.equal(await page.$eval('#chat-row', (el) => el.classList.contains('with-viewer')), false, 'the chat\'s settings still open beside it');
    if (shots) await page.screenshot({ path: path.join(shots, 'project-file.png') });

    // Its ✕: the board again.
    await page.locator('#doc-viewer .dv-close').click();
    await page.locator('#view-company').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#doc-viewer').isVisible(), false);

    // Esc closes it too.
    await page.locator(`.sp-keys [data-cf-bot="${a.id}"]`).first().click();
    await page.locator('#chat-row a.file-path').first().click();
    await page.locator('#doc-viewer .dv-md').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('#view-company').waitFor({ state: 'visible' });

    // Home's bot view: the file beside its chat, in the chat's row, as before.
    await page.evaluate(() => localStorage.setItem('botdot.place', 'home'));
    await page.goto(`${srv.base}/#bot/${solo.id}`);
    await page.reload();
    await page.locator('#view-bot a.file-path').first().click();
    await page.locator('#doc-viewer .dv-md').waitFor();
    assert.equal(await parent(), 'chat-row', 'the bot view keeps the file in the chat\'s row');
    assert.ok(await page.locator('#view-bot a.file-path').isVisible(), 'the bot\'s chat stays beside the file');

    if (shots) await page.screenshot({ path: path.join(shots, 'bot-file.png') });
    await page.keyboard.press('Escape');

    // Below 1001 px the viewer stays in the chat's row, as before.
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto(`${srv.base}/#bot/${solo.id}`);
    await page.reload();
    await page.locator('#view-bot a.file-path').first().click();
    await page.locator('#doc-viewer .dv-md').waitFor();
    assert.equal(await parent(), 'chat-row', 'a narrower window keeps the viewer in the chat\'s row');

    assert.deepEqual(errors, []);
    console.log('project-file-beside-chat: ok');
  } finally {
    await browser?.close();
    await srv.stop?.();
  }
})().catch((e) => { console.error(e); process.exit(1); });
