// A team's chat is one click from the project's page (overview-board, ADR 245): a chip per team under the title opens
// it, on a wide window and on a phone, and Team stays beside the title for who is in a team. Scratch data only.
// node test/browser/team-chips.cjs [shots dir]
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, writeData } = require('../helpers');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    for (const e of (await srv.api('/whats-new')).data.entries) await srv.api('/whats-new/seen', { method: 'POST', body: { id: e.id } });
    const a = await makeBot(srv, { name: 'Infra Admin', color: '#1d9e75' });
    const b = await makeBot(srv, { name: 'Release Planner', color: '#7f77dd' });
    assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'Quotz' } })).status, 201);
    await srv.api('/company', { method: 'PATCH', body: { name: 'Quotz Development' } });
    const t1 = (await srv.api('/company/teams', { method: 'POST', body: { name: 'Infra', bots: [a.id], lead: a.id } })).data.teams[0];
    const t2 = (await srv.api('/company/teams', { method: 'POST', body: { name: 'Releases', bots: [a.id, b.id], lead: b.id } })).data.teams[1];
    writeData(path.join(srv.data, 'company.json'), { ...(await srv.api('/company')).data.company, phase: 'running', startedAt: new Date().toISOString(), objectives: [], todos: [] });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport, colorScheme: 'dark' });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${srv.base}/#company`);
      await page.locator('.cf-top h1', { hasText: 'Quotz Development' }).waitFor({ timeout: 20000 });
      const chips = page.locator('.cf-teamchips [data-cf-team-chat]');
      await chips.first().waitFor();
      assert.deepEqual(await chips.locator('.sp-name').allInnerTexts(), ['Infra', 'Releases'], 'a chip per team');
      assert.ok(await page.locator('[data-po-team]').isVisible(), 'Team stays');
      const top = await page.locator('.cf-top').boundingBox(), strip = await page.locator('.cf-teamchips').boundingBox();
      assert.ok(strip.y >= top.y + top.height - 1, 'the chips stand under the title');
      if (shots) await page.screenshot({ path: path.join(shots, `team-chips-${viewport.width}.png`) });
      // One click: the team's chat, and the chip shows where the owner is.
      await chips.nth(1).click();
      await page.waitForFunction((id) => state.view === 'group' && state.groups.find((g) => g.id === state.groupId)?.team === id, t2.id);
      assert.equal(await page.locator(`.cf-teamchips .sp-chip[data-cf-team-chat="${t2.id}"]`).count(), 1, 'the board stays');
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('ok');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
