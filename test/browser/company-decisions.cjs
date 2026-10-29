// Optional browser check of the decisions log (#694): node test/browser/company-decisions.cjs [shots dir]
// A running company with a check-in answered: the You panel lists its decisions, newest first, with the reason under
// one; "Add a decision" splits what is typed at "because" into the decision and its reason; × removes one. A phone
// has it under the floor. Scratch data only.
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
    const a = await makeBot(srv, { name: 'Outreach', color: '#1d9e75' });
    const b = await makeBot(srv, { name: 'Landing Page', color: '#e24b4a' });
    assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'mealwise.app' } })).status, 201);
    const base = { ...(await srv.api('/company')).data.company, board: undefined }; // every piece on the board (#780)
    writeData(path.join(srv.data, 'company.json'), {
      ...base, phase: 'running', startedAt: new Date(Date.now() - 34 * 86_400_000).toISOString(),
      objectives: [{ id: 'o1', name: 'Sign-ups', current: 12, target: 50, color: '#34c759' }],
      teams: [{ id: 't1', name: 'Growth', color: '#34c759', bots: [a.id, b.id], lead: a.id }],
      checkins: [{ day: 30, decision: 'keep', at: new Date(Date.now() - 4 * 86_400_000).toISOString() }],
      decisions: [
        { id: 'd1', text: 'Launch in Polish first', why: 'Most of the first users are Polish', at: new Date(Date.now() - 6 * 86_400_000).toISOString(), by: 'you' },
        { id: 'd2', text: 'Day 30 check-in: Keep going', at: new Date(Date.now() - 4 * 86_400_000).toISOString(), by: 'checkin', day: 30, decision: 'keep' },
      ],
    });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    for (const [name, viewport] of [['wide', { width: 1440, height: 1000 }], ['phone', { width: 390, height: 844 }]]) {
      const page = await (await browser.newContext({ viewport, colorScheme: 'dark' })).newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${srv.base}/#company`);
      await page.locator('.cf-decisions h3', { hasText: 'Decisions' }).waitFor({ timeout: 20000 });
      assert.deepEqual((await page.locator('.cf-decision .cf-row-text').allInnerTexts()).map((t) => t.split('\n')[0]), ['Day 30 check-in: Keep going', 'Launch in Polish first']);
      if (name === 'wide') {
        await page.locator('#cf-decide input').fill('No paid ads because it is too early');
        await page.locator('#cf-decide input').press('Enter');
        await page.locator('.cf-decision', { hasText: 'No paid ads' }).waitFor();
        const d = (await srv.api('/company')).data.company.decisions.at(-1);
        assert.deepEqual([d.text, d.why, d.by], ['No paid ads', 'it is too early', 'you']);
        assert.equal(await page.locator('.cf-decision').first().locator('.cf-row-text span').innerText(), 'it is too early');
      } else {
        const [floor, list] = await Promise.all(['.cf-floor', '.cf-decisions'].map((s) => page.locator(s).boundingBox()));
        assert.ok(list.y >= floor.y + floor.height, 'under the floor on a phone');
        const panel = await page.locator('.cf-panel').boundingBox();
        assert.ok(list.x >= panel.x && list.x + list.width <= panel.x + panel.width + 1, 'within the panel');
      }
      if (shots) {
        await page.locator('.cf-decisions').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(shots, `${name}-decisions.png`), fullPage: name === 'phone' });
      }
      if (name === 'wide') {
        await page.locator('.cf-decision', { hasText: 'No paid ads' }).hover();
        await page.locator('.cf-decision', { hasText: 'No paid ads' }).locator('[data-cf-decision-x]').click();
        await page.waitForFunction(() => !document.body.innerText.includes('No paid ads'));
        assert.equal((await srv.api('/company')).data.company.decisions.length, 2);
      }
      assert.deepEqual(errors, []);
    }
    console.log('PASS the decisions log on the Projects screen (#694)');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
