// Optional browser check of several projects (#689): node test/browser/company-projects.cjs [shots dir]
// The company there was is the first square in the rail (#837); a project's page has its teams and bots as keys, the
// lead first with its crown (#838); a click on a square shows its page and is remembered after a reload; "+" starts a
// new one; a bot's key opens its chat. On a phone the title's sheet picks another (#839). Scratch data only.
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
    const seen = (await srv.api('/whats-new')).data.entries || []; // no What's new over the page
    if (seen.length) await srv.api('/whats-new/seen', { method: 'POST', body: { id: seen[0].id } });
    const a = await makeBot(srv, { name: 'Demo Scheduler', emoji: '📅' });
    const b = await makeBot(srv, { name: 'Launch Poster', emoji: '📣' });
    const c = await makeBot(srv, { name: 'Weekly Tracker', emoji: '📈' });
    const startedAt = new Date().toISOString();
    writeData(path.join(srv.data, 'company.json'), { projects: [
      { id: 'p1', name: 'Botdot', start: 'botdot.app', kind: 'site', phase: 'running', startedAt, goal: 'Reach 100 active users', objectives: [{ id: 'o1', name: 'Active users', current: 7, target: 100 }], teams: [{ id: 't1', name: 'Botdot Growth', bots: [a.id, b.id, c.id], lead: a.id }] },
      { id: 'p2', name: 'Mealwise', start: 'A meal planner', kind: 'idea', phase: 'running', startedAt, goal: '10 parents a week', teams: [{ id: 't2', name: 'Kitchen', bots: [b.id], lead: b.id }] },
    ] });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    let page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#company`);
    const side = page.locator('#rail'); // a square per project (#837)
    await side.locator('[data-space="p1"]').waitFor({ timeout: 20000 });
    assert.deepEqual(await side.locator('.rail-sq').evaluateAll((els) => els.map((el) => el.title)), ['Botdot', 'Mealwise']);
    await page.locator('.cf-top h1', { hasText: 'Botdot' }).waitFor();
    // Botdot's page: its team and three bots, the lead first with its crown (#838).
    assert.deepEqual(await page.locator('.sp-chip').allInnerTexts(), ['Botdot Growth']);
    assert.deepEqual(await page.locator('.sp-keys .key .name').allInnerTexts(), ['Demo Scheduler', 'Launch Poster', 'Weekly Tracker']);
    assert.equal(await page.locator(`.sp-keys [data-cf-bot="${a.id}"] .cf-crown`).count(), 1);
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-rail.png') });
    // Mealwise: its page; remembered after a reload.
    await side.locator('[data-space="p2"]').click();
    await page.locator('.cf-top h1', { hasText: 'Mealwise' }).waitFor();
    await page.reload();
    await page.locator('.cf-top h1', { hasText: 'Mealwise' }).waitFor({ timeout: 20000 });
    // A team made here is Mealwise's only.
    const r = await srv.api('/company/teams?project=p2', { method: 'POST', body: { name: 'Ops', bots: [c.id] } });
    assert.equal(r.status, 200);
    await page.locator('.sp-chip', { hasText: 'Ops' }).waitFor();
    assert.equal((await srv.api('/company')).data.company.teams.length, 1, 'Botdot keeps its one team');
    // "+": a new project, after the others.
    await page.locator('#rail [data-rail-new]').click(); // "+": New bot or New project (#853)
    await page.locator('.ct-menu [data-new-project]').click();
    await page.locator('#view-company .co-new h1', { hasText: "You know where. We'll work out how." }).waitFor();
    await page.locator('#co-what').fill('A tool for dog walkers');
    await page.locator('#co-ask .co-go').click();
    await page.locator('.co-steps li.on', { hasText: 'About' }).waitFor();
    const list = (await srv.api('/company/list')).data.projects;
    assert.equal(list.length, 3);
    await side.locator(`[data-space="${list[2].id}"].here`).waitFor();
    // "+", Start from scratch (#788): an empty project at once, on its blank board with New card; no setup, no team.
    await page.locator('#rail [data-rail-new]').click(); // "+": New bot or New project (#853)
    await page.locator('.ct-menu [data-new-project]').click();
    await page.locator('#view-company [data-start-empty]').click();
    await page.locator('.cf-top h1', { hasText: 'New project' }).waitFor();
    await page.locator('#view-company .pc-new, #view-company .pc-picks').first().waitFor();
    assert.equal(await page.locator('.co-steps').count(), 0);
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-empty.png') });
    const empty = (await srv.api('/company/list')).data.projects[3];
    assert.deepEqual([empty.phase, empty.teams, empty.board, empty.start], ['running', [], [], '']);
    await side.locator(`[data-space="${empty.id}"].here`).waitFor();
    // A bot's key opens its chat.
    await side.locator('[data-space="p1"]').click();
    await page.locator(`.sp-keys [data-cf-bot="${b.id}"]`).click();
    await page.locator('#view-bot').waitFor({ state: 'visible' });
    assert.deepEqual(errors, []);

    // A phone: the name over the floor opens the spaces sheet, which picks another project (#839).
    page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#company`);
    await page.locator('.cf-top h1', { hasText: 'Botdot' }).waitFor({ timeout: 20000 });
    const pick = page.locator('.cf-top [data-space-pick]');
    assert.equal(await pick.isVisible(), true);
    if (shots) await page.screenshot({ path: path.join(shots, 'phone-title.png') });
    await pick.click();
    await page.locator('#spaces-sheet [data-space="p2"]').click();
    await page.locator('.cf-top h1', { hasText: 'Mealwise' }).waitFor();
    await page.locator('.cf-top [data-space-pick]').click();
    await page.locator('#spaces-sheet [data-space=""]').click();
    await page.locator('#view-company .co-new h1', { hasText: "You know where. We'll work out how." }).waitFor();
    await page.locator('#view-company [data-start-empty]').waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, 'phone-new.png') });
    assert.deepEqual(errors, []);
    console.log('company-projects: ok');
  } finally {
    if (browser) await browser.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
