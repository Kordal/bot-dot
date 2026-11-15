// Optional browser check of an existing bot in a project's setup review (ADR 244): node test/browser/setup-existing-bots.cjs [shots dir]
// The Chief stages a new bot; "Add a bot" lists the owner's bots, one is ticked and joins with its own head and name,
// with Remove and nothing to set; "Approve first step" puts it in the team, no copy made. Scratch data only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot } = require('../helpers');
const { goSpace } = require('../space-helpers');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const coder = await makeBot(srv, { name: 'Claude Coder', emoji: '💻', description: 'Writes code and opens pull requests' });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['wide', { width: 1440, height: 900 }]]) {
      const c = (await srv.api('/company', { method: 'POST', body: { start: `Review the backlog (${name})`, conversation: true, key: `existing-${name}` } })).data;
      const staged = await srv.asChief(`/company/teams?project=${c.id}`, { method: 'POST', headers: { 'X-Chief-Chat': c.chiefChat }, body: {
        firstStep: 'List the open issues with questions', proposal: [{ name: 'Issue Reviewer', description: 'Reviews open issues', prompt: 'Review issues. Never close one.', tools: ['Read'], team: 'Core' }],
      } });
      assert.equal(staged.status, 200, JSON.stringify(staged.data));
      const page = await (await browser.newContext({ viewport, colorScheme: 'dark' })).newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${srv.base}/#/project/${c.id}`);
      await goSpace(page);
      await page.locator('[data-creation-review]:visible').first().click({ timeout: 20000 });
      await page.locator('.co-card', { hasText: 'Issue Reviewer' }).waitFor({ timeout: 20000 });
      await page.locator('[data-add-bot]').click();
      await page.locator('#bot-picker .pick-bot', { hasText: 'Claude Coder' }).click();
      await page.locator('#bot-picker .btn.primary').click();
      const joined = page.locator(`.co-card.co-joined[data-existing-bot="${coder.id}"]`);
      await joined.waitFor({ timeout: 10000 });
      assert.equal(await joined.locator('[data-rename], select, input').count(), 0, 'nothing to set on an existing bot');
      assert.match(await joined.innerText(), /Claude Coder/);
      if (shots) await page.screenshot({ path: path.join(shots, `${name}-review.png`), fullPage: true });
      await page.locator('[data-create]:not([disabled])').click();
      await page.waitForFunction(async (id) => (await (await fetch(`/api/company?project=${id}`, { headers: { 'X-Bot-Dot': '1' } })).json()).company?.phase === 'running', c.id, { timeout: 20000 });
      const done = (await srv.api(`/company?project=${c.id}`)).data.company;
      assert.ok(done.teams[0].bots.includes(coder.id), 'the existing bot is in the team');
      assert.equal((await srv.api('/bots')).data.filter((b) => b.name.startsWith('Claude Coder')).length, 1, 'no copy');
      assert.deepEqual(errors, []);
      console.log(`ok ${name}`);
      await srv.api(`/company?project=${c.id}`, { method: 'DELETE' }); // the next pass's project is the only one
    }
  } finally { await browser?.close(); await srv.stop(); }
})().catch((e) => { console.error(e); process.exit(1); });
