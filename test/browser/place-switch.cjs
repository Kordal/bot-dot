// Optional browser check of the Bots ↔ Projects switch (#828): node test/browser/place-switch.cjs [shots dir]
// In a wide window the top bar, the switch and the chat's left edge stand at the same place in Bots and in Projects,
// at the default chat width and at one the owner set; the chat keeps the bot view's width. Scratch data only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, writeData } = require('../helpers');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const unseen = (await srv.api('/whats-new')).data.entries;
    if (unseen.length) await srv.api('/whats-new/seen', { method: 'POST', body: { id: unseen[0].id } });
    const a = await makeBot(srv, { name: 'Ops Watchkeeper', color: '#1d9e75' });
    assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'quotz.it' } })).status, 201);
    await srv.api('/company', { method: 'PATCH', body: { name: 'Quotz IT' } });
    await srv.api('/company/teams', { method: 'POST', body: { name: 'Quotz IT team', bots: [a.id], lead: a.id } });
    const c = { ...(await srv.api('/company')).data.company, board: undefined };
    writeData(path.join(srv.data, 'company.json'), { ...c, phase: 'running', startedAt: new Date(Date.now() - 86_400_000).toISOString(), objectives: [], todos: [] });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 1512, height: 900 }, colorScheme: 'dark' })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(srv.base);
    await page.locator('#place-switch:not(.hidden) [data-place="company"]').waitFor({ timeout: 20000 });

    const frame = () => page.evaluate(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width) }; };
      const chat = document.querySelector('.app.place-company') ? document.querySelector('#chat-row') : document.querySelector('.main');
      return { head: r(document.querySelector('.side-head')), sw: r(document.querySelector('#place-switch')), settings: r(document.querySelector('#more-btn')), chat: r(chat) };
    });
    const check = async (tag) => {
      const bots = await frame();
      if (shots) await page.screenshot({ path: path.join(shots, `switch-${tag}-bots.png`) });
      await page.locator('#place-switch [data-place="company"]').click();
      await page.locator('#view-group #group-name', { hasText: 'Quotz IT team' }).waitFor();
      const projects = await frame();
      if (shots) await page.screenshot({ path: path.join(shots, `switch-${tag}-projects.png`) });
      assert.deepEqual(projects, bots, `${tag}: nothing moves on the switch`);
      await page.locator('#place-switch [data-place="bots"]').click();
      await page.waitForFunction(() => !document.querySelector('.app.place-company'));
      assert.deepEqual(await frame(), bots, `${tag}: and back`);
      return bots;
    };

    const def = await check('default');
    assert.equal(def.chat.w, 560, 'the bot view\'s default chat width');
    assert.equal(def.sw.x + def.sw.w, 300 - 16 - 1, 'the switch keeps the left column\'s width');
    // A width the owner set by the chat's handle holds in Projects too.
    await page.evaluate(() => document.querySelector('#app').style.setProperty('--chat-w', '480px'));
    assert.equal((await check('owner')).chat.w, 480);
    await page.evaluate(() => document.querySelector('#app').style.removeProperty('--chat-w'));
    // A narrower wide window: the same width in both.
    await page.setViewportSize({ width: 1100, height: 800 });
    assert.equal((await check('narrow')).chat.w, 418, '38vw, the same in both');

    assert.deepEqual(errors, []);
    console.log('place switch: ok');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
