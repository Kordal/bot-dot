// Optional browser check of changing a goal by chat (#819): node test/browser/objective-change.cjs [shots dir]
// A goal's pencil opens a field under it; Send makes a Chief chat that names the goal and opens it docked on the
// Projects screen, the floor still under it; the Chief's change shows on the tile; Minimize leaves a Chief bar.
// A phone has the field as a sheet. Scratch data only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, writeData } = require('../helpers');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const unseen = (await srv.api('/whats-new')).data.entries;
    if (unseen.length) await srv.api('/whats-new/seen', { method: 'POST', body: { id: unseen[0].id } });
    assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'gym advisor' } })).status, 201);
    const c = { ...(await srv.api('/company')).data.company, board: undefined };
    writeData(path.join(srv.data, 'company.json'), {
      ...c, name: 'My Gym Advisor', phase: 'running', startedAt: new Date().toISOString(),
      objectives: [{ id: 'o1', name: 'Weeks with logged sessions', current: 0, target: 12, color: '#34c759' }, { id: 'o2', name: 'Sets logged with weight and reps', current: 0, target: 100, color: '#ef9f27' }],
      teams: [], todos: [],
    });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#company`);
    await page.locator('.cf-top h1', { hasText: 'My Gym Advisor' }).waitFor({ timeout: 20000 });

    const goal = page.locator('[data-cf-goal="o2"]');
    await goal.hover();
    await goal.locator('[data-cf-ask]').click();
    const pop = page.locator('.ask-pop');
    await pop.waitFor();
    const g = await goal.boundingBox();
    const p = await pop.boundingBox();
    assert.ok(p.y >= g.y + g.height, 'the field stands under the goal');
    await pop.locator('textarea').fill('Make it 150');
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-ask.png') });
    srv.reply('Done: 150 now.');
    await pop.locator('textarea').press('Enter');
    await page.locator('#dock-panel #view-chief .chat-thread', { hasText: 'Make it 150' }).waitFor();
    assert.ok(await page.locator('#view-company').isVisible(), 'the floor stays under the chat');
    assert.equal(await pop.count(), 0, 'the field closed');
    await page.locator('#dock-panel #view-chief .chat-thread', { hasText: 'Done: 150 now.' }).waitFor();

    // What the Chief's tool does shows on the tile.
    await srv.asChief('/company/objectives/o2', { method: 'PUT', body: { target: 150 } });
    await goal.locator('.cf-goal-num', { hasText: '150' }).waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-chat.png') });

    // Minimize: a bar of the Chief; the Chief on nothing else.
    await page.locator('#dock-panel #view-chief [data-dock-min]').click();
    await page.locator('#dock .dock-bar[data-key="chief:chief"]').waitFor();
    await page.locator('#dock [data-dock-open="chief:chief"]').click();
    await page.locator('#dock-panel #view-chief .chat-thread', { hasText: 'Done: 150 now.' }).waitFor();

    // A phone: the field is a sheet with the goal's name.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#dock-panel #view-chief [data-dock-min]').click();
    await page.locator('[data-cf-goal="o1"] [data-cf-ask]').click();
    await page.locator('.ask-pop.ask-sheet h2', { hasText: 'Weeks with logged sessions' }).waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, 'phone-ask.png') });
    await page.locator('.ask-dim').click();
    assert.equal(await page.locator('.ask-pop').count(), 0);

    assert.deepEqual(errors, []);
    console.log('objective-change: ok');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
