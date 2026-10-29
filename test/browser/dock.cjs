// Optional browser check of the chats docked on the Projects screen (#691): node test/browser/dock.cjs [shots dir]
// A bot clicked on the floor opens its chat at the bottom of the screen, the floor still under it; the next one opens
// right of it and the first stays expanded beside it (#714), a full chat that sends, replies and is read; minimized it
// is a bar with its unread count; Minimize, a bar's click, a sideways drag, Close and "+N" in a narrow window; the row
// and the open chat survive a reload. A phone opens the chat as a sheet from the bottom, half or full height, the
// others as bars. Scratch data only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, writeData, waitFor } = require('../helpers');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const unseen = (await srv.api('/whats-new')).data.entries;
    if (unseen.length) await srv.api('/whats-new/seen', { method: 'POST', body: { id: unseen[0].id } }); // no What's new over the screen
    const names = ['Demo Scheduler', 'Launch Poster', 'Weekly Tracker', 'Feedback Collector', 'Landing Page Builder'];
    const colors = ['#1d9e75', '#d4537e', '#ef9f27', '#e24b4a', '#7f77dd'];
    const bots = [];
    for (const [i, name] of names.entries()) bots.push(await makeBot(srv, { name, color: colors[i] }));
    const id = (name) => bots[names.indexOf(name)].id;
    assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'botdot.app' } })).status, 201);
    const c = (await srv.api('/company')).data.company;
    writeData(path.join(srv.data, 'company.json'), {
      ...c, name: 'Botdot', phase: 'running', startedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      objectives: [{ id: 'o1', name: 'Active users', current: 7, target: 100, color: '#34c759' }],
      teams: [{ id: 't1', name: 'Growth', color: '#34c759', bots: names.map(id), lead: id('Demo Scheduler') }],
      todos: [],
    });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#company`);
    await page.locator('.cf-top h1', { hasText: 'Botdot' }).waitFor({ timeout: 20000 });
    const desk = (name) => page.locator(`[data-cf-bot="${id(name)}"]`).first();
    const keys = () => page.$$eval('#dock > .dock-item:not(.hidden)', (els) => els.map((el) => el.dataset.key));

    // Launch Poster's chat, docked: the floor stays, the chat's own composer is in the panel.
    await desk('Launch Poster').click();
    await page.locator('#dock-panel #view-bot #bot-name', { hasText: 'Launch Poster' }).waitFor();
    assert.ok(await page.locator('#view-company').isVisible(), 'the floor stays under the chat');
    assert.ok(await page.locator('#dock-panel #view-bot textarea').isVisible());
    const box = await page.locator('#dock-panel').boundingBox();
    assert.equal(Math.round(box.width), 340);
    assert.equal(Math.round(box.height), 460);
    // The row spans the whole column (#714 follow-up): the newest chat stands at its right end, over the panel there.
    const column = await page.locator('.main').boundingBox();
    assert.ok(Math.abs(column.x + column.width - 24 - (box.x + box.width)) < 2, 'the row ends at the column\'s right edge');
    await page.locator('#dock-panel #view-bot textarea').fill('hello');
    await page.locator('#dock-panel #view-bot textarea').press('Enter');
    await page.waitForFunction((bot) => state.runs.some((r) => r.botId === bot && r.prompt === 'hello'), id('Launch Poster')); // sent from the docked chat

    // Weekly Tracker opens right of it; Launch Poster stays expanded beside it, with what was typed in it (#714).
    await page.locator('#dock-panel #view-bot textarea').fill('half a thought');
    await desk('Weekly Tracker').click();
    await page.locator('#dock-panel #bot-name', { hasText: 'Weekly Tracker' }).waitFor();
    assert.deepEqual(await keys(), [`bot:${id('Launch Poster')}`, `bot:${id('Weekly Tracker')}`]);
    const poster = page.locator(`.dock-chat[data-key="bot:${id('Launch Poster')}"]`);
    await poster.locator('.bot-name', { hasText: 'Launch Poster' }).waitFor();
    assert.equal(await poster.locator('textarea').inputValue(), 'half a thought', 'what was typed went with it');
    const pb = await poster.boundingBox();
    assert.equal(Math.round(pb.width), 340);
    assert.equal(Math.round(pb.height), 460);
    assert.equal(await page.locator('#bot-thread').count(), 1, 'one element with each id: the expanded chat has none');
    // It is a full chat: it sends, its reply comes into it, and it is read while it is on screen.
    await poster.locator('textarea').fill('Draft 3 posts');
    await poster.locator('textarea').press('Enter');
    await page.waitForFunction((bot) => state.runs.some((r) => r.botId === bot && r.prompt === 'Draft 3 posts' && r.status !== 'running'), id('Launch Poster'), { timeout: 20000 });
    await poster.locator('[data-reply-run]').last().waitFor({ state: 'attached', timeout: 20000 });
    await page.waitForFunction((bot) => botById(bot)?.unread === 0, id('Launch Poster'), { timeout: 20000 });
    assert.equal((await srv.api(`/bots/${id('Launch Poster')}`)).data.unread, 0, 'read on the server');
    // Reply on its block: the chip is in its own box, not in the open chat's.
    await poster.locator('[data-reply-run]').last().evaluate((b) => b.click());
    await poster.locator('.reply-chip:not(.hidden)').waitFor();
    assert.ok(await page.locator('#dock-panel .reply-chip').isHidden());
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-two-open.png') });
    // Its own Minimize: a bar, which counts a reply that comes now.
    await poster.locator('[data-dock-min-chat]').click();
    await page.locator(`.dock-bar[data-key="bot:${id('Launch Poster')}"]`).waitFor();
    await srv.api(`/bots/${id('Launch Poster')}/run`, { method: 'POST', body: { prompt: 'One more' } });
    await page.locator('.dock-bar .dock-n').waitFor({ timeout: 20000 });
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-open.png') });

    // Minimize: both are bars, the Projects screen is back.
    await page.locator('[data-dock-min]').click();
    await page.waitForFunction(() => state.view === 'company');
    assert.equal(await page.locator('#dock .dock-bar').count(), 2);
    assert.ok(await page.locator('#dock-panel').isHidden());
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-bars.png') });

    // A bar dragged sideways: Weekly Tracker to the left end.
    const tracker = page.locator(`.dock-bar[data-key="bot:${id('Weekly Tracker')}"]`);
    const tb = await tracker.boundingBox();
    await page.mouse.move(tb.x + 120, tb.y + 26);
    await page.mouse.down();
    await page.mouse.move(tb.x - 100, tb.y + 30, { steps: 8 });
    await page.mouse.move(tb.x - 300, tb.y + 30, { steps: 8 });
    await page.mouse.up();
    assert.deepEqual(await keys(), [`bot:${id('Weekly Tracker')}`, `bot:${id('Launch Poster')}`]);
    assert.equal(await page.evaluate(() => state.view), 'company', 'a drag opens nothing');

    // A bar's click opens its chat in its place, and reads it.
    await page.locator(`.dock-bar[data-key="bot:${id('Launch Poster')}"] .dock-open`).click();
    await page.locator('#dock-panel #bot-name', { hasText: 'Launch Poster' }).waitFor();
    await page.locator(`.dock-bar[data-key="bot:${id('Launch Poster')}"]`).waitFor({ state: 'detached' });

    // Three more: each stays expanded beside the next; a narrower window shows two and "+N"; the open one is always shown.
    // The chats expanded at the bottom may stand over a desk: the click goes to it as the owner's would after a scroll.
    for (const n of ['Demo Scheduler', 'Feedback Collector', 'Landing Page Builder']) { await desk(n).dispatchEvent('click'); await page.locator('#dock-panel #bot-name', { hasText: n }).waitFor(); }
    assert.ok(await page.locator('.dock-chat').count() >= 1, 'those opened before stay expanded');
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-many-open.png') });
    // As many side by side as the window holds (each may narrow to 300 px): three and "+2" at 1440, all five at 1920.
    assert.equal((await keys()).length, 3);
    assert.equal(await page.locator('.dock-more').innerText(), '+2');
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.waitForFunction(() => document.querySelectorAll('#dock > .dock-item:not(.hidden)').length === 5);
    assert.equal(await page.locator('.dock-more').count(), 0);
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-1920.png') });
    await page.setViewportSize({ width: 1100, height: 900 });
    await page.locator('.dock-more').waitFor();
    const shown = await keys();
    assert.ok(shown.length < 5 && shown.at(-1) === `bot:${id('Landing Page Builder')}`);
    assert.equal(await page.locator('.dock-more').innerText(), `+${5 - shown.length}`);
    await page.locator('.dock-more').click();
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-overflow.png') });
    await page.locator('.dock-menu button', { hasText: 'Weekly Tracker' }).click();
    await page.locator('#dock-panel #bot-name', { hasText: 'Weekly Tracker' }).waitFor();
    assert.equal((await keys()).at(-1), `bot:${id('Weekly Tracker')}`, 'picked from "+N": newest');

    // A reload keeps the row, its order and the open chat.
    const before = await page.evaluate(() => localStorage.getItem('botdot.dock'));
    await page.reload();
    await page.locator('#dock-panel #bot-name', { hasText: 'Weekly Tracker' }).waitFor({ timeout: 20000 });
    assert.equal(await page.evaluate(() => localStorage.getItem('botdot.dock')), before);
    assert.ok(await page.locator('#view-company').isVisible());

    // Close: the open chat leaves the row and the Projects screen is back; a bar's ✕ closes it too.
    await page.locator('[data-dock-close-open]').click();
    await page.waitForFunction(() => state.view === 'company');
    assert.ok(!(await keys()).includes(`bot:${id('Weekly Tracker')}`));
    const n = (await page.evaluate(() => JSON.parse(localStorage.getItem('botdot.dock')).items.length));
    assert.equal(n, 4);
    await page.locator('#dock .dock-x, #dock [data-dock-close-chat]').last().click();
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('botdot.dock')).items.length === 3);
    // The Bots place: no row.
    await page.locator('#place-switch [data-place="bots"]').click();
    assert.ok(await page.locator('#dock').isHidden());
    await page.locator('#place-switch [data-place="company"]').click();
    await page.locator('#dock > .dock-item').first().waitFor();
    assert.deepEqual(errors, []);

    // A phone: the chat slides up as a sheet, half height; the grip makes it full height.
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', hasTouch: true })).newPage();
    phone.on('pageerror', (e) => errors.push(e.message));
    await phone.goto(`${srv.base}/#company`);
    await phone.locator('.cf-top h1', { hasText: 'Botdot' }).waitFor({ timeout: 20000 });
    await phone.locator(`[data-cf-bot="${id('Weekly Tracker')}"]`).first().click();
    await phone.locator('#dock-panel #bot-name', { hasText: 'Weekly Tracker' }).waitFor();
    await phone.waitForTimeout(400);
    let sheet = await phone.locator('#dock-panel').boundingBox();
    assert.equal(Math.round(sheet.width), 390);
    assert.ok(Math.abs(sheet.y + sheet.height - 844) < 2 && sheet.height < 600, 'half height, at the bottom');
    if (shots) await phone.screenshot({ path: path.join(shots, 'phone-half.png') });
    await phone.locator('.dock-grip').click();
    await phone.waitForTimeout(100);
    sheet = await phone.locator('#dock-panel').boundingBox();
    assert.ok(sheet.height > 800, 'full height');
    if (shots) await phone.screenshot({ path: path.join(shots, 'phone-full.png') });
    await phone.locator('[data-dock-min]').click();
    await phone.waitForFunction(() => state.view === 'company');
    await phone.locator('#dock .dock-bar').first().waitFor();
    if (shots) await phone.screenshot({ path: path.join(shots, 'phone-bars.png') });
    const wide = await phone.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(wide <= 390, 'no sideways scroll');
    assert.deepEqual(errors, []);
    console.log('dock: ok');
  } finally {
    if (browser) await browser.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
