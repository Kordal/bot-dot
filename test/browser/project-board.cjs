// Optional browser check of the board's pieces (#780): node test/browser/project-board.cjs [shots dir]
// A new project's home is its title, its gear and New card; a pick under the ask of a new card puts a piece on the
// board (Teams: the floor; To-do: the panel); Project settings take one off again. A project made before shows every
// piece. Wide and phone. Scratch data only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, writeData, waitFor } = require('../helpers');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const lead = await makeBot(srv, { name: 'Demo Scheduler', color: '#1d9e75' });
    assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'botdot.app' } })).status, 201);
    const c = (await srv.api('/company')).data.company;
    assert.deepEqual(c.board, []);
    const write = (extra) => writeData(path.join(srv.data, 'company.json'), {
      ...c, phase: 'running', startedAt: new Date(Date.now() - 3_600_000).toISOString(),
      teams: [{ id: 't1', name: 'Botdot', color: '#34c759', bots: [lead.id], lead: lead.id }], plan: { items: [{ text: 'Post the launch' }], approved: false }, ...extra,
    });
    const board = async () => (await srv.api('/company')).data.company.board;
    const picked = (page) => page.locator('[data-pc-piece]').evaluateAll((l) => l.map((b) => b.dataset.pcPiece));

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    for (const [name, viewport] of [['wide', { width: 1440, height: 1000 }], ['phone', { width: 390, height: 844 }]]) {
      const page = await (await browser.newContext({ viewport, colorScheme: 'dark' })).newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));

      write({ board: [] });
      await page.goto(`${srv.base}/#company`);
      await page.locator('.pc-new').waitFor({ timeout: 20000 });
      assert.equal(await page.locator('.cf-day, .cf-line, .cf-goals, .cf-room, .cf-chief, .cf-new, .cf-cal, .cf-panel').count(), 0, 'nothing but New card');
      if (shots) await page.screenshot({ path: path.join(shots, `${name}-empty.png`), fullPage: true });

      await page.locator('.pc-new').click();
      assert.deepEqual(await picked(page), ['days', 'goals', 'teams', 'calendar', 'todo']);
      if (shots) await page.screenshot({ path: path.join(shots, `${name}-picks.png`), fullPage: true });
      await page.locator('[data-pc-piece="teams"]').click();
      await page.locator('.cf-room').waitFor({ timeout: 10000 });
      assert.deepEqual(await board(), ['teams']);
      assert.equal(await page.locator('.cf-panel').count(), 0);
      await page.locator('.pc-new').click();
      await page.locator('[data-pc-piece="todo"]').click();
      await page.locator('.cf-panel', { hasText: 'Post the launch' }).waitFor({ timeout: 10000 });
      assert.deepEqual(await board(), ['teams', 'todo']);
      await page.locator('.pc-new').click();
      assert.deepEqual(await picked(page), ['days', 'goals', 'calendar']);
      if (shots) await page.screenshot({ path: path.join(shots, `${name}-teams-todo.png`), fullPage: true });

      if (name === 'wide') {
        // Settings: Teams off again.
        await page.locator('[data-project-settings]').first().click();
        const teams = page.locator('[data-ps-piece="teams"]');
        await teams.waitFor({ timeout: 10000 });
        assert.equal(await teams.getAttribute('aria-pressed'), 'true');
        if (shots) await page.screenshot({ path: path.join(shots, `${name}-settings.png`) });
        await teams.click();
        await waitFor(async () => JSON.stringify(await board()) === '["todo"]', { what: 'teams off' });
      }

      // A project made before #780 has no board: every piece, as it always had.
      write({ board: undefined });
      await page.goto(`${srv.base}/#company`);
      await page.reload();
      await page.locator('.cf-room').waitFor({ timeout: 20000 });
      assert.ok(await page.locator('.cf-day').count());
      assert.ok(await page.locator('.cf-panel').count());
      await page.locator('.pc-new').click();
      assert.equal(await page.locator('[data-pc-piece]').count(), 0, 'nothing to add');
      assert.deepEqual(errors, []);
    }
    console.log('project-board: ok');
  } finally {
    if (browser) await browser.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
