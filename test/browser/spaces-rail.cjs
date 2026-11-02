// Optional browser check of the rail of spaces (#837): node test/browser/spaces-rail.cjs [shots dir]
// In a wide window with a project the "Bots | Projects" switch gives way to the rail: Home, the project's square, "+",
// and the top bar's tools at its foot. Home opens the Chief, the project its team chat, and the chat column stands at
// the same place in both, at the default width and at one the owner set. The space is remembered, a gone project falls
// back to Home, and with no project there is no rail. Scratch data only.
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
    await makeBot(srv, { name: 'Recipe Finder', color: '#e5484d' });
    assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'quotz.it' } })).status, 201);
    await srv.api('/company', { method: 'PATCH', body: { name: 'Quotz IT' } });
    await srv.api('/company/teams', { method: 'POST', body: { name: 'Quotz IT team', bots: [a.id], lead: a.id } });
    const c = { ...(await srv.api('/company')).data.company, board: undefined };
    writeData(path.join(srv.data, 'company.json'), { ...c, phase: 'running', startedAt: new Date(Date.now() - 86_400_000).toISOString(), objectives: [], todos: [] });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(srv.base);
    await page.locator('#rail .rail-sq').waitFor({ timeout: 20000 });

    assert.equal(await page.locator('#place-switch').isVisible(), false, 'no place switch beside the rail');
    assert.equal(await page.locator('#rail .rail-sq').count(), 1, 'one square per project');
    assert.equal(await page.locator('#rail .rail-sq').textContent(), 'Q', 'the project\'s first letter');
    for (const sel of ['#rail .rail-home #brand', '#rail [data-new-project]', '#rail .rail-foot #search-btn', '#rail .rail-foot #more-btn']) assert.ok(await page.locator(sel).isVisible(), `${sel} in the rail`);
    assert.equal(await page.locator('.side-head').isVisible(), false, 'no top bar left over the keypad');
    assert.equal(await page.locator('#rail .rail-home.here').count(), 1, 'Home is the space on screen');

    const frame = () => page.evaluate(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width) }; };
      const chat = document.querySelector('.app.place-company') ? document.querySelector('#chat-row') : document.querySelector('.main');
      return { rail: r(document.querySelector('#rail')), settings: r(document.querySelector('#more-btn')), chat: r(chat) };
    });
    const check = async (tag) => {
      const home = await frame();
      if (shots) await page.screenshot({ path: path.join(shots, `spaces-${tag}-home.png`) });
      await page.locator('#rail .rail-sq').click();
      await page.locator('#view-group #group-name', { hasText: 'Quotz IT team' }).waitFor();
      assert.equal(await page.locator('#rail .rail-sq.here').count(), 1, `${tag}: the project is the space on screen`);
      const project = await frame();
      if (shots) await page.screenshot({ path: path.join(shots, `spaces-${tag}-project.png`) });
      assert.deepEqual(project, home, `${tag}: nothing moves on a change of space`);
      await page.locator('#rail #brand').click();
      await page.waitForFunction(() => !document.querySelector('.app.place-company') && !document.querySelector('#view-chief').classList.contains('hidden'));
      assert.deepEqual(await frame(), home, `${tag}: and back, on the Chief`);
      return home;
    };

    const def = await check('default');
    assert.equal(def.chat.w, 547, 'the bot view\'s default chat width (38vw)');
    assert.equal(def.rail.w, 76, 'a narrow rail');
    await page.evaluate(() => document.querySelector('#app').style.setProperty('--chat-w', '480px'));
    assert.equal((await check('owner')).chat.w, 480, 'a width the owner set holds in both');
    await page.evaluate(() => document.querySelector('#app').style.removeProperty('--chat-w'));
    await page.setViewportSize({ width: 1300, height: 800 });
    assert.equal((await check('narrow')).chat.w, 494, '38vw, the same in both');
    await page.setViewportSize({ width: 1440, height: 900 });

    // The space is remembered: the project opens again after a reload.
    await page.locator('#rail .rail-sq').click();
    await page.locator('#view-group #group-name', { hasText: 'Quotz IT team' }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('botdot.place')), c.id, 'the project\'s id is the space');
    await page.goto(srv.base);
    await page.locator('#view-group #group-name', { hasText: 'Quotz IT team' }).waitFor({ timeout: 20000 });
    assert.equal(await page.locator('#rail .rail-sq.here').count(), 1, 'the project again');
    // A project that is gone: Home.
    await page.evaluate(() => localStorage.setItem('botdot.place', 'gone'));
    await page.goto(srv.base);
    await page.locator('#rail .rail-home.here').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('.app.place-company').count(), 0, 'Home in place of a gone project');
    await page.waitForFunction(() => state.view === 'chief' && document.querySelector('#view-company').classList.contains('hidden'));
    // A project's address still opens it.
    await page.goto(`${srv.base}/#company`);
    await page.reload();
    await page.locator('#view-group #group-name', { hasText: 'Quotz IT team' }).waitFor({ timeout: 20000 });

    // Narrower windows keep the switch.
    await page.setViewportSize({ width: 900, height: 800 });
    assert.equal(await page.locator('#rail').isVisible(), false, 'no rail below 1001 px');
    assert.ok(await page.locator('#place-switch').isVisible(), 'the switch below 1001 px');
    assert.ok(await page.locator('.side-head #more-btn').isVisible(), 'Settings back in the top bar');
    await page.setViewportSize({ width: 1440, height: 900 });

    // No project: no rail, and Home as before, with the switch.
    assert.equal((await srv.api('/company', { method: 'DELETE' })).status, 200);
    await page.goto(srv.base);
    await page.locator('#place-switch:not(.hidden)').waitFor({ timeout: 20000 });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#rail').isVisible(), false, 'no rail without projects');
    assert.ok(await page.locator('.side-head #brand').isVisible(), 'the logo in the top bar');
    if (shots) await page.screenshot({ path: path.join(shots, 'spaces-none.png') });

    assert.deepEqual(errors, []);
    console.log('spaces rail: ok');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
