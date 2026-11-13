// The owner manages teams second, while the overview and primary conversation stay first.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, writeData, makeBot } = require('../helpers');
(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const unseen = (await srv.api('/whats-new')).data.entries;
    if (unseen.length) await srv.api('/whats-new/seen', { method: 'POST', body: { id: unseen[0].id } });
    const a = await makeBot(srv, { name: 'Writer' });
    const b = await makeBot(srv, { name: 'Researcher' });
    const c = await makeBot(srv, { name: 'Checker' });
    browser = await chromium.launch({ headless: true });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      writeData(path.join(srv.data, 'company.json'), { projects: [
        { id: 'p1', name: 'Launch', start: 'Site', goal: 'Ship the site', phase: 'running', bots: [a.id], teams: [
          { id: 't1', name: 'Research', bots: [b.id, c.id], lead: b.id },
          { id: 't2', name: 'Delivery', bots: [b.id], lead: b.id },
        ] },
      ] });
      const page = await browser.newPage({ viewport });
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.route('**/api/company/files?*', (r) => r.fulfill({ json: { state: 'off', files: [] } }));
      await page.goto(`${srv.base}/#company`);
      await page.locator('[data-po-root]').waitFor();
      assert.equal(await page.locator('.sp-teams, [data-cf-new], [data-cf-add-bot]').count(), 0);
      await page.locator('[data-po-team]').click();
      await page.locator('[data-pt-root]').waitFor();
      await page.locator('[data-ps-project-lead]').selectOption(a.id);
      await page.waitForFunction((id) => state.company.lead === id, a.id);
      await page.locator('[data-ps-edit-team="t2"]').click();
      await page.locator(`[data-ps-member="${c.id}"]`).click();
      await page.locator('[data-ps-lead]').selectOption(c.id);
      await page.locator('[data-ps-save-team]').click();
      await page.waitForFunction((id) => state.company.teams.find((t) => t.id === 't2').lead === id, c.id);
      let saved = (await srv.api('/company?project=p1')).data.company;
      assert.deepEqual(saved.teams.find((t) => t.id === 't1').bots, [b.id, c.id], 'joining another team keeps the first membership');
      assert.deepEqual(saved.bots, [a.id], 'editing teams preserves standalone bots');
      await page.locator('[data-ps-new-team]').click();
      await page.locator('[data-ps-team-name]').fill('Writing');
      await page.locator(`[data-ps-member="${a.id}"]`).click();
      await page.locator('[data-ps-team-name]').press('Enter');
      await page.locator('[data-ps-editor]').waitFor({ state: 'detached' });
      await page.locator('.sp-name', { hasText: 'Writing' }).waitFor();
      saved = (await srv.api('/company?project=p1')).data.company;
      assert.equal(saved.teams.length, 3);
      assert.equal(saved.lead, a.id);
      // Individual chat is explicit; returning keeps the secondary view on a phone.
      await page.locator('[data-cf-fold="t1"]').click();
      await page.locator(`[data-cf-bot="${c.id}"]`).first().click();
      await page.waitForFunction((id) => state.view === 'bot' && state.botId === id, c.id);
      if (viewport.width < 1001) await page.locator('#chat-row [data-back]:visible').first().click();
      assert.ok(await page.locator('[data-pt-root]').isVisible());
      // Creating a team provides its real chat and preserves return navigation too.
      const writing = saved.teams.find((t) => t.name === 'Writing');
      // A status redraw while the missing chat list loads must not discard the click.
      let releaseChat, chatStarted;
      const chatPending = new Promise((done) => { chatStarted = done; });
      await page.evaluate(() => { state.groups = []; Company.redraw(); });
      await page.route('**/api/group-chats', async (route) => {
        const response = await route.fetch();
        chatStarted();
        await new Promise((done) => { releaseChat = done; });
        await route.fulfill({ response });
      }, { times: 1 });
      await page.locator(`[data-cf-team-chat="${writing.id}"]`).click();
      await chatPending;
      await page.evaluate(() => Company.redraw());
      releaseChat();
      await page.waitForFunction(() => state.view === 'group');
      if (viewport.width < 1001) await page.locator('#chat-row [data-back]:visible').first().click();
      assert.ok(await page.locator('[data-pt-root]').isVisible());
      await page.locator('[data-pt-back]').click();
      await page.locator('[data-po-root]').waitFor();
      assert.equal(await page.locator('.sp-teams').count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('secondary project Team: ok');
  } finally { await browser?.close(); await srv.stop(); }
})().catch((e) => { console.error(e); process.exit(1); });
