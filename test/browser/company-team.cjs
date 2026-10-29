// Optional browser check of the Company's Team and Start steps (#671): node test/browser/company-team.cjs [shots dir]
// The Team step asks the Chief for the team and shows its cards; a card is renamed, a copy of an existing bot is
// added with Duplicate, "Change the team…" changes it and Undo takes it back; "Create 3 bots" makes them and the Start
// step says the team is ready. Scratch data only; the stand-in Claude answers for the Chief.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot } = require('../helpers');

const TEAM = { bots: [
  { name: 'Market Scout', description: 'Finds who else does this and what parents complain about', prompt: 'Find competitors.', owns: ['Research notes'], connects: [], routines: 'Mondays 8:00', cron: '0 8 * * 1', asksFirst: 'rules', preview: 'Brief on 12 apps and 40 parent reviews', team: 'Growth' },
  { name: 'Outreach', description: 'Finds 20 parents a week and drafts interview invites', prompt: 'Draft invites.', owns: ['Your Gmail'], connects: ['gmail'], routines: 'Daily 9:00', cron: '0 9 * * *', asksFirst: 'every', preview: '', team: 'Growth' },
] };

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    await makeBot(srv, { name: 'Inbox Helper', emoji: '📥', description: 'Sorts your Gmail' });
    fs.writeFileSync(path.join(srv.out, 'company-team.txt'), JSON.stringify(TEAM));
    await srv.api('/company', { method: 'POST', body: { start: 'A meal planner for busy parents' } });
    await srv.api('/company', { method: 'PATCH', body: { name: 'Mealwise', never: ['E-mail someone new', 'Spend money'], goal: '10 parents use it every week', swot: { firstTest: 'Ask 10 parents to pre-order' } } });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['wide', { width: 1440, height: 900 }]]) {
      const page = await (await browser.newContext({ viewport, colorScheme: 'dark' })).newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${srv.base}/`);
      await page.locator('#place-switch [data-place="company"]').click({ timeout: 20000 });
      await page.locator('.co-steps [data-step="team"]').waitFor({ timeout: 20000 });
      await page.locator('.co-steps [data-step="team"]').click();
      await page.locator('.co-card', { hasText: 'Market Scout' }).waitFor({ timeout: 20000 });
      assert.equal(await page.locator('[data-create]').innerText(), 'Create 2 bots');
      assert.equal(await page.locator('.co-card', { hasText: 'Outreach' }).locator('[data-connect-app="gmail"]').innerText(), 'Connect Gmail');
      assert.match(await page.locator('.co-facts').innerText(), /4 facts/);
      if (name === 'wide') {
        // Rename on the card.
        await page.locator('.co-card', { hasText: 'Market Scout' }).locator('[data-rename]').click();
        await page.locator('.co-rename input').fill('Research');
        await page.locator('.co-rename input').press('Enter');
        await page.locator('.co-card b', { hasText: 'Research' }).waitFor();
        // Duplicate an existing bot: its copy is named for the company, and the button says Added.
        await page.locator('[data-existing]').click();
        await page.locator('.co-existing-list li', { hasText: 'Inbox Helper' }).locator('[data-duplicate]').click();
        await page.locator('.co-card b', { hasText: 'Inbox Helper (Mealwise)' }).waitFor();
        assert.equal(await page.locator('.co-existing-list li', { hasText: 'Inbox Helper' }).locator('[data-duplicate]').innerText(), 'Added');
        // "Change the team…" and Undo.
        const now = (await srv.api('/company')).data.company.proposal;
        fs.writeFileSync(path.join(srv.out, 'company-chat.txt'), JSON.stringify({ say: 'Removed Outreach.', bots: now.filter((p) => p.name !== 'Outreach') }));
        await page.locator('#co-change input').fill('Drop Outreach');
        await page.locator('#co-change input').press('Enter');
        await page.locator('.co-reply', { hasText: 'Removed Outreach.' }).waitFor();
        assert.equal(await page.locator('.co-card', { hasText: 'Outreach' }).count(), 0);
        if (shots) await page.screenshot({ path: path.join(shots, `${name}-team.png`), fullPage: true });
        await page.locator('[data-undo]').click();
        await page.locator('.co-card', { hasText: 'Outreach' }).waitFor();
        assert.equal(await page.locator('[data-create]').innerText(), 'Create 3 bots');
        await page.locator('[data-create]').click();
        await page.locator('.co-made h1', { hasText: 'Team ready' }).waitFor({ timeout: 20000 });
        assert.equal(await page.locator('.co-made-list li', { hasText: 'Research' }).count(), 1);
        if (shots) await page.screenshot({ path: path.join(shots, `${name}-start.png`) });
        // Open: the project's home, an empty board with New card (#780).
        await page.locator('[data-home]').click();
        await page.locator('.pc-new').waitFor({ timeout: 20000 });
        assert.equal(await page.locator('.cf-day, .cf-room, .cf-panel').count(), 0, 'nothing on a new board');
        const c = (await srv.api('/company')).data.company;
        assert.deepEqual([c.phase, c.teams.map((t) => t.bots.length)], ['running', [2, 1]]);
      } else if (shots) await page.screenshot({ path: path.join(shots, `${name}-team.png`), fullPage: true });
      assert.deepEqual(errors, []);
    }
    console.log('company-team: ok');
  } finally {
    if (browser) await browser.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
