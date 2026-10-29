// Optional browser check of several projects (#689): node test/browser/company-projects.cjs [shots dir]
// The company there was is the first of PROJECTS; each project is a tree of its teams and bots that folds, a lead
// with its crown; a click on a project shows its floor and is remembered after a reload; "+" starts a new one; a bot
// in the tree opens its chat. On a phone the project's name over the floor picks another. Scratch data only.
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
    const side = page.locator('#company-side');
    await side.locator('[data-project="p1"]').waitFor({ timeout: 20000 });
    assert.deepEqual(await side.locator('[data-project] .ct-name').allInnerTexts(), ['Botdot', 'Mealwise']);
    await page.locator('.cf-top h1', { hasText: 'Botdot' }).waitFor();
    // Botdot, shown, is open: its team and three bots, the lead with its crown. Mealwise is folded.
    assert.deepEqual(await side.locator('.ct-team .ct-name').allInnerTexts(), ['Botdot Growth']);
    assert.deepEqual(await side.locator('[data-tree-bot] .ct-name').allInnerTexts(), ['Demo Scheduler', 'Launch Poster', 'Weekly Tracker']);
    assert.equal(await side.locator(`[data-tree-bot="${a.id}"] .ct-crown`).count(), 1);
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-tree.png') });
    // The team folds and unfolds.
    await side.locator('[data-fold="p1:t1"]').click();
    await side.locator('[data-tree-bot]').first().waitFor({ state: 'detached' });
    await side.locator('[data-fold="p1:t1"]').click();
    await side.locator('[data-tree-bot]').nth(2).waitFor();
    // Mealwise: its floor; remembered after a reload.
    await side.locator('[data-project="p2"]').click();
    await page.locator('.cf-top h1', { hasText: 'Mealwise' }).waitFor();
    await page.reload();
    await page.locator('.cf-top h1', { hasText: 'Mealwise' }).waitFor({ timeout: 20000 });
    // A team made here is Mealwise's only.
    const r = await srv.api('/company/teams?project=p2', { method: 'POST', body: { name: 'Ops', bots: [c.id] } });
    assert.equal(r.status, 200);
    await side.locator('.ct-team .ct-name', { hasText: 'Ops' }).waitFor();
    assert.equal((await srv.api('/company')).data.company.teams.length, 1, 'Botdot keeps its one team');
    // "+": a new project, after the others.
    await side.locator('[data-new-project]').click();
    await page.locator('#view-company h1', { hasText: 'What are you working on?' }).waitFor();
    await page.locator('#co-what').fill('A tool for dog walkers');
    await page.locator('#co-ask .co-go').click();
    await page.locator('.co-steps li.on', { hasText: 'About' }).waitFor();
    const list = (await srv.api('/company/list')).data.projects;
    assert.equal(list.length, 3);
    await side.locator(`[data-project="${list[2].id}"].here`).waitFor();
    // A bot in the tree opens its chat.
    await side.locator('[data-project="p1"]').click();
    await side.locator(`[data-tree-bot="${b.id}"]`).click();
    await page.locator('#view-bot').waitFor({ state: 'visible' });
    assert.deepEqual(errors, []);

    // A phone: the name over the floor picks another project.
    page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#company`);
    await page.locator('.cf-top h1', { hasText: 'Botdot' }).waitFor({ timeout: 20000 });
    const pick = page.locator('.cf-top [data-pick-project]');
    assert.equal(await pick.isVisible(), true);
    if (shots) await page.screenshot({ path: path.join(shots, 'phone-title.png') });
    await pick.selectOption('p2');
    await page.locator('.cf-top h1', { hasText: 'Mealwise' }).waitFor();
    await page.locator('.cf-top [data-pick-project]').selectOption('');
    await page.locator('#view-company h1', { hasText: 'What are you working on?' }).waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, 'phone-new.png') });
    assert.deepEqual(errors, []);
    console.log('company-projects: ok');
  } finally {
    if (browser) await browser.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
