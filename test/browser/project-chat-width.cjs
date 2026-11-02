// Optional browser check of the project chat column's handle (#833): node test/browser/project-chat-width.cjs [shots dir]
// In a wide window the chat column's left edge drags: the board widens as the chat narrows, the width holds over a
// reload and in Bots, a double-click puts the default back, and a hidden chat has no handle. Scratch data only.
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
    await page.goto(`${srv.base}/#company`);
    await page.locator('#view-group #group-name', { hasText: 'Quotz IT team' }).waitFor({ timeout: 20000 });

    const box = async (sel) => page.locator(sel).boundingBox();
    const widths = async () => ({ board: Math.round((await box('#view-company')).width), chat: Math.round((await box('#chat-row')).width) });
    const grip = page.locator('#proj-chat-grip');
    // A handle is 0 px wide (its 9 px target is a ::before), so shown means not display: none.
    const shown = (sel) => page.$eval(sel, (el) => getComputedStyle(el).display !== 'none');
    assert.ok(await shown('#proj-chat-grip'), 'the handle is shown beside the chat column');
    const before = await widths();
    assert.equal(before.chat, 560, 'the default chat width');
    const g = await box('#chat-row');
    assert.ok(Math.abs((await box('#proj-chat-grip')).x - g.x) <= 1, 'the handle stands on the chat\'s left edge');

    // Dragged 120 px right: the chat narrows and the board widens by as much.
    await page.mouse.move(g.x, g.y + 200);
    await page.mouse.down();
    await page.mouse.move(g.x + 60, g.y + 200);
    await page.mouse.move(g.x + 120, g.y + 200);
    await page.mouse.up();
    const after = await widths();
    if (shots) await page.screenshot({ path: path.join(shots, 'project-chat-narrow.png') });
    assert.equal(after.chat, 440);
    assert.equal(after.board - before.board, 120, 'the board takes what the chat gave');
    assert.equal(await page.evaluate(() => localStorage.getItem('botdot.chat.width')), '440', 'kept as the chat width');

    // Arrow keys move it by 16; it never goes under 400.
    await grip.focus();
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowRight');
    assert.equal((await widths()).chat, 400, 'the chat keeps 400');

    // Dragged far left: the board keeps 360.
    const g2 = await box('#chat-row');
    await page.mouse.move(g2.x, g2.y + 200);
    await page.mouse.down();
    await page.mouse.move(100, g2.y + 200, { steps: 4 });
    await page.mouse.up();
    assert.equal((await widths()).board, 360, 'the board keeps 360');
    if (shots) await page.screenshot({ path: path.join(shots, 'project-chat-wide.png') });

    // Back to 440; it holds over a reload and in Bots.
    await page.evaluate(() => { localStorage.setItem('botdot.chat.width', '440'); });
    await page.reload();
    await page.locator('#view-group #group-name', { hasText: 'Quotz IT team' }).waitFor({ timeout: 20000 });
    assert.equal((await widths()).chat, 440, 'over a reload');
    await page.locator('#rail .brand:visible, #place-switch [data-place="bots"]:visible').click();
    await page.waitForFunction(() => !document.querySelector('.app.place-company'));
    assert.equal(Math.round((await box('.main')).width), 440, 'the Bots chat has the same width');
    assert.ok(!(await shown('#proj-chat-grip')), 'no project handle in Bots');
    assert.ok(await shown('#chat-grip'), 'the Bots handle is still there');
    await page.locator('#rail .rail-sq:visible, #place-switch [data-place="company"]:visible').click();
    await page.locator('#view-group #group-name', { hasText: 'Quotz IT team' }).waitFor();

    // A double-click puts the default back.
    { const r = await box('#chat-row'); await page.mouse.dblclick(r.x, r.y + 200); }
    assert.equal((await widths()).chat, 560, 'the default again');
    assert.equal(await page.evaluate(() => localStorage.getItem('botdot.chat.width')), null);

    // Hidden chat: no handle, the board takes the whole width.
    await page.locator('#chat-row .dock-ctl.col').first().click();
    await page.waitForFunction(() => document.querySelector('.app.proj-hidden'));
    assert.ok(!(await shown('#proj-chat-grip')), 'no handle with the chat hidden');

    assert.deepEqual(errors, []);
    console.log('project chat width: ok');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
