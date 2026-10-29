// Optional browser check of the project's calendar (#695): node test/browser/project-calendar.cjs [shots dir]
// A running project on day 28: the floor's Calendar tile has this week's seven days with today lit and the next
// items (an event, a dated to-do, a bot's job, the day 30 check-in). A click opens the month, where the owner adds an
// event on a day, renames and moves it, and deletes it. A phone has the tile and the month in one column. Scratch data.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, writeData } = require('../helpers');
const CAL = require('../../public/company-calendar.js');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const a = await makeBot(srv, { name: 'Launch Poster', color: '#e24b8a' });
    const b = await makeBot(srv, { name: 'Weekly Tracker', color: '#d9a31a' });
    assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'botdot.app' } })).status, 201);
    const base = { ...(await srv.api('/company')).data.company, board: undefined }; // every piece on the board (#780)
    const now = CAL.today();
    const tomorrow = CAL.addDays(now, 1);
    writeData(path.join(srv.data, 'company.json'), {
      ...base, phase: 'running', startedAt: new Date(Date.now() - 27 * 86_400_000).toISOString(),
      teams: [{ id: 't1', name: 'Growth', color: '#34c759', bots: [a.id, b.id], lead: a.id }],
      events: [{ id: 'e1', title: 'Launch posts go out', day: now, time: '23:59', by: a.id, at: null }, { id: 'e2', title: 'Demo call: Ana', day: tomorrow, time: '10:00', by: 'you', at: null }],
      todos: [{ id: 'd1', text: 'Count active users', due: tomorrow, repeat: { every: 'days', n: 7 }, done: false, at: null }],
    });
    const bot = (await srv.api(`/bots/${b.id}`)).data;
    assert.equal((await srv.api(`/bots/${b.id}`, { method: 'PUT', body: { ...bot, jobs: [{ name: 'Weekly numbers', kind: 'ai', cron: '0 9 * * 1', prompt: 'Count.', enabled: true }] } })).status, 200);

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    for (const [name, viewport] of [['wide', { width: 1440, height: 1000 }], ['phone', { width: 390, height: 844 }]]) {
      const page = await (await browser.newContext({ viewport, colorScheme: 'dark' })).newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${srv.base}/#company`);
      const tile = page.locator('.cf-cal');
      await tile.locator('.cf-cal-row', { hasText: 'Launch posts go out' }).waitFor({ timeout: 20000 });
      assert.equal(await tile.locator('.cf-cal-day').count(), 7);
      assert.equal(await tile.locator('.cf-cal-day.today b').innerText(), String(Number(now.slice(8))));
      const rows = await tile.locator('.cf-cal-row .cf-row-text').allInnerTexts();
      assert.deepEqual(rows.slice(0, 3), ['Launch posts go out', 'Count active users', 'Demo call: Ana']);
      assert.ok(rows.includes('Day 30 check-in'), rows.join(', '));
      assert.equal(await tile.locator('.cf-cal-row', { hasText: 'Count active users' }).locator('.cf-cal-rep').count(), 1, 'a repeating to-do');
      if (shots) await page.screenshot({ path: path.join(shots, `${name}-tile.png`), fullPage: true });
      if (name === 'phone') {
        assert.ok((await tile.boundingBox()).width <= viewport.width);
        await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, null, { timeout: 5000 });
      }

      await tile.locator(`[data-cf-cal-day="${tomorrow}"]`).click();
      const modal = page.locator('dialog.cf-cal-modal');
      await modal.locator('.cf-cal-list .cf-cal-row', { hasText: 'Demo call: Ana' }).waitFor();
      assert.ok((await modal.locator('.cf-month-cell').count()) % 7 === 0);
      await modal.locator(`.cf-month-cell.sel[data-cf-month-day="${tomorrow}"]`).waitFor();
      if (name === 'wide') {
        await modal.locator('#cf-cal-add input[name=title]').fill('Investor call');
        await modal.locator('#cf-cal-add input[name=time]').fill('15:30');
        await modal.locator('#cf-cal-add .co-go').click();
        await modal.locator('.cf-cal-row', { hasText: 'Investor call' }).waitFor();
        let ev = (await srv.api('/company')).data.company.events.find((e) => e.title === 'Investor call');
        assert.deepEqual([ev.day, ev.time, ev.by], [tomorrow, '15:30', 'you']);
        if (shots) await page.screenshot({ path: path.join(shots, `${name}-month.png`) });

        await modal.locator(`[data-cf-ev="${ev.id}"]`).click();
        await modal.locator('#cf-cal-add input[name=title]').fill('Investor call (moved)');
        await modal.locator('#cf-cal-add input[name=day]').fill(CAL.addDays(tomorrow, 1));
        await modal.locator('#cf-cal-add .co-go').click();
        await page.waitForFunction((id) => !document.querySelector(`[data-cf-ev="${id}"]`), ev.id);
        ev = (await srv.api('/company')).data.company.events.find((e) => e.id === ev.id);
        assert.deepEqual([ev.title, ev.day], ['Investor call (moved)', CAL.addDays(tomorrow, 1)]);

        await modal.locator(`[data-cf-month-day="${CAL.addDays(tomorrow, 1)}"]`).click();
        await modal.locator('.cf-cal-row', { hasText: 'Investor call (moved)' }).hover();
        await modal.locator(`[data-cf-ev-del="${ev.id}"]`).click();
        await page.waitForFunction((id) => !document.querySelector(`[data-cf-ev="${id}"]`), ev.id);
        assert.ok(!(await srv.api('/company')).data.company.events.some((e) => e.id === ev.id));

        const was = await modal.locator('.cf-month-head h2').innerText();
        await modal.locator('[data-cf-month="1"]').click();
        await page.waitForFunction((w) => document.querySelector('.cf-month-head h2').innerText !== w, was);
      } else {
        if (shots) await page.screenshot({ path: path.join(shots, `${name}-month.png`) });
        const box = await modal.boundingBox();
        assert.ok(box.width <= viewport.width);
      }
      await modal.locator('[data-dismiss]').click();
      assert.deepEqual(errors, []);
    }
    console.log('project-calendar: ok');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
