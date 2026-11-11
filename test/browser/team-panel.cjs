// Optional browser check of a team's settings (ADR 205): node test/browser/team-panel.cjs [shots dir]
// A team's ⋯ on a project's page opens its chat's settings in the panel on the right, not a card over the board:
// its members with Lead and Make lead, and its reports. Both save. "Add a bot" there is the team's own picker
// (#1051): a bot in another team says which, and the ticked one joins; ✕ takes a member out, none on the last one.
// Scratch data only.
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
    const infra = await makeBot(srv, { name: 'Infra Admin', color: '#e0a030' });
    const writer = await makeBot(srv, { name: 'Issue Writer', color: '#d4537e' });
    await srv.api('/company', { method: 'POST', body: { start: 'qwotz' } });
    await srv.api('/company', { method: 'PATCH', body: { name: 'Qwotz' } });
    const team = (await srv.api('/company/teams', { method: 'POST', body: { name: 'Dev Team', bots: [a.id, b.id], lead: a.id } })).data.teams[0];
    await srv.api('/company/teams', { method: 'POST', body: { name: 'Ops', bots: [infra.id] } });
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
    // "Add a bot": the team's picker, the bot in another team saying which.
    const teamNow = async () => (await srv.api('/company')).data.company.teams.find((x) => x.id === team.id);
    await page.locator('#view-groupsettings #gs-add').click();
    const picker = page.locator('#bot-picker');
    await picker.locator('h2', { hasText: 'Add to Dev Team' }).waitFor();
    assert.match(await picker.locator('[data-pick]', { hasText: 'Infra Admin' }).innerText(), /In Ops/);
    if (out) await page.screenshot({ path: path.join(out, 'team-panel-add.png') });
    await picker.locator('[data-pick]', { hasText: 'Infra Admin' }).click();
    await picker.locator('.btn.primary', { hasText: 'Add' }).click();
    await page.locator('#view-groupsettings #gs-members', { hasText: 'Infra Admin' }).waitFor();
    assert.deepEqual((await teamNow()).bots, [a.id, b.id, infra.id]);
    assert.ok((await srv.api('/company')).data.company.teams.find((x) => x.name === 'Ops').bots.includes(infra.id), 'still in Ops (ADR 199)');
    if (out) await page.screenshot({ path: path.join(out, 'team-panel-added.png') });
    // ✕ takes a member out; the last one has none.
    for (const id of [a.id, infra.id]) {
      await page.locator(`#view-groupsettings [data-take-out="${id}"]`).click();
      await page.locator(`#view-groupsettings [data-take-out="${id}"]`).waitFor({ state: 'detached' });
    }
    assert.deepEqual((await teamNow()).bots, [b.id]);
    await page.waitForFunction(() => !document.querySelector('#view-groupsettings [data-take-out]'));
    assert.deepEqual(errors, []);
    console.log('team panel: ok');
  } finally { await browser?.close(); await srv.stop(); }
})().catch((e) => { console.error(e); process.exit(1); });
