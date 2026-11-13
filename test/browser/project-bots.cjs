// Optional browser check of a project's own bots (ADR 233): node test/browser/project-bots.cjs [shots dir]
// A project with no team has "Add bot" beside "New team"; its picker offers the account's bots not in the project, the
// ticked one joins it in no team and stands as a key under the teams with "+" after it. Its settings list it with ✕,
// which takes it out. Scratch data only.
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
    const coder = await makeBot(srv, { name: 'Claude Coder', color: '#8a8a8a' });
    await makeBot(srv, { name: 'QA Tester', color: '#e0a030' });
    await srv.api('/company', { method: 'POST', body: { start: 'botdot' } });
    await srv.api('/company', { method: 'PATCH', body: { name: 'Botdot' } });
    const c = { ...(await srv.api('/company')).data.company };
    writeData(path.join(srv.data, 'company.json'), { ...c, phase: 'running', startedAt: new Date(Date.now() - 86_400_000).toISOString(), board: ['teams'], filesOn: true });
    browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#company`);
    await page.locator('.cf-top h1', { hasText: 'Botdot' }).waitFor({ timeout: 20000 });
    await page.locator('.sp-new', { hasText: 'New team' }).waitFor();
    if (out) await page.screenshot({ path: path.join(out, 'project-bots-empty.png') });
    await page.locator('.sp-new[data-cf-add-bot]', { hasText: 'Add bot' }).click();
    const picker = page.locator('#bot-picker');
    await picker.locator('h2', { hasText: 'Add bot' }).waitFor();
    assert.equal(await picker.locator('[data-pick]').count(), 2);
    await picker.locator('[data-pick]', { hasText: 'Claude Coder' }).click();
    await picker.locator('.btn.primary', { hasText: 'Add' }).click();
    await page.locator(`.sp-own [data-cf-bot="${coder.id}"]`).waitFor();
    assert.deepEqual((await srv.api('/company')).data.company.bots, [coder.id]);
    assert.equal(await page.locator('.sp-new[data-cf-add-bot]').count(), 0, '"+" after its keys adds more');
    assert.equal(await page.locator('.sp-own .sp-join[data-cf-add-bot]').count(), 1);
    if (out) await page.screenshot({ path: path.join(out, 'project-bots-added.png') });
    // "+" offers only the bot not in the project yet.
    await page.locator('.sp-own .sp-join').click();
    await picker.locator('h2', { hasText: 'Add bot' }).waitFor();
    assert.deepEqual(await picker.locator('[data-pick] b').allInnerTexts(), ['QA Tester']);
    await picker.locator('[data-dismiss]').first().click();
    // Its settings list it with ✕, which takes it out of the project.
    await page.locator('.cf-top [data-project-settings]').click();
    const ps = page.locator('.ps-page');
    await ps.locator(`[data-ps-unbot="${coder.id}"]`).waitFor();
    if (out) await page.screenshot({ path: path.join(out, 'project-bots-settings.png') });
    await ps.locator(`[data-ps-unbot="${coder.id}"]`).click();
    await ps.locator(`[data-ps-unbot="${coder.id}"]`).waitFor({ state: 'detached' });
    assert.equal((await srv.api('/company')).data.company.bots, undefined);
    assert.deepEqual(errors, []);
    console.log('project bots: ok');
  } finally { await browser?.close(); await srv.stop(); }
})().catch((e) => { console.error(e); process.exit(1); });
