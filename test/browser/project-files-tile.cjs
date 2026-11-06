// Optional browser check of a project's Files tile (project-files): node test/browser/project-files-tile.cjs [shots dir]
// The tile is on the board with the folder's newest files while the computer runs; a click on a file opens it over its
// folder in Files, a click on the tile opens the folder; taken off in Project settings, it is gone. Wide and phone.
// Scratch data, the computer a stand-in (test/fixtures/fake-docker.js).
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
    const a = await makeBot(srv, { name: 'Infra Admin', emoji: '🛠️', computer: 'linux' });
    writeData(path.join(srv.data, 'company.json'), { projects: [
      { id: 'p1', name: 'Botdot-hosting', start: 'botdot hosting', kind: 'idea', phase: 'running', startedAt: new Date().toISOString(), goal: 'Host botdot', board: ['calendar'], teams: [{ id: 't1', name: 'Infra', bots: [a.id], lead: a.id }] },
    ] });
    const now = Date.now() / 1000;
    docker.answer('inspect.json', '"running"|"bot-dot/desktop:latest"|"sha256:a"');
    const newest = `${now - 600}/5120/hetzner-auction-2026-11-06.md\0${now - 90000}/900/infra/plan.md\0${now - 200000}/300/contabo-vs-hetzner.md\0`;
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const errors = [];
    for (const [name, viewport] of [['wide', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
      docker.answer('exec.txt', newest);
      const ctx = await browser.newContext({ viewport, colorScheme: 'dark', deviceScaleFactor: shots ? 2 : 1 });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${srv.base}/#company`);
      const tile = page.locator('.cf-files');
      await tile.locator('[data-cf-file]').first().waitFor({ timeout: 20000 });
      assert.deepEqual(await tile.locator('.cf-row-text').allInnerTexts(), ['hetzner-auction-2026-11-06.md', 'plan.md', 'contabo-vs-hetzner.md']);
      if (shots) { await page.waitForTimeout(600); await page.screenshot({ path: path.join(shots, `${name}-tile.png`) }); }
      // A file: the file over its folder.
      docker.answer('exec.txt', 'ok 1\nf/900/1760000000.0/plan.md\0');
      await tile.locator('[data-cf-file="infra/plan.md"]').click();
      const fx = page.locator('#files');
      await fx.waitFor();
      if (shots) await page.screenshot({ path: path.join(shots, `${name}-file.png`) });
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      if (await fx.isVisible()) await fx.locator('[data-fx="close"]').first().click();
      await fx.waitFor({ state: 'hidden' });
      // The tile: the folder.
      docker.answer('exec.txt', 'ok 2\nd/1/1760000000.0/infra\0f/5120/1760000000.0/hetzner-auction-2026-11-06.md\0');
      await tile.locator('.cf-room-head').click();
      await fx.locator('.fx-row[data-path="hetzner-auction-2026-11-06.md"]').waitFor();
      assert.deepEqual(await fx.locator('.fx-side .fx-place').allInnerTexts().catch(() => []), name === 'wide' ? ['Botdot-hosting'] : []);
      await fx.locator('[data-fx="close"]').first().click();
      await fx.waitFor({ state: 'hidden' });
      await ctx.close();
    }
    // Taken off, it is gone.
    const r = await srv.api('/company?project=p1', { method: 'PATCH', body: { board: ['calendar'] } });
    assert.deepEqual(r.data.board, ['calendar']);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${srv.base}/#company`);
    await page.locator('.cf-cal').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('.cf-files').count(), 0);
    assert.deepEqual(errors, []);
    console.log('project-files-tile: ok');
  } finally {
    if (browser) await browser.close();
    await srv.stop();
    docker.remove();
  }
})().catch((e) => { console.error(e); process.exit(1); });
