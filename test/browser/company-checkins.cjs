// Optional browser check of the Company's 90 days (#673): node test/browser/company-checkins.cjs [shots dir]
// A running company on day 31: the line under the header has days 30, 60 and 90; the day 30 check-in waits above the
// floor with each objective on track or behind; Keep going answers it. The week's plan at the top of You takes a
// Change and an Approve; the bot the Chief suggests is a dashed card whose Add makes it in its team. On day 61 Change
// direction opens a new chat with the Chief, the words started. A phone has it all in one column. Scratch data only.
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
    const a = await makeBot(srv, { name: 'Outreach', color: '#1d9e75' });
    const b = await makeBot(srv, { name: 'Landing Page', color: '#e24b4a' });
    assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'mealwise.app' } })).status, 201);
    const base = (await srv.api('/company')).data.company;
    const file = path.join(srv.data, 'company.json');
    const on = (day, more = {}) => writeData(file, {
      ...base, phase: 'running', startedAt: new Date(Date.now() - (day - 1) * 86_400_000 - 3_600_000).toISOString(),
      objectives: [{ id: 'o1', name: 'Parent interviews', current: 4, target: 10, color: '#34c759' }, { id: 'o2', name: 'Sign-ups', current: 12, target: 50, color: '#ff7a45' }, { id: 'o3', name: 'Paying users', current: 0, target: 1, color: '#8e7cff' }],
      teams: [{ id: 't1', name: 'Growth', color: '#34c759', bots: [a.id, b.id], lead: a.id }],
      plan: { items: [{ text: 'Ask 10 parents to pre-order at $4', objective: 'o3' }, { text: 'Book 5 parent interviews', objective: 'o1' }, { text: 'Get the page to 25 sign-ups', objective: 'o2' }], approved: false, week: '2026-10-26' },
      suggestion: { name: 'Support Desk', description: 'Answers questions from your first users', prompt: 'Answer sign-up questions.', why: 'Sign-ups are coming in', team: 't1' },
      ...more,
    });
    on(31);

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    for (const [name, viewport] of [['wide', { width: 1440, height: 1000 }], ['phone', { width: 390, height: 844 }]]) {
      const page = await (await browser.newContext({ viewport, colorScheme: 'dark' })).newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${srv.base}/#company`);
      await page.locator('.cf-top h1', { hasText: 'Mealwise' }).waitFor({ timeout: 20000 });
      assert.deepEqual(await page.locator('.cf-mark b').allInnerTexts(), ['Day 30', 'Day 60', 'Day 90']);
      const card = page.locator('.cf-checkin');
      assert.equal(await card.locator('h2').innerText(), 'Day 30 check-in');
      assert.deepEqual(await card.locator('.cf-pace').allInnerTexts(), ['On track', 'Behind', 'Behind']);
      await page.locator('.cf-plan li', { hasText: 'Book 5 parent interviews' }).waitFor();
      await page.locator('.cf-suggest', { hasText: 'Support Desk' }).waitFor();
      if (shots) await page.screenshot({ path: path.join(shots, `${name}-checkin.png`), fullPage: true });
      if (name === 'wide') {
        const [c, floor] = await Promise.all(['.cf-checkin', '.cf-floor'].map((s) => page.locator(s).boundingBox()));
        assert.ok(c.y + c.height <= floor.y, 'the check-in above the floor');
        await card.locator('[data-cf-checkin="keep"]').click();
        await page.locator('.cf-mark.keep').waitFor();
        assert.equal(await page.locator('.cf-checkin').count(), 0);
        assert.deepEqual((await srv.api('/company')).data.company.checkins.map((k) => [k.day, k.decision]), [[30, 'keep']]);

        await page.locator('[data-cf-plan-change]').click();
        await page.locator('#cf-change input').fill('Fewer interviews, more sign-ups');
        await page.locator('#cf-change input').press('Enter');
        await waitFor(async () => (await srv.api('/chief')).data.chats.some((x) => x.title === 'Company'), { what: 'the Chief told of the change' });
        await page.locator('[data-cf-plan-approve]').click();
        await page.locator('.cf-plan.approved').waitFor();
        assert.equal((await srv.api('/company')).data.company.plan.approved, true);

        await page.locator('[data-cf-suggest-add]').click();
        await page.locator('.cf-room[data-cf-team="t1"] [title^="Support Desk"]').waitFor();
        assert.equal(await page.locator('.cf-suggest').count(), 0);
        if (shots) await page.screenshot({ path: path.join(shots, `${name}-after.png`), fullPage: true });

        on(61, { checkins: [{ day: 30, decision: 'keep', at: null }], suggestion: null });
        await page.reload();
        await page.locator('.cf-checkin h2', { hasText: 'Day 60 check-in' }).waitFor({ timeout: 20000 });
        await page.locator('[data-cf-checkin="change"]').click();
        await page.locator('#view-chief textarea').waitFor();
        assert.equal(await page.locator('#view-chief textarea').inputValue(), 'Day 60 check-in: I want to change direction. ');
        assert.deepEqual((await srv.api('/company')).data.company.checkins.map((k) => k.decision), ['keep', 'change']);
      } else {
        const floor = await page.locator('.cf-floor').boundingBox();
        assert.ok(floor.width <= viewport.width, 'no sideways scroll');
        await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, null, { timeout: 5000 }); // once the phone's slide-in is over
      }
      assert.deepEqual(errors, []);
      if (name === 'wide') on(31);
    }
    console.log('company-checkins: ok');
  } finally {
    if (browser) await browser.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
