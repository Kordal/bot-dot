// Optional browser check of the morning standup (#698): node test/browser/company-standup.cjs [shots dir]
// A running project with today's standup merged: one card in You, each team in its colour with its lead's done, next
// and blocked lines; the blocked line that asks the owner has Reply, which opens the lead's chat with it quoted, and
// counts in what waits. A phone has it in one column. Scratch data only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, writeData } = require('../helpers');
const { localDay } = require('../../lib/company');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const a = await makeBot(srv, { name: 'Outreach', color: '#1d9e75' });
    const b = await makeBot(srv, { name: 'Landing Page', color: '#e24b4a' });
    const s = await makeBot(srv, { name: 'Support Desk', color: '#378add' });
    assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'mealwise.app' } })).status, 201);
    const base = { ...(await srv.api('/company')).data.company, board: undefined }; // every piece on the board (#780)
    const day = localDay(new Date(), (await srv.api('/settings')).data.quietHours?.timeZone).day;
    const at = new Date().toISOString();
    writeData(path.join(srv.data, 'company.json'), {
      ...base, phase: 'running', startedAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
      objectives: [{ id: 'o1', name: 'Sign-ups', current: 12, target: 50, color: '#34c759' }],
      teams: [{ id: 't1', name: 'Growth', color: '#34c759', bots: [a.id, b.id], lead: a.id }, { id: 't2', name: 'Support', color: '#3aa0ff', bots: [s.id], lead: s.id }],
      standups: [{ day, at, merged: true, leads: [
        { team: 't1', bot: a.id, done: 'Landing page draft is up', next: 'Publish the launch post', blocked: 'Which price goes on the page?', asks: true, at },
        { team: 't2', bot: s.id, done: 'Answered 4 questions', next: 'FAQ page', blocked: '', asks: false, at },
      ] }],
    });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    for (const [name, viewport] of [['wide', { width: 1440, height: 1000 }], ['phone', { width: 390, height: 844 }]]) {
      const page = await (await browser.newContext({ viewport, colorScheme: 'dark' })).newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${srv.base}/#company`);
      const card = page.locator('.cf-standup');
      await card.waitFor({ timeout: 20000 });
      assert.equal(await card.locator('h3').innerText(), 'Standup');
      assert.deepEqual(await card.locator('.cf-su-name').allInnerTexts(), ['Growth', 'Support']);
      assert.deepEqual(await card.locator('.cf-su .cf-row-text').allInnerTexts(), ['Landing page draft is up', 'Publish the launch post', 'Which price goes on the page?', 'Answered 4 questions', 'FAQ page']);
      assert.equal(await card.locator('.cf-su.asks [data-cf-standup-reply]').count(), 1);
      assert.equal(await page.locator('.cf-panel-head .cf-count').innerText(), '1', 'the ask waits for the owner');
      if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
      if (name === 'phone') await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth, null, { timeout: 5000 });
      await card.locator('[data-cf-standup-reply]').click();
      await page.locator('#view-bot textarea').waitFor();
      assert.equal(await page.locator('#view-bot textarea').inputValue(), 'Standup: Which price goes on the page?\n');
      assert.deepEqual(errors, []);
    }
    console.log('company standup: ok');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
