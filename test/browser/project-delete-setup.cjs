// Optional browser check of deleting a project while its setup is open (#791): node test/browser/project-delete-setup.cjs [shots dir]
// A wide window: the ⋯ at the end of the setup's steps (#801) offers Delete project, which asks "Delete <name>?" with
// Cancel and Delete and removes it; and Project settings; a right-click on a project row in the left column offers its settings and Delete project, for a
// project not shown too. A phone keeps one gear, on the name line. Scratch data.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, writeData } = require('../helpers');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer({ env: { BOT_DOT_LEAD_DELAY_MS: 'off' } });
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const seen = (await srv.api('/whats-new')).data.entries || [];
    if (seen.length) await srv.api('/whats-new/seen', { method: 'POST', body: { id: seen[0].id } });
    const startedAt = new Date(Date.now() - 4 * 86_400_000).toISOString();
    writeData(path.join(srv.data, 'company.json'), { projects: [
      { id: 'p1', name: 'Botdot', start: 'botdot.app', kind: 'site', phase: 'running', startedAt, goal: 'Reach 100 active users' },
      { id: 'p2', name: 'HomeKeep', start: 'A home assistant helper', kind: 'idea', phase: 'about' },
      { id: 'p3', name: 'GymPulse', start: 'A gym tracker', kind: 'idea', phase: 'about' },
    ] });
    const ids = async () => (await srv.api('/company/list')).data.projects.map((p) => p.id);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    let page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(`${srv.base}/#company`);
    const side = page.locator('#company-side');
    await side.locator('[data-project="p2"]').click({ timeout: 20000 });

    // The setup's ⋯: settings, and Delete.
    const more = page.locator('.co-steps-line [data-project-more]');
    await more.waitFor();
    assert.ok(await more.isVisible());
    await more.click();
    assert.deepEqual(await page.locator('.ct-menu button').allInnerTexts(), ['Project settings', 'Delete project']);
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-setup-menu.png') });
    await page.locator('.ct-menu [data-ct-settings]').click();
    await page.locator('.ps-page .ps-top h1', { hasText: 'HomeKeep' }).waitFor();
    await side.locator('[data-project="p2"]').click();
    await more.click();
    await page.locator('.ct-menu [data-ct-delete]').click();
    await page.locator('dialog h2', { hasText: 'Delete HomeKeep?' }).waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-setup-delete.png') });
    await page.locator('dialog [data-dismiss]').click();
    assert.deepEqual(await ids(), ['p1', 'p2', 'p3'], 'Cancel keeps it');
    await more.click();
    await page.locator('.ct-menu [data-ct-delete]').click();
    await page.locator('dialog [data-confirm-delete]').click();
    await side.locator('[data-project="p2"]').waitFor({ state: 'detached' });
    assert.deepEqual(await ids(), ['p1', 'p3']);

    // The left column's right-click, on a project not shown.
    await side.locator('[data-project="p1"]').click();
    await page.locator('.cf-top h1', { hasText: 'Botdot' }).waitFor();
    await side.locator('[data-project="p3"]').click({ button: 'right' });
    const menu = page.locator('.ct-menu');
    assert.deepEqual(await menu.locator('button').allInnerTexts(), ['Project settings', 'Delete project']);
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-row-menu.png') });
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'detached' });
    await side.locator('[data-project="p3"]').click({ button: 'right' });
    await menu.locator('[data-ct-delete]').click();
    await page.locator('dialog [data-confirm-delete]').click();
    await side.locator('[data-project="p3"]').waitFor({ state: 'detached' });
    await page.locator('.cf-top h1', { hasText: 'Botdot' }).waitFor();
    assert.deepEqual(await ids(), ['p1']);
    assert.deepEqual(errors, []);

    // A phone: one ⋯ in the setup, on the name line.
    await srv.api('/company', { method: 'POST', body: { start: 'A meal planner' } });
    page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#company`);
    await page.locator('.co-pick select').selectOption({ label: 'A meal planner' }, { timeout: 20000 }).catch(() => {});
    await page.locator('.co-steps').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-project-more]:visible').count(), 1);
    if (shots) await page.screenshot({ path: path.join(shots, 'phone-setup.png') });
    assert.deepEqual(errors, []);
    console.log('project-delete-setup: ok');
  } finally {
    if (browser) await browser.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
