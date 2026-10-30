// Optional browser check of a project's folder (#702): node test/browser/project-folder.cjs [shots dir]
// Project settings show the Folder row with its path; Open shows the folder alone in Files, under the project's letter,
// with no other place; Delete asks whether the folder stays, and "Delete its folder too" deletes it on the computer.
// Wide and phone. Scratch data, the computer a stand-in (test/fixtures/fake-docker.js).
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, writeData, fakeDocker } = require('../helpers');

(async () => {
  const shots = process.argv[2] || null;
  const docker = fakeDocker();
  const srv = await startServer({ env: { BOT_DOT_LEAD_DELAY_MS: 'off', PATH: `${docker.bin}${path.delimiter}${process.env.PATH}` } });
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const seen = (await srv.api('/whats-new')).data.entries || [];
    if (seen.length) await srv.api('/whats-new/seen', { method: 'POST', body: { id: seen[0].id } });
    const a = await makeBot(srv, { name: 'Site Builder', emoji: '🛠️', computer: 'linux' });
    const b = await makeBot(srv, { name: 'Copy Writer', emoji: '✍️' });
    const startedAt = new Date(Date.now() - 4 * 86_400_000).toISOString();
    writeData(path.join(srv.data, 'company.json'), { projects: [
      { id: 'p1', name: 'Botdot', start: 'botdot.app', kind: 'site', phase: 'running', startedAt, goal: 'Reach 100 active users', teams: [{ id: 't1', name: 'Site', bots: [a.id, b.id], lead: a.id }] },
      { id: 'p2', name: 'Mealwise', start: 'A meal planner', kind: 'idea', phase: 'running', startedAt, goal: '10 parents a week' },
    ] });
    docker.answer('inspect.json', '"running"|"bot-dot/desktop:latest"|"sha256:a"');
    docker.answer('exec.txt', 'ok 3\nd/2/1760000000.0/docs\0f/5120/1760000000.0/plan.md\0f/90000/1760000000.0/logo.png\0');
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const errors = [];

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    let page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#company`);
    await page.locator('.cf-top h1', { hasText: 'Botdot' }).waitFor({ timeout: 20000 });
    await page.locator('.cf-top [data-project-settings]').click();
    const ps = page.locator('.ps-page');
    const folderRow = ps.locator('.ps-row', { has: page.locator('[data-ps-folder]') });
    assert.equal(await folderRow.locator('.ps-path').innerText(), '/workspace/projects/Botdot');
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-settings.png') });
    await folderRow.locator('[data-ps-folder]').click();
    const fx = page.locator('#files');
    await fx.locator('.fx-row[data-path="plan.md"]').waitFor();
    assert.equal(await fx.locator('.fx-letter').innerText(), 'B');
    assert.deepEqual(await fx.locator('.fx-side .fx-place').allInnerTexts(), ['Botdot']);
    assert.equal(await fx.locator('.fx-who b').innerText(), 'Botdot');
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-files.png') });
    await fx.locator('[data-fx="close"]').first().click();
    await fx.waitFor({ state: 'hidden' });

    // Delete Mealwise with its folder: asked, then rm on the computer.
    await page.locator('[data-ps-back]').click();
    await page.locator('.ct-side [data-project="p2"], [data-project="p2"]').first().click();
    await page.locator('.cf-top h1', { hasText: 'Mealwise' }).waitFor();
    await page.locator('.cf-top [data-project-settings]').click();
    await ps.locator('.ps-top h1', { hasText: 'Mealwise' }).waitFor();
    await ps.locator('[data-ps-delete]').click();
    const ask = page.locator('dialog#modal');
    await ask.locator('[data-folder-too]').check();
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-delete.png') });
    docker.answer('exec.txt', 'ok\n');
    await ask.locator('[data-confirm-delete]').click();
    await page.locator('.cf-top h1', { hasText: 'Botdot' }).waitFor();
    assert.deepEqual((await srv.api('/company/list')).data.projects.map((p) => p.id), ['p1']);
    assert.ok(docker.calls().some((x) => x.args[0] === 'exec' && x.args.join(' ').includes("rm -rf") && x.args.join(' ').includes('Mealwise')), 'its folder deleted on the computer');
    assert.ok(!(await srv.api('/projects')).data.projects.some((p) => p.name === 'Mealwise'));

    // A phone: the folder alone, its place in the sheet.
    docker.answer('exec.txt', 'ok 3\nd/2/1760000000.0/docs\0f/5120/1760000000.0/plan.md\0f/90000/1760000000.0/logo.png\0');
    page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#company`);
    await page.locator('.cf-top [data-project-settings]').click({ timeout: 20000 });
    await page.locator('.ps-page [data-ps-folder]').click();
    await page.locator('#files .fx-row[data-path="plan.md"]').waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll');
    if (shots) await page.screenshot({ path: path.join(shots, 'phone-files.png') });
    assert.deepEqual(errors, []);
    console.log('project-folder: ok');
  } finally {
    if (browser) await browser.close();
    await srv.stop();
    docker.remove();
  }
})().catch((e) => { console.error(e); process.exit(1); });
