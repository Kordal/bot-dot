// Optional browser check of the starter board (#810): node test/browser/project-starter.cjs [shots dir]
// A homelab setup: the Team step's Board panel lists the Chief's objectives and cards, ticked; one is unticked, and
// after Create the home shows the objectives, the cards and the team, without the one unticked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer } = require('../helpers');

const TEAM = {
  bots: [{ name: 'Homelab Keeper', description: 'Keeps the VMs and backups healthy', prompt: 'Watch the VMs.', owns: ['VM notes'], connects: [], tools: ['WebFetch'], routines: 'Daily 7:00', cron: '0 7 * * *', asksFirst: 'rules', preview: 'Checks 6 VMs and 2 backups', team: 'Ops', computer: true }],
  goals: [{ name: 'All VMs up', target: 0 }, { name: 'Nightly backups', target: 7 }],
  cards: [{ ask: 'VMs up on Proxmox' }, { ask: 'Free space on the NAS' }, { ask: 'Last backup of each VM' }],
};

(async () => {
  const shots = process.argv[2] || null;
  const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: false }); };
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    await srv.api('/company', { method: 'POST', body: { start: 'Keep my homelab running' } });
    fs.writeFileSync(path.join(srv.out, 'company-team.txt'), JSON.stringify(TEAM));
    assert.equal((await srv.api('/company/proposal', { method: 'POST' })).status, 200);
    srv.reply('Read it.\n```card\n{"title":"VMs up","show":"number","value":"6","sub":"of 6","how":"Read it."}\n```');
    browser = await chromium.launch({ headless: true });
    for (const [label, viewport] of [['phone', { width: 390, height: 844 }], ['wide', { width: 1440, height: 960 }]]) {
      const page = await (await browser.newContext({ viewport, colorScheme: 'dark' })).newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${srv.base}/`);
      await page.locator('#place-switch [data-place="company"]').click();
      await page.waitForFunction(() => typeof Company !== 'undefined' && !!state.company);
      await page.evaluate(() => Company.go('team'));
      await page.locator('.co-starter li').first().waitFor({ timeout: 20000 });
      assert.equal(await page.locator('.co-starter li').count(), 5);
      await page.waitForTimeout(500);
      await page.evaluate(() => document.querySelector('.co-starter').scrollIntoView({ block: 'center' }));
      await shot(page, `${label}-team`);
      if (label === 'phone') { assert.deepEqual(errors, []); continue; }
      await page.locator('.co-starter input[data-starter="cards"]').nth(2).evaluate((el) => el.click());
      await page.waitForFunction(() => state.company.starter.cards[2].on === false);
      await shot(page, 'wide-unticked');
      await page.locator('[data-create]').click();
      await page.waitForFunction(() => state.company.phase === 'running', null, { timeout: 20000 });
      const c = await page.evaluate(() => state.company);
      assert.deepEqual(c.objectives.map((o) => o.name), ['All VMs up', 'Nightly backups']);
      assert.deepEqual(c.cards.map((x) => x.ask), ['VMs up on Proxmox', 'Free space on the NAS']);
      assert.deepEqual(c.board, ['goals', 'teams']);
      await page.evaluate(() => Company.go(null));
      await page.waitForFunction(() => state.company.cards.every((x) => x.state === 'ready'), null, { timeout: 30000 });
      await page.waitForTimeout(500);
      await shot(page, 'wide-home');
      assert.deepEqual(errors, []);
    }
    console.log('ok');
  } finally { await browser?.close(); await srv.stop(); }
})().catch((e) => { console.error(e); process.exit(1); });
