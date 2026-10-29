// Optional browser check of the Company's home (#672): node test/browser/company-floor.cjs [shots dir]
// A running company with three teams and a bot in no team: the header says its day, the objectives are charts, a
// room of five spans two columns, the lead of a team sits at the head with a crown (none for a one-bot team), a bot
// at work has a desk while the idle ones sit on the bench. A click on a room shows the team with "Make lead"; "@Bot
// text" in Add a task gives that bot the task. The To-do (#692): its filters, and a repeating task added with the
// picker comes back once ticked. The Chief, the bot in no team and New team sit in a narrow column beside
// the teams (#690). A phone has the floor in one column and the To-do under it. Scratch data only.
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
      todos: [{ id: 'd1', text: 'Review notes for v2.3', done: false, at: new Date().toISOString() }, { id: 'd2', text: 'Check the news about the launch and tell me what people say', due: '2099-01-01', done: false, at: new Date().toISOString() }],
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
      assert.equal(await page.locator('.cf-goal').count(), 3);
      assert.equal(await page.locator('.cf-goal.pace .cf-chart').count(), 3); // day 23: each a pace chart
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
      // Ticked on the wide page, the task is under Done on the phone.
      if (name === 'phone') await page.locator('[data-cf-filter="done"]').click();
      await page.locator('.cf-todo', { hasText: 'Review notes for v2.3' }).waitFor();
      if (name === 'wide') {
        // The pointer over an item changes nothing on it: its text keeps its lines and its day chip stays, Delete only shows.
        const item = page.locator('.cf-todo', { hasText: 'Check the news' });
        const look = () => item.evaluate((el) => ({ row: el.getBoundingClientRect().height, text: el.querySelector('.cf-row-text').getBoundingClientRect().width, chip: getComputedStyle(el.querySelector('.cf-chip')).display }));
        const still = await look();
        await item.hover();
        assert.ok(await item.locator('.cf-del').isVisible(), 'Delete shows under the pointer');
        assert.deepEqual(await look(), still);
        await page.mouse.move(0, 0);
        const [floor, panel] = await Promise.all(['.cf-floor', '.cf-panel'].map((s) => page.locator(s).boundingBox()));
        assert.ok(panel.x > floor.x + floor.width - 1, 'the panel beside the floor');
        const [w, n] = await Promise.all(['.cf-room[data-cf-team="t1"]', '.cf-room[data-cf-team="t2"]'].map((s) => page.locator(s).boundingBox()));
        assert.ok(w.width > n.width * 1.8, 'the big team spans two columns');
        const [rooms, side] = await Promise.all(['.cf-rooms', '.cf-side'].map((s) => page.locator(s).boundingBox()));
        assert.ok(side.x > rooms.x + rooms.width - 1 && side.width < 220, 'the Chief, the bots in no team and New team in a narrow column beside the teams');
        assert.ok(await page.locator('.cf-side .cf-chief').count() && await page.locator('.cf-side .cf-loose').count() && await page.locator('.cf-side .cf-new').count());
        if (shots) await page.screenshot({ path: path.join(shots, `${name}-you.png`), fullPage: true });
        await sales.locator('.cf-room-head .cf-n').click(); // the room, not its name: the name opens the team's chat (#697)
        await page.locator('.cf-panel h2', { hasText: 'Sales' }).waitFor();
        assert.match(await page.locator('.cf-team-kpi').innerText(), /Paying teams/);
        if (shots) await page.screenshot({ path: path.join(shots, `${name}-team.png`), fullPage: true });
        await page.locator(`[data-cf-lead="${id('Lead Finder')}"]`).click();
        await waitFor(async () => (await srv.api('/company')).data.company.teams.find((t) => t.id === 't1').lead === id('Lead Finder'), { what: 'the new lead' });
        await sales.locator('.cf-lead .cf-name', { hasText: 'Lead Finder' }).waitFor();
        await page.locator('[data-cf-close]').click();
        await page.locator('.cf-panel h2', { hasText: 'To-do' }).waitFor();
        await page.locator('#cf-add input').fill('@Weekly Report send the weekly numbers');
        await page.locator('#cf-add input').press('Enter');
        await page.locator('.cf-todo', { hasText: 'send the weekly numbers' }).waitFor();
        assert.equal(await page.locator('#cf-add input').inputValue(), '');
        const todo = (await srv.api('/company')).data.company.todos.find((t) => t.text === 'send the weekly numbers');
        assert.equal(todo.bot, id('Weekly Report'));
        await page.locator('.cf-todo input[data-cf-todo="d1"]').check();
        await waitFor(async () => (await srv.api('/company')).data.company.todos.find((t) => t.id === 'd1').done, { what: 'the task ticked' });
        // The filters: a bot's task under Bots, not under You.
        await page.locator('[data-cf-filter="bots"]').click();
        await page.locator('.cf-todo', { hasText: 'send the weekly numbers' }).waitFor();
        await page.locator('[data-cf-filter="you"]').click();
        await page.locator('.cf-todo', { hasText: 'send the weekly numbers' }).waitFor({ state: 'detached' });
        await page.locator('[data-cf-filter="all"]').click();
        // A weekly task on Mondays, picked under the field: ticked, the next one is there a week later.
        await page.locator('[data-cf-when]').click();
        await page.locator('[data-cf-due]').fill('2026-11-02');
        await page.locator('[data-cf-due]').dispatchEvent('change');
        await page.locator('[data-cf-rhythm="week"]').click();
        await page.locator('#cf-add input').fill('Count active users');
        await page.locator('#cf-add input').press('Enter');
        const weekly = await waitFor(async () => (await srv.api('/company')).data.company.todos.find((t) => t.text === 'Count active users'), { what: 'the weekly task' });
        assert.deepEqual([weekly.due, weekly.repeat], ['2026-11-02', { every: 'week', days: [1] }]);
        await page.locator(`.cf-todo input[data-cf-todo="${weekly.id}"]`).check();
        await waitFor(async () => (await srv.api('/company')).data.company.todos.some((t) => t.text === 'Count active users' && !t.done && t.due === '2026-11-09'), { what: 'the next weekly task' });
      } else {
        const [floor, panel] = await Promise.all(['.cf-floor', '.cf-panel'].map((s) => page.locator(s).boundingBox()));
        assert.ok(panel.y >= floor.y + floor.height - 1, 'the panel under the floor');
        const [rooms, side] = await Promise.all(['.cf-rooms', '.cf-side'].map((s) => page.locator(s).boundingBox()));
        assert.ok(side.y >= rooms.y + rooms.height - 1, 'the narrow column under the teams');
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
