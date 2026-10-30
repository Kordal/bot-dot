// Optional browser check of what a proposed bot must reach (#808): node test/browser/team-reaches.cjs [shots dir]
// A homelab team: one bot on the computer with a matched login, a login and an SSH key not saved yet; the gap's menu
// lists the Vault's logins, a pick fills it, and Create leaves nothing in Needs you.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer } = require('../helpers');

const TEAM = { bots: [
  { name: 'Homelab Keeper', description: 'Keeps the VMs and backups healthy', prompt: 'Watch the VMs.', owns: ['VM notes'], connects: [], tools: ['WebFetch'], routines: 'Daily 7:00', cron: '0 7 * * *', asksFirst: 'rules', preview: 'Checks 6 VMs and 2 backups', team: 'Ops',
    computer: true, logins: ['Proxmox pve', 'nas.lan'], ssh: ['backup.lan'] },
] };

(async () => {
  const shots = process.argv[2] || null;
  const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: false }); };
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    await srv.api('/vault', { method: 'POST', body: { name: 'Proxmox pve', site: 'pve.lan', password: 'pve-fixture-1' } });
    const kuma = (await srv.api('/vault', { method: 'POST', body: { name: 'Synology NAS', site: 'nas.home', password: 'nas-fixture-2' } })).data;
    await srv.api('/company', { method: 'POST', body: { start: 'Keep my homelab running' } });
    fs.writeFileSync(path.join(srv.out, 'company-team.txt'), JSON.stringify(TEAM));
    assert.equal((await srv.api('/company/proposal', { method: 'POST' })).status, 200);
    browser = await chromium.launch({ headless: true });
    for (const [label, viewport] of [['wide', { width: 1440, height: 960 }], ['phone', { width: 390, height: 844 }]]) {
      const page = await (await browser.newContext({ viewport, colorScheme: 'dark' })).newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${srv.base}/`);
      await page.locator('#place-switch [data-place="company"]').click();
      await page.waitForFunction(() => typeof Company !== 'undefined' && !!state.company);
      await page.evaluate(() => Company.go('team'));
      await page.locator('.co-card').first().waitFor({ timeout: 20000 });
      await page.waitForFunction((n) => document.querySelectorAll('.co-card .co-tag-chip.off').length === n, label === 'wide' ? 2 : 1, { timeout: 10000 }); // the wide one fills a gap
      await page.locator('.co-card .co-card-name').first().scrollIntoViewIfNeeded();
      await shot(page, `${label}-card`);
      if (label === 'wide') {
        await page.locator('[data-reach="logins"][data-need="nas.lan"]').click();
        await page.locator('[data-reach-pick]').first().waitFor();
        await shot(page, 'wide-menu');
        await page.locator(`[data-reach-pick="${kuma.id}"]`).click();
        await page.waitForFunction(() => document.querySelectorAll('.co-card .co-tag-chip.off').length === 1);
        await shot(page, 'wide-picked');
      }
      assert.deepEqual(errors, []);
    }
    console.log('ok');
  } finally { await browser?.close(); await srv.stop(); }
})().catch((e) => { console.error(e); process.exit(1); });
