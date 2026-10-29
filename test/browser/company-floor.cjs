// Optional browser check of the Company's home (#672): node test/browser/company-floor.cjs [shots dir]
// A running company with three teams and a bot in no team: the header says its day, the whiteboard its objectives, a
// room of five spans two columns, the lead of a team sits at the head with a crown (none for a one-bot team), a bot
// at work has a desk while the idle ones sit on the bench. A click on a room shows the team with "Make lead"; "@Bot
// text" in Add a task gives that bot the task. A phone has the floor in one column and You under it. Scratch data only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, writeData, waitFor } = require('../helpers');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const names = ['Sales Follow-up', 'Lead Finder', 'Outreach', 'Lead Scorer', 'Demo Booker', 'Support Triage', 'Billing Helper', 'Release Notes', 'Weekly Report'];
    const colors = ['#1d9e75', '#639922', '#378add', '#d4537e', '#1d9e75', '#e24b4a', '#7f77dd', '#7f77dd', '#ef9f27'];
    const bots = [];
    for (const [i, name] of names.entries()) bots.push(await makeBot(srv, { name, color: colors[i] }));
    const id = (name) => bots[names.indexOf(name)].id;
    assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'fernhill.app' } })).status, 201);
    const c = (await srv.api('/company')).data.company;
    writeData(path.join(srv.data, 'company.json'), {
      ...c, phase: 'running', startedAt: new Date(Date.now() - 22 * 86_400_000).toISOString(),
      objectives: [{ id: 'o1', name: 'Paying teams', current: 23, target: 50, color: '#34c759' }, { id: 'o2', name: 'First support reply', current: 6, target: 4, color: '#ff7a45' }, { id: 'o3', name: 'Releases with notes', current: 3, target: 4, color: '#8e7cff' }],
      teams: [
        { id: 't1', name: 'Sales', color: '#34c759', bots: ['Sales Follow-up', 'Lead Finder', 'Outreach', 'Lead Scorer', 'Demo Booker'].map(id), lead: id('Sales Follow-up') },
        { id: 't2', name: 'Support', color: '#ff7a45', bots: ['Support Triage', 'Billing Helper'].map(id), lead: id('Support Triage') },
        { id: 't3', name: 'Releases', color: '#8e7cff', bots: [id('Release Notes')], lead: id('Release Notes') },
      ],
      todos: [{ id: 'd1', text: 'Review notes for v2.3', done: false, at: new Date().toISOString() }],
    });
    srv.hold(); // Lead Finder's run stays at work
    await srv.api(`/bots/${id('Lead Finder')}/run`, { method: 'POST', body: { prompt: 'Find leads' } });
    await waitFor(async () => (await srv.api('/bots')).data.find((b) => b.id === id('Lead Finder'))?.running, { what: 'Lead Finder at work' });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    for (const [name, viewport] of [['wide', { width: 1440, height: 1000 }], ['phone', { width: 390, height: 844 }]]) {
      const page = await (await browser.newContext({ viewport, colorScheme: 'dark' })).newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${srv.base}/#company`);
      await page.locator('.cf-top h1', { hasText: 'Fernhill' }).waitFor({ timeout: 20000 });
      assert.equal(await page.locator('.cf-day').innerText(), 'Day 23 of 90');
      assert.equal(await page.locator('.cf-kpi').count(), 3);
      const sales = page.locator('.cf-room[data-cf-team="t1"]');
      assert.equal(await sales.evaluate((el) => el.classList.contains('wide')), true);
      assert.equal(await sales.locator('.cf-lead .cf-crown').count(), 1);
      if (name === 'wide') {
        assert.equal(await sales.locator('.cf-lead .cf-name').innerText(), 'Sales Follow-up');
        await sales.locator('.cf-desks [title^="Lead Finder"]').waitFor(); // at work: a desk
        assert.equal(await sales.locator('.cf-bench .cf-sit').count(), 3);
      } else {
        assert.equal(await sales.locator('.cf-lead .cf-name').innerText(), 'Lead Finder'); // made lead on the wide page
        assert.equal(await sales.locator('.cf-bench .cf-sit').count(), 4);
      }
      assert.equal(await page.locator('.cf-room[data-cf-team="t3"] .cf-crown').count(), 0);
      assert.equal(await page.locator('.cf-loose .cf-name').innerText(), 'Weekly Report');
      await page.locator('.cf-new', { hasText: 'New team' }).waitFor();
      await page.locator('.cf-todo', { hasText: 'Review notes for v2.3' }).waitFor();
      if (name === 'wide') {
        const [floor, panel] = await Promise.all(['.cf-floor', '.cf-panel'].map((s) => page.locator(s).boundingBox()));
        assert.ok(panel.x > floor.x + floor.width - 1, 'the panel beside the floor');
        const [w, n] = await Promise.all(['.cf-room[data-cf-team="t1"]', '.cf-room[data-cf-team="t2"]'].map((s) => page.locator(s).boundingBox()));
        assert.ok(w.width > n.width * 1.8, 'the big team spans two columns');
        if (shots) await page.screenshot({ path: path.join(shots, `${name}-you.png`), fullPage: true });
        await sales.locator('.cf-room-head .cf-n').click(); // the room, not its name: the name opens the team's chat (#697)
        await page.locator('.cf-panel h2', { hasText: 'Sales' }).waitFor();
        assert.match(await page.locator('.cf-team-kpi').innerText(), /Paying teams/);
        if (shots) await page.screenshot({ path: path.join(shots, `${name}-team.png`), fullPage: true });
        await page.locator(`[data-cf-lead="${id('Lead Finder')}"]`).click();
        await waitFor(async () => (await srv.api('/company')).data.company.teams.find((t) => t.id === 't1').lead === id('Lead Finder'), { what: 'the new lead' });
        await sales.locator('.cf-lead .cf-name', { hasText: 'Lead Finder' }).waitFor();
        await page.locator('[data-cf-close]').click();
        await page.locator('.cf-panel h2', { hasText: 'You' }).waitFor();
        await page.locator('#cf-add input').fill('@Weekly Report send the weekly numbers');
        await page.locator('#cf-add input').press('Enter');
        await page.locator('.cf-todo', { hasText: 'send the weekly numbers' }).waitFor();
        assert.equal(await page.locator('#cf-add input').inputValue(), '');
        const todo = (await srv.api('/company')).data.company.todos.find((t) => t.text === 'send the weekly numbers');
        assert.equal(todo.bot, id('Weekly Report'));
        await page.locator('.cf-todo input[data-cf-todo="d1"]').check();
        await waitFor(async () => (await srv.api('/company')).data.company.todos.find((t) => t.id === 'd1').done, { what: 'the task ticked' });
      } else {
        const [floor, panel] = await Promise.all(['.cf-floor', '.cf-panel'].map((s) => page.locator(s).boundingBox()));
        assert.ok(panel.y >= floor.y + floor.height - 1, 'the panel under the floor');
        assert.ok(floor.width <= viewport.width, 'no sideways scroll');
        if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
      }
      assert.deepEqual(errors, []);
    }
    console.log('company-floor: ok');
  } finally {
    srv.unhold();
    if (browser) await browser.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
