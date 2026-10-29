// Optional browser check of the objectives above the floor (#690): node test/browser/company-goals.cjs [shots dir]
// Day 1: each objective with a target shows where it starts (the number, Day 1 of 90, the first check-in), no flat
// chart. Day 23: a pace chart with the line to the target and the history; "Show as" Bar is saved and stays after a
// reload; an objective with no number is its steps, ticked from the card. Wide and phone. Scratch data only.
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
    const lead = await makeBot(srv, { name: 'Demo Scheduler', color: '#1d9e75' });
    const poster = await makeBot(srv, { name: 'Launch Poster', color: '#d4537e' });
    const loose = await makeBot(srv, { name: 'test-researcher', color: '#639922' });
    assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'botdot.app' } })).status, 201);
    const c = (await srv.api('/company')).data.company;
    const write = (days, objectives) => writeData(path.join(srv.data, 'company.json'), {
      ...c, phase: 'running', startedAt: new Date(Date.now() - (days - 1) * 86_400_000 - 3_600_000).toISOString(), objectives,
      teams: [{ id: 't1', name: 'Botdot Growth', color: '#34c759', bots: [lead.id, poster.id], lead: lead.id }],
    });
    const users = { id: 'o1', name: 'Reach 100 active users', current: 7, target: 100, color: '#34c759' };
    const launch = { id: 'o2', name: 'Launch page live', current: 0, target: 0, color: '#ff7a45', steps: [{ text: 'Write the copy', done: true }, { text: 'Pick a domain', done: false }] };

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    for (const [name, viewport] of [['wide', { width: 1440, height: 1000 }], ['phone', { width: 390, height: 844 }]]) {
      const page = await (await browser.newContext({ viewport, colorScheme: 'dark' })).newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));

      write(1, [users]);
      await page.goto(`${srv.base}/#company`);
      const goal = page.locator('.cf-goal[data-cf-goal="o1"]');
      await goal.waitFor({ timeout: 20000 });
      assert.equal(await goal.locator('.cf-chart').count(), 0, 'no chart on day 1');
      assert.match(await goal.locator('.cf-goal-num').innerText(), /7\s*\/\s*100/);
      assert.match(await goal.locator('.cf-goal-facts').innerText(), /Day 1 of 90[\s\S]*Check-in /);
      if (shots) await page.screenshot({ path: path.join(shots, `${name}-day1.png`), fullPage: true });

      write(23, [{ ...users, current: 31, history: [{ day: 1, value: 7 }, { day: 8, value: 12 }, { day: 15, value: 22 }] }, launch]);
      await page.reload();
      await goal.locator('.cf-chart').waitFor({ timeout: 20000 });
      assert.equal(await goal.locator('polyline.cf-actual').count(), 1);
      assert.equal(await goal.locator('.cf-pace').innerText(), 'On track'); // the line is at about 24.7
      const steps = page.locator('.cf-goal[data-cf-goal="o2"]');
      assert.equal(await steps.locator('.cf-step').count(), 2);
      assert.equal(await steps.locator('.cf-n').innerText(), '1/2');
      if (shots) await page.screenshot({ path: path.join(shots, `${name}-day23.png`), fullPage: true });

      if (name === 'wide') {
        await goal.locator('[data-cf-show]').click();
        await goal.locator('[data-cf-display="bar"]').click();
        await waitFor(async () => (await srv.api('/company')).data.company.objectives[0].display === 'bar', { what: 'the display saved' });
        await steps.locator('input[data-cf-step]').nth(1).check();
        await waitFor(async () => (await srv.api('/company')).data.company.objectives[1].steps[1].done, { what: 'the step ticked' });
        await page.reload();
        await goal.locator('.cf-bar.big').waitFor({ timeout: 20000 });
        assert.equal(await goal.locator('.cf-chart').count(), 0);
        assert.equal(await steps.locator('.cf-n').innerText(), '2/2');
        await goal.locator('[data-cf-show]').click();
        await page.locator('.cf-menu').waitFor();
        await page.keyboard.press('Escape');
        await page.locator('.cf-menu').waitFor({ state: 'detached' });
      } else {
        // The view slides in: the card ends up inside the window, no wider than the phone.
        await page.waitForFunction((w) => { const r = document.querySelector('.cf-goal').getBoundingClientRect(); return r.left >= 0 && r.right <= w; }, viewport.width, { timeout: 5000 });
      }
      assert.deepEqual(errors, []);
    }
    console.log('company-goals: ok');
  } finally {
    if (browser) await browser.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
