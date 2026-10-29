// Optional browser check of Project settings (#701): node test/browser/project-settings.cjs [shots dir]
// The gear beside the project's name opens them; each field saves as it is changed (name, colour, an objective, a
// rule, a lead's report rhythm, the standup, a team's name); a change from elsewhere shows at once; Archive moves the
// project under Archived in the list and Unarchive back; Delete asks first and removes it. Wide and phone. Scratch data.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, writeData } = require('../helpers');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer({ env: { BOT_DOT_LEAD_DELAY_MS: 'off' } });
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const seen = (await srv.api('/whats-new')).data.entries || [];
    if (seen.length) await srv.api('/whats-new/seen', { method: 'POST', body: { id: seen[0].id } });
    const a = await makeBot(srv, { name: 'Demo Scheduler', emoji: '📅' });
    const b = await makeBot(srv, { name: 'Launch Poster', emoji: '📣' });
    const c = await makeBot(srv, { name: 'Weekly Tracker', emoji: '📈' });
    const startedAt = new Date(Date.now() - 4 * 86_400_000).toISOString();
    writeData(path.join(srv.data, 'company.json'), { projects: [
      { id: 'p1', name: 'Botdot', start: 'botdot.app', kind: 'site', phase: 'running', startedAt, goal: 'Reach 100 active users', never: ['Spend money'], objectives: [{ id: 'o1', name: 'Active users', current: 7, target: 100 }], teams: [{ id: 't1', name: 'Botdot Growth', bots: [a.id, b.id, c.id], lead: a.id }], sources: [{ id: 's1', kind: 'link', url: 'https://botdot.app/docs', name: 'botdot.app/docs' }] },
      { id: 'p2', name: 'Mealwise', start: 'A meal planner', kind: 'idea', phase: 'running', startedAt, goal: '10 parents a week' },
    ] });
    const get = async (id) => (await srv.api(`/company?project=${id}`)).data.company;
    const until = async (fn, what) => { for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 100)); } throw new Error(`never: ${what}`); };
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    let page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(`${srv.base}/#company`);
    await page.locator('.cf-top h1', { hasText: 'Botdot' }).waitFor({ timeout: 20000 });
    await page.locator('.cf-top [data-project-settings]').click();
    const ps = page.locator('.ps-page');
    await ps.locator('.ps-top h1', { hasText: 'Botdot' }).waitFor();
    assert.deepEqual(await ps.locator('.ps-nav button').allInnerTexts(), ['General', 'Goal', 'Team', 'Reports', 'Rules', 'Archive or delete']);
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-top.png') });

    // Name: saved on Enter, the tree follows.
    await ps.locator('[data-ps-field="name"]').fill('Botdot HQ');
    await ps.locator('[data-ps-field="name"]').press('Enter');
    await page.locator('#company-side [data-project="p1"] .ct-name', { hasText: 'Botdot HQ' }).waitFor();
    // Colour.
    await ps.locator('[data-ps-color="#8e7cff"]').click();
    await until(async () => (await get('p1')).color === '#8e7cff', 'colour');
    // An objective's number, a new objective, a rule.
    await ps.locator('[data-ps-objective="o1"] [data-ps-o="current"]').fill('12');
    await ps.locator('[data-ps-objective="o1"] [data-ps-o="current"]').press('Enter');
    await until(async () => (await get('p1')).objectives[0].current === 12, 'objective');
    await ps.locator('[data-ps-objective-form] input').fill('Paying teams');
    await ps.locator('[data-ps-objective-form] input').press('Enter');
    await until(async () => (await get('p1')).objectives.length === 2, 'new objective');
    await ps.locator('[data-ps-never-form] input').fill('Email customers');
    await ps.locator('[data-ps-never-form] input').press('Enter');
    await until(async () => (await get('p1')).never.join('|') === 'Spend money|Email customers', 'rule');
    // A lead's report rhythm and the standup.
    await ps.locator('[data-ps-team="t1"][data-ps-report="weekly"]').click();
    await until(async () => (await get('p1')).teams[0].report === 'weekly', 'report');
    await ps.locator('.switch:has([data-ps-standup-on]) > span').click();
    await until(async () => (await get('p1')).standup.on === false, 'standup');
    // A team's name and lead.
    await ps.locator('[data-ps-edit-team="t1"]').click();
    await ps.locator('[data-ps-team-name]').fill('Growth');
    await ps.locator('[data-ps-lead]').selectOption(b.id);
    await ps.locator('[data-ps-save-team]').click();
    await until(async () => { const t = (await get('p1')).teams[0]; return t.name === 'Growth' && t.lead === b.id; }, 'team');
    // A change from elsewhere shows at once.
    await srv.api('/company?project=p1', { method: 'PATCH', body: { goal: 'Reach 200 active users' } });
    await until(async () => (await ps.locator('[data-ps-field="goal"]').inputValue()) === 'Reach 200 active users', 'live goal');
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-settings.png'), fullPage: true });

    // Archive: under Archived in the list; Unarchive brings it back.
    await ps.locator('[data-ps-archive]').click();
    await until(async () => (await get('p1')).archived === true, 'archived');
    const side = page.locator('#company-side');
    await side.locator('.ct-archived').waitFor();
    assert.equal(await side.locator('.ct-tree > .ct-branch:not(.ct-archived) [data-project="p1"]').count(), 0);
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-archived.png') });
    await ps.locator('[data-ps-archive]', { hasText: 'Unarchive' }).click();
    await side.locator('.ct-archived').waitFor({ state: 'detached' });

    // Delete Mealwise: it asks first, then it is gone and the first project is shown.
    await side.locator('[data-project="p2"]').click();
    await page.locator('.cf-top h1', { hasText: 'Mealwise' }).waitFor();
    await page.locator('.cf-top [data-project-settings]').click();
    await ps.locator('[data-ps-delete]').click();
    await page.locator('.cf-top h1', { hasText: 'Botdot HQ' }).waitFor();
    assert.deepEqual((await srv.api('/company/list')).data.projects.map((p) => p.id), ['p1']);
    assert.deepEqual(errors, []);

    // A phone: the sections as tabs, the back arrow to the floor.
    page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#company`);
    await page.locator('.cf-top [data-project-settings]').click({ timeout: 20000 });
    await page.locator('.ps-page .ps-top h1').waitFor();
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.ps-nav')).flexDirection), 'row');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll');
    if (shots) await page.screenshot({ path: path.join(shots, 'phone-settings.png'), fullPage: true });
    await page.locator('[data-ps-back]').click();
    await page.locator('.cf-top h1').waitFor();
    assert.deepEqual(errors, []);
    console.log('project-settings: ok');
  } finally {
    if (browser) await browser.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
