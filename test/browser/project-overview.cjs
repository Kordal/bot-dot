// The real project UI: fixed overview, saved Board, failure states and late replies across project switches.
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
    if (unseen.length) await srv.api('/whats-new/seen', { method: 'POST', body: { id: unseen[0].id } });
    const bot = await makeBot(srv, { name: 'Writer' });
    writeData(path.join(srv.data, 'company.json'), { projects: [
      { id: 'p1', name: 'Launch', start: 'Site', goal: '<img src=x onerror=alert(1)> Launch safely', phase: 'running', bots: [bot.id], board: ['goals'], objectives: [{ id: 'g1', name: 'Drafts', current: 1, target: 4 }], layout: { 'goal:g1': [0, 0, 400, 200] } },
      { id: 'p2', name: 'Garden', start: 'Garden', goal: 'Plant trees', phase: 'running', board: [] },
    ] });
    const saved = (await srv.api('/company?project=p1')).data.company;
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('**/api/company/files?*', (r) => r.fulfill({ json: { state: 'off', files: [] } }));
      await page.goto(`${srv.base}/#company`);
      await page.locator('[data-po-root]').waitFor();
      await page.getByText('No recorded work.', { exact: true }).waitFor();
      assert.match(await page.locator('.po-goal').innerText(), /Launch safely/);
      assert.equal(await page.locator('.po-goal img').count(), 0, 'owner text is not markup');
      assert.equal(await page.locator('[data-cf-new], [data-cf-add-bot], .sp-teams').count(), 0, 'team organisation stays out of the main project view');
      assert.equal(await page.locator('[data-project-tidy], .pc-new, [data-cf-show]').count(), 0, 'Board editing is not in the overview');
      assert.ok(await page.getByText('Files are unavailable while the computer is off.', { exact: true }).isVisible());
      const afterRead = (await srv.api('/company?project=p1')).data.company;
      assert.deepEqual(afterRead.layout, saved.layout);
      assert.deepEqual(afterRead.board, saved.board);
      // A question without an approval card is shown without a blanket "nothing needs you" claim.
      await page.route('**/api/company/overview?project=p1', (r) => r.fulfill({ json: {
        projectId: 'p1', at: new Date().toISOString(), work: [], replies: [],
        blockers: [{ id: 'question', botId: bot.id, name: 'Writer', state: 'asks', text: 'Which headline?' }],
      } }), { times: 1 });
      await page.locator('[data-po-refresh]').click();
      await page.getByText('Which headline?', { exact: true }).waitFor();
      assert.equal(await page.getByText('Nothing needs you right now.', { exact: true }).count(), 0);
      await page.locator('[data-po-board]').click();
      await page.locator('[data-po-back]').waitFor();
      await page.locator('[data-cf-goal="g1"]').waitFor();
      await page.locator('[data-po-back]').click();
      await page.locator('[data-po-root]').waitFor();
      // A failed refresh retains labelled cached data rather than claiming the work disappeared.
      await page.route('**/api/company/overview?project=p1', (r) => r.fulfill({ status: 503, json: { error: 'Offline fixture' } }));
      await page.locator('[data-po-refresh]').click();
      await page.getByText(/Showing saved information/).waitFor();
      assert.ok(await page.getByText('No recorded work.', { exact: true }).isVisible());
      await page.unroute('**/api/company/overview?project=p1');
      assert.deepEqual(errors, []);
      await page.close();
    }
    // Slow p1 response after entering p2 must neither repaint p1 over it nor switch spaces.
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route('**/api/company/files?*', (r) => r.fulfill({ json: { state: 'off', files: [] } }));
    await page.goto(`${srv.base}/#company`);
    await page.getByText('No recorded work.', { exact: true }).waitFor();
    let release;
    let started;
    const waiting = new Promise((done) => { started = done; });
    await page.route('**/api/company/overview?project=p1', async (route) => {
      started();
      await new Promise((done) => { release = done; });
      await route.fulfill({ json: { projectId: 'p1', at: new Date().toISOString(), goal: 'Late old data', work: [], blockers: [], replies: [] } });
    });
    await page.locator('[data-po-refresh]').click();
    await waiting;
    await page.locator('#rail [data-space="p2"]').click();
    await page.locator('.po-goal', { hasText: 'Plant trees' }).waitFor();
    release();
    await page.waitForFunction(() => !ProjectOverview.sig('p1').busy);
    assert.equal(await page.locator('.po-goal').innerText(), 'Plant trees');
    assert.equal(await page.evaluate(() => state.company.id), 'p2');
    // Leaving for Home while a refresh waits must not switch the owner back to Projects.
    let releaseHome;
    let startHome;
    const pendingHome = new Promise((done) => { startHome = done; });
    await page.route('**/api/company/overview?project=p2', async (route) => {
      startHome();
      await new Promise((done) => { releaseHome = done; });
      await route.fulfill({ json: { projectId: 'p2', at: new Date().toISOString(), work: [], blockers: [], replies: [] } });
    });
    await page.locator('[data-po-refresh]').click();
    await pendingHome;
    await page.locator('#rail .brand').click();
    await page.waitForFunction(() => Company.place() === 'bots');
    releaseHome();
    await page.waitForFunction(() => !ProjectOverview.sig('p2').busy);
    assert.equal(await page.evaluate(() => Company.place()), 'bots');
    await page.close();
    console.log('fixed project overview: ok');
  } finally { await browser?.close(); await srv.stop(); }
})().catch((e) => { console.error(e); process.exit(1); });
