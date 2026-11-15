// The project page is the board (overview-board, ADR 245): Needs you, Current work, Blockers and Latest replies are
// tiles on it, with no separate Overview, and they stand where the layout puts them.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer, writeData, makeBot } = require('../helpers');
const path = require('node:path');

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const unseen = (await srv.api('/whats-new')).data.entries;
    for (const e of unseen) await srv.api('/whats-new/seen', { method: 'POST', body: { id: e.id } });
    const bot = await makeBot(srv, { name: 'Writer' });
    writeData(path.join(srv.data, 'company.json'), { projects: [
      { id: 'p1', name: 'Launch', start: 'Site', phase: 'running', bots: [bot.id], board: ['needs', 'work', 'blockers', 'replies', 'todo'], filesOn: true, overviewOn: true, layout: { replies: [0, 0, 1200, 300] } },
      { id: 'p2', name: 'Garden', start: 'Garden', phase: 'running', board: ['needs', 'work', 'blockers', 'replies'], filesOn: true, overviewOn: true },
    ] });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const shots = process.env.SHOTS;
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('**/api/company/files?*', (r) => r.fulfill({ json: { state: 'off', files: [] } }));
      await page.route('**/api/company/overview?project=p1', (r) => r.fulfill({ json: {
        projectId: 'p1', at: new Date().toISOString(), work: [{ id: 'w', botId: bot.id, name: 'Writer', state: 'working', text: 'Drafting the launch post', at: new Date().toISOString() }],
        blockers: [{ id: 'q', botId: bot.id, name: 'Writer', state: 'asks', text: 'Which headline?' }], replies: [{ id: 'r', botId: bot.id, name: 'Writer', state: 'reply', text: 'Draft ready', at: new Date().toISOString() }],
      } }));
      await page.goto(`${srv.base}/#company`);
      await page.locator('[data-cf-ov="work"]').waitFor();
      await page.getByText('Drafting the launch post').waitFor();
      assert.equal(await page.locator('[data-po-root], [data-po-board], [data-po-back]').count(), 0, 'no separate overview');
      assert.ok(await page.locator('[data-cf-ov="needs"]').getByText('Which headline?').isVisible(), 'a question is in Needs you');
      assert.equal(await page.locator('[data-cf-ov="blockers"]').getByText('Which headline?').count(), 0, 'not twice');
      assert.ok(await page.locator('[data-cf-ov="replies"]').getByText('Draft ready').isVisible());
      assert.ok(await page.locator('[data-po-team]').isVisible(), 'Team stays');
      if (viewport.width > 600) {
        const replies = await page.locator('[data-cf-ov="replies"]').boundingBox();
        const work = await page.locator('[data-cf-ov="work"]').boundingBox();
        assert.ok(replies.y < work.y, 'the layout puts Latest replies first');
      }
      // A failed refresh says so in the tiles rather than claiming the work disappeared.
      await page.unroute('**/api/company/overview?project=p1');
      await page.route('**/api/company/overview?project=p1', (r) => r.fulfill({ status: 503, json: { error: 'Offline fixture' } }));
      await page.evaluate(() => ProjectOverview.refresh(state.company, true));
      await page.evaluate(() => new Promise((done) => setTimeout(done, 50)));
      await page.evaluate(() => Company.redraw());
      await page.locator('[data-cf-ov="work"]').getByText(/Offline fixture/).waitFor();
      await page.unroute('**/api/company/overview?project=p1');
      if (shots) await page.screenshot({ path: path.join(shots, `board-${viewport.width}.png`), fullPage: true });
      assert.deepEqual(errors, []);
      await page.close();
    }
    // A slow p1 snapshot that lands after entering p2 neither paints over p2 nor switches spaces.
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/api/company/files?*', (r) => r.fulfill({ json: { state: 'off', files: [] } }));
    await page.goto(`${srv.base}/#company`);
    await page.locator('[data-cf-ov="work"]').waitFor();
    let release;
    let started;
    const waiting = new Promise((done) => { started = done; });
    await page.route('**/api/company/overview?project=p1', async (route) => {
      started();
      await new Promise((done) => { release = done; });
      await route.fulfill({ json: { projectId: 'p1', at: new Date().toISOString(), work: [{ id: 'late', name: 'Late', state: 'working', text: 'Late old data', at: new Date().toISOString() }], blockers: [], replies: [] } });
    });
    await page.evaluate(() => { ProjectOverview.refresh(state.company, true); }); // not awaited: the reply is held
    await waiting;
    await page.locator('#rail [data-space="p2"]').click();
    await page.locator('.cf-top h1', { hasText: 'Garden' }).waitFor();
    release();
    await page.waitForFunction(() => !ProjectOverview.sig('p1').busy);
    assert.match(await page.locator('.cf-top h1').innerText(), /Garden/);
    assert.equal(await page.getByText('Late old data').count(), 0, 'the late p1 snapshot did not paint over p2');
    assert.equal(await page.evaluate(() => state.company.id), 'p2');
    // Leaving for Home while a refresh waits does not switch the owner back to Projects.
    let releaseHome;
    let startHome;
    const pendingHome = new Promise((done) => { startHome = done; });
    await page.route('**/api/company/overview?project=p2', async (route) => {
      startHome();
      await new Promise((done) => { releaseHome = done; });
      await route.fulfill({ json: { projectId: 'p2', at: new Date().toISOString(), work: [], blockers: [], replies: [] } });
    });
    await page.evaluate(() => { ProjectOverview.refresh(state.company, true); }); // not awaited: the reply is held
    await pendingHome;
    await page.locator('#rail .brand').click();
    await page.waitForFunction(() => Company.place() === 'bots');
    releaseHome();
    await page.waitForFunction(() => !ProjectOverview.sig('p2').busy);
    assert.equal(await page.evaluate(() => Company.place()), 'bots');
    await page.close();
    console.log('overview board: ok');
  } finally { await browser?.close(); await srv.stop(); }
})().catch((e) => { console.error(e); process.exit(1); });
