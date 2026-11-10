// Optional browser check of a team's settings (ADR 205): node test/browser/team-panel.cjs [shots dir]
// A team's ⋯ on a project's page opens its chat's settings in the panel on the right, not a card over the board:
// its members with Lead and Make lead, and its reports. Both save. Scratch data only.
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer, makeBot, writeData } = require('../helpers');
(async () => {
  const out = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const unseen = (await srv.api('/whats-new')).data.entries;
    if (unseen.length) await srv.api('/whats-new/seen', { method: 'POST', body: { id: unseen[0].id } });
    const a = await makeBot(srv, { name: 'Claude Coder', color: '#8a8a8a' });
    const b = await makeBot(srv, { name: 'QA Tester', color: '#e0a030' });
    await srv.api('/company', { method: 'POST', body: { start: 'qwotz' } });
    await srv.api('/company', { method: 'PATCH', body: { name: 'Qwotz' } });
    const team = (await srv.api('/company/teams', { method: 'POST', body: { name: 'Dev Team', bots: [a.id, b.id], lead: a.id } })).data.teams[0];
    const c = { ...(await srv.api('/company')).data.company, board: undefined };
    writeData(path.join(srv.data, 'company.json'), { ...c, phase: 'running', startedAt: new Date(Date.now() - 86_400_000).toISOString(), objectives: [], todos: [] });
    browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#company`);
    await page.locator('.cf-top h1', { hasText: 'Qwotz' }).waitFor({ timeout: 20000 });
    await page.locator(`[data-cf-team="${team.id}"]`).click();
    await page.locator('#panel:not(.hidden) #view-groupsettings .gs-team').waitFor();
    assert.equal(await page.locator('.cf-panel h2', { hasText: 'Dev Team' }).count(), 0, 'no floating card');
    assert.equal(await page.locator('#view-groupsettings .cf-lead-chip').count(), 1);
    await page.locator(`#view-groupsettings [data-cf-lead="${b.id}"]`).click();
    await page.waitForFunction((id) => !document.querySelector(`#view-groupsettings [data-cf-lead="${id}"]`), b.id);
    await page.locator('#view-groupsettings [data-cf-report]').selectOption('daily');
    await new Promise((r) => setTimeout(r, 600));
    const t = (await srv.api('/company')).data.company.teams[0];
    assert.equal(t.lead, b.id); assert.equal(t.report, 'daily');
    if (out) await page.screenshot({ path: path.join(out, 'team-panel-wide.png') });
    assert.deepEqual(errors, []);
    console.log('team panel: ok');
  } finally { await browser?.close(); await srv.stop(); }
})().catch((e) => { console.error(e); process.exit(1); });
