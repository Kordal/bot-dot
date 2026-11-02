// Optional browser check of the spaces (#837, #839): node test/browser/spaces-rail.cjs [shots dir]
// In a wide window with a project the "Bots | Projects" switch gives way to the rail: Home, the project's square, "+",
// and the top bar's tools at its foot. Home opens the Chief, the project its team chat, and the chat column stands at
// the same place in both, at the default width and at one the owner set. The space is remembered, a gone project falls
// back to Home, and with no project the rail holds Home and "+" (#853). Each bot is in one space (#838). Below 1001 px (#839) the title
// opens the spaces sheet and the bottom field the space's chat, full screen, Back the project again. Scratch data only.
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
    for (const sel of ['#rail .rail-home #brand', '#rail [data-rail-new]', '#rail .rail-foot #search-btn', '#rail .rail-foot #more-btn']) assert.ok(await page.locator(sel).isVisible(), `${sel} in the rail`);
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

    // Each bot in one space (#838): the team's bot and its chat are the project's keys, not Home's.
    await page.locator('#rail #brand').click();
    await page.waitForFunction(() => !document.querySelector('.app.place-company'));
    const homeKeys = await page.locator('#kp-keys .key .name').allInnerTexts();
    assert.deepEqual(homeKeys, ['Chief of Staff', 'Recipe Finder'], 'Home: the Chief and the bot in no team');
    await page.locator('#rail .rail-sq').click();
    await page.locator('.sp-keys .key .name', { hasText: 'Ops Watchkeeper' }).waitFor();
    assert.equal(await page.locator('.sp-chip', { hasText: 'Quotz IT team' }).count(), 1, 'the team\'s name');
    if (shots) await page.screenshot({ path: path.join(shots, 'spaces-keys-project.png') });
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', hasTouch: true, isMobile: true })).newPage();
    phone.on('pageerror', (e) => errors.push(e.message));
    await phone.goto(`${srv.base}/#company`);
    await phone.locator('.sp-keys .key .name', { hasText: 'Ops Watchkeeper' }).waitFor({ timeout: 20000 });
    if (shots) await phone.screenshot({ path: path.join(shots, 'spaces-keys-phone-project.png'), fullPage: true });
    assert.equal((await phone.locator('[data-sp-field]').innerText()).trim(), 'Message the team…', "the team's chat at the foot");
    await phone.locator('.cf-top [data-space-pick]').click();
    await phone.locator('#spaces-sheet [data-space="home"]').waitFor();
    if (shots) await phone.screenshot({ path: path.join(shots, 'spaces-phone-sheet.png') });
    await phone.locator('#spaces-sheet [data-space="home"]').click();
    await phone.locator('.side-head .brand-chev').waitFor();
    assert.equal(await phone.locator('#place-switch').isVisible(), false, 'no switch on a phone');
    assert.ok(await phone.locator('#kp-chief').isVisible(), "Home's field is the Chief's");
    await phone.waitForTimeout(500); // the list back in
    if (shots) await phone.screenshot({ path: path.join(shots, 'spaces-phone-home.png') });
    await phone.close();

    // Below 1001 px (#839): no rail, switch or tree. The title opens the spaces; the field the team's chat, full
    // screen, and Back the project again.
    await page.setViewportSize({ width: 800, height: 900 });
    assert.equal(await page.locator('#rail').isVisible(), false, 'no rail below 1001 px');
    assert.equal(await page.locator('#place-switch').isVisible(), false, 'no switch below 1001 px');
    assert.equal(await page.locator('#company-side').isVisible(), false, 'no tree');
    await page.locator('.cf-top .sp-tools [data-sp-tool="more-btn"]').waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, 'spaces-800-project.png') });
    await page.locator('[data-sp-field]').click();
    await page.locator('#view-group #group-name', { hasText: 'Quotz IT team' }).waitFor();
    assert.equal(await page.locator('#view-company').isVisible(), false, 'one chat, full screen');
    await page.keyboard.press('Escape'); // the Chief, in its place
    await page.locator('#view-chief [data-back]').click();
    await page.waitForFunction(() => state.view === 'company');
    await page.locator('.cf-top [data-space-pick]').click();
    const sheet = page.locator('#spaces-sheet');
    assert.deepEqual(await sheet.locator('.sp-row .ct-name').allInnerTexts(), ['Home', 'Quotz IT', 'New bot', 'New project']);
    if (shots) await page.screenshot({ path: path.join(shots, 'spaces-800-sheet.png') });
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => state.view), 'company', 'Esc closes the sheet, nothing else');
    await page.locator('.cf-top [data-space-pick]').click();
    await sheet.locator('[data-space="home"]').click();
    await page.waitForFunction(() => !document.querySelector('.app.place-company'));
    assert.equal(await page.evaluate(() => localStorage.getItem('botdot.place')), 'home', 'Home kept');
    assert.ok(await page.locator('.side-head #more-btn').isVisible(), 'Settings in the top bar');
    if (shots) await page.screenshot({ path: path.join(shots, 'spaces-800-home.png') });
    await page.locator('.side-head #brand').click();
    await sheet.locator('.sp-row', { hasText: 'Quotz IT' }).click();
    await page.locator('.cf-top h1', { hasText: 'Quotz IT' }).waitFor();
    await page.setViewportSize({ width: 1440, height: 900 });

    // No project (#853): no switch and no tree anywhere. The rail holds Home and "+", the first project starts there,
    // and Home stands where it stands with projects; below 1001 px the title's sheet has Home and New project.
    assert.equal((await srv.api('/company', { method: 'DELETE' })).status, 200);
    await page.goto(srv.base);
    await page.locator('#rail [data-rail-new]').waitFor({ timeout: 20000 });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#rail .rail-sq').count(), 0, 'no square without projects');
    assert.ok(await page.locator('#rail .rail-home #brand').isVisible(), 'Home in the rail');
    assert.equal(await page.locator('#place-switch').count(), 0, 'no switch');
    assert.deepEqual(await frame(), def, 'Home as wide as with a project');
    if (shots) await page.screenshot({ path: path.join(shots, 'spaces-none.png') });
    // "+" is generic: New bot (the Chief's new chat, its box started) or New project.
    await page.locator('#rail [data-rail-new]').click();
    assert.deepEqual(await page.locator('.ct-menu [role="menuitem"]').allInnerTexts(), ['New bot', 'New project']);
    if (shots) await page.screenshot({ path: path.join(shots, 'spaces-none-menu.png') });
    await page.locator('.ct-menu [data-new-bot]').click();
    await page.waitForFunction(() => state.view === 'chief' && !state.chatId && document.activeElement === document.querySelector('#view-chief form').text);
    assert.equal(await page.locator('#view-chief form textarea').inputValue(), 'A new bot that ');
    await page.locator('#rail [data-rail-new]').click();
    await page.locator('.ct-menu [data-new-project]').click();
    await page.locator('#view-company h1', { hasText: 'New project' }).waitFor();
    assert.equal(await page.locator('#company-side').isVisible(), false, 'no project tree');
    assert.equal(await page.locator('#rail [data-rail-new].here').count(), 1, 'New project is the space on screen');
    if (shots) await page.screenshot({ path: path.join(shots, 'spaces-none-new.png') });
    await page.locator('#rail #brand').click();
    await page.waitForFunction(() => !document.querySelector('.app.place-company') && state.view === 'chief');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.side-head .brand-chev').click();
    assert.deepEqual(await sheet.locator('.sp-row .ct-name').allInnerTexts(), ['Home', 'New bot', 'New project']);
    if (shots) await page.screenshot({ path: path.join(shots, 'spaces-none-phone-sheet.png') });
    await sheet.locator('[data-space=""]').click();
    await page.locator('#view-company #co-what').waitFor();
    assert.equal(await page.locator('#company-side').isVisible(), false, 'no project tree on a phone');
    if (shots) await page.screenshot({ path: path.join(shots, 'spaces-none-phone-new.png') });
    await page.locator('[data-space-pick]').click();
    await sheet.locator('[data-space="home"]').click();
    await page.waitForFunction(() => !document.querySelector('.app.place-company'));

    assert.deepEqual(errors, []);
    console.log('spaces rail: ok');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
