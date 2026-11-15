// Optional browser check of pinning a team's chat on Home: node test/browser/team-chat-pin.cjs [shots dir]
// A team's chat stands on Home as a key in Other by itself. Its panel's Pinned switch puts it below the Chief, and
// takes it back to Other. Scratch data only.
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer, makeBot } = require('../helpers');
(async () => {
  const out = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const unseen = (await srv.api('/whats-new')).data.entries;
    if (unseen.length) await srv.api('/whats-new/seen', { method: 'POST', body: { id: unseen[0].id } });
    const a = await makeBot(srv, { name: 'Issue Reviewer', color: '#1d9e75' });
    const b = await makeBot(srv, { name: 'Claude Coder', color: '#888780' });
    await makeBot(srv, { name: 'Day Planner', color: '#378add' });
    await srv.api('/company', { method: 'POST', body: { start: 'qwotz' } });
    await srv.api('/company/teams', { method: 'POST', body: { name: 'Qwotz Dev', bots: [a.id, b.id], lead: a.id } });
    browser = await chromium.launch();
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })).newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(srv.base);
    const pinned = page.locator('.kp-pinned .key[data-key]', { hasText: 'Qwotz Dev' });
    const other = page.locator('.kp-cats .key[data-key]', { hasText: 'Qwotz Dev' });
    await other.waitFor({ timeout: 20000 });
    assert.equal(await pinned.count(), 0);
    await other.click();
    await page.locator('#group-settings').click();
    const sw = page.locator('#view-groupsettings #gs-pinned');
    await sw.waitFor({ state: 'attached' });
    assert.equal(await sw.isChecked(), false);
    await sw.locator('xpath=ancestor::label').click();
    await pinned.waitFor();
    assert.equal(await other.count(), 0);
    assert.equal(await sw.isChecked(), true);
    if (out) await page.screenshot({ path: path.join(out, 'team-chat-pinned.png') });
    await sw.locator('xpath=ancestor::label').click();
    await other.waitFor();
    assert.equal(await pinned.count(), 0);
    assert.deepEqual(errors, []);
    console.log('ok: a team chat pins below the Chief from its panel and unpins');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
