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
      { id: 'p3', name: 'Dense', start: 'Dense', phase: 'running', bots: [bot.id], board: ['needs', 'work', 'blockers', 'replies'], filesOn: true, overviewOn: true, layout: { work: [0, 0, 592, 260] } },
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
        projectId: 'p1', at: new Date().toISOString(), work: [{ id: 'w', botId: bot.id, name: 'Writer', state: 'working', text: 'Drafting the launch post', at: new Date().toISOString() },
          { id: 'chief', chatId: 'c1', name: 'Chief', state: 'working', text: 'Planning the week' }, { id: 't', name: '', state: 'planned', text: 'Call the printer' }],
        blockers: [{ id: 'q', botId: bot.id, name: 'Writer', state: 'asks', text: 'Which headline?' }], replies: [{ id: 'r', botId: bot.id, name: 'Writer', state: 'reply', text: 'Draft ready', at: new Date().toISOString() }],
      } }));
      await page.goto(`${srv.base}/#company`);
      await page.locator('[data-cf-ov="work"]').waitFor();
      await page.getByText('Drafting the launch post').waitFor();
      // Each row shows whose it is: the bot's own head, the Chief's for a Chief chat, the owner's for their to-do.
      const work = page.locator('[data-cf-ov="work"] .po-row');
      assert.equal(await work.nth(0).locator(`.avatar[data-bot="${bot.id}"]`).count(), 1, "the bot's head");
      assert.equal(await work.nth(1).locator('.avatar').count(), 1, "the Chief's head");
      assert.equal(await work.nth(2).locator('.cf-you').count(), 1, "the owner's head");
      const headBox = await work.nth(0).locator('.avatar').boundingBox(), nameBox = await work.nth(0).locator('.po-meta').boundingBox();
      assert.ok(headBox.x + headBox.width <= nameBox.x, 'the head stands left of the name');
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
    // An arranged board's overview tile shows whole rows and "+N more", never a row sliced in half (ADR 273); where the
    // canvas would be drawn under 0.8 of its size the tiles stand in one column and show every row.
    const dense = await browser.newPage({ viewport: { width: 2200, height: 900 } });
    const errs = [];
    dense.on('pageerror', (e) => errs.push(e.message));
    await dense.route('**/api/company/files?*', (r) => r.fulfill({ json: { state: 'off', files: [] } }));
    await dense.route('**/api/company/overview?project=p3', (r) => r.fulfill({ json: {
      projectId: 'p3', at: new Date().toISOString(), blockers: [], replies: [],
      work: Array.from({ length: 8 }, (_, i) => ({ id: `w${i}`, botId: bot.id, name: 'Writer', state: 'working', text: `Step ${i + 1} of the launch`, at: new Date().toISOString() })),
    } }));
    await dense.goto(`${srv.base}/#company`);
    await dense.locator('#rail [data-space="p3"]').click();
    await dense.locator('[data-cf-ov="work"] .po-row').first().waitFor();
    const tileState = () => dense.evaluate(() => {
      const sec = document.querySelector('[data-cf-ov="work"]');
      const rows = [...sec.querySelectorAll('.po-row')];
      const more = sec.querySelector('.po-more');
      const box = sec.getBoundingClientRect();
      const shown = rows.filter((r) => getComputedStyle(r).display !== 'none');
      const last = shown[shown.length - 1].getBoundingClientRect();
      return { board: document.querySelector('.bc-wrap').clientWidth, column: document.querySelector('.bc-wrap').classList.contains('bc-column'), total: rows.length, shown: shown.length,
        inside: last.bottom <= box.bottom + 0.5, scrolls: sec.scrollHeight > sec.clientHeight, more: more && !more.hidden ? more.textContent : null, overflow: getComputedStyle(sec).overflowY };
    });
    let st = await tileState();
    assert.ok(st.board >= 960, `a wide board is the canvas (${st.board})`);
    assert.equal(st.column, false);
    assert.ok(st.shown >= 1 && st.shown < st.total, `some rows hidden (${st.shown} of ${st.total})`);
    assert.equal(st.more, `+${st.total - st.shown} more`);
    assert.ok(st.inside && !st.scrolls, 'the last row shown is whole, and the tile has nothing to scroll');
    assert.equal(st.overflow, 'hidden');
    // With the chat open the board is narrower than 0.8 of the canvas: one column, every row, no "more".
    await dense.setViewportSize({ width: 850, height: 900 });
    await dense.waitForFunction(() => document.querySelector('.bc-wrap').classList.contains('bc-column'));
    st = await tileState();
    assert.ok(st.board < 960);
    assert.equal(st.shown, st.total, 'every row in the column');
    assert.equal(st.more, null);
    // Wide again: the rows are fitted again.
    await dense.setViewportSize({ width: 2200, height: 900 });
    await dense.waitForFunction(() => !document.querySelector('.bc-wrap').classList.contains('bc-column'));
    st = await tileState();
    assert.ok(st.shown < st.total && st.more);
    assert.deepEqual(errs, []);
    await dense.close();
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
