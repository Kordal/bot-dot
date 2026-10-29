// Optional browser check of the board as a free canvas (#783): node test/browser/project-layout.cjs [shots dir]
// A project never arranged keeps the flow. Arrange stands every tile on the canvas where it stood and saves that;
// dragging the Calendar onto the To-do slides the To-do down, a corner makes it bigger, the arrows move the focused
// tile; no two tiles overlap, on the page or on botdot, and a reload shows the same. Done gives the tiles their clicks
// back. A phone shows the same canvas, scaled to its width. Scratch data only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, writeData, waitFor } = require('../helpers');
const B = require('../../public/board-canvas.js');

const clear = (l) => { for (const a of Object.keys(l)) for (const b of Object.keys(l)) if (a < b) assert.ok(!B.hits(l[a], l[b]), `${a} and ${b} overlap`); };

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const lead = await makeBot(srv, { name: 'Demo Scheduler', color: '#1d9e75' });
    writeData(path.join(srv.data, 'company.json'), {
      id: 'p1', name: 'Botdot', start: 'botdot.app', kind: 'site', phase: 'running', startedAt: new Date(Date.now() - 3_600_000).toISOString(),
      teams: [{ id: 't1', name: 'Growth', color: '#34c759', bots: [lead.id], lead: lead.id }],
      objectives: [{ id: 'o1', name: 'Reach 100 active users', target: 100, current: 7 }],
      todos: [{ id: 'd1', text: 'Share the landing page link' }],
    });
    const layout = async () => (await srv.api('/company')).data.company.layout;
    const box = (page, id) => page.locator(`.bc-tile[data-tile="${id}"]`).boundingBox();

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#company`);
    await page.locator('.cf-room').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('.bc-tile').count(), 0, 'the flow until arranged');
    assert.equal(await layout(), undefined);

    // Arrange: every tile on the canvas, where it stood, and saved.
    await page.locator('[data-bc-arrange]').click();
    await page.locator('.bc-wrap.arranging').waitFor({ timeout: 10000 });
    const ids = await page.locator('.bc-tile').evaluateAll((l) => l.map((t) => t.dataset.tile).sort());
    for (const id of ['days', 'goal:o1', `room:t1`, 'chief', 'new-team', 'todo', 'new-card']) assert.ok(ids.includes(id), `${id} on the canvas: ${ids}`);
    await waitFor(async () => !!(await layout()), { what: 'the first layout saved' });
    clear(await layout());
    await page.waitForLoadState('networkidle'); // the page drew botdot's answer
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-arrange.png') });

    // Drag the room onto the To-do: the To-do slides down.
    const before = (await layout())['room:t1'];
    const room = await box(page, 'room:t1');
    const todo = await box(page, 'todo');
    await page.mouse.move(room.x + room.width / 2, room.y + room.height / 2);
    await page.mouse.down();
    await page.mouse.move(todo.x + room.width / 2 + 5, todo.y + room.height / 2 + 5, { steps: 8 });
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-drag.png') });
    await page.mouse.up();
    await waitFor(async () => (await layout())['room:t1'][0] > before[0] + 300, { what: 'the room moved' });
    let l = await layout();
    assert.ok(l.todo[1] >= l['room:t1'][1] + l['room:t1'][3], 'the To-do under the room');
    clear(l);

    // The corner: bigger.
    const was = l['room:t1'];
    const r = await box(page, 'room:t1');
    await page.mouse.move(r.x + r.width - 4, r.y + r.height - 4);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width + 60, r.y + r.height + 80, { steps: 6 });
    await page.mouse.up();
    await waitFor(async () => (await layout())['room:t1'][3] > was[3], { what: 'the room bigger' });
    l = await layout();
    assert.ok(l['room:t1'][2] >= was[2]);
    clear(l);
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-resize.png') });

    // The arrows move the focused tile.
    const chief = l.chief;
    await page.locator('.bc-tile[data-tile="chief"]').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await waitFor(async () => (await layout()).chief[1] !== chief[1], { what: 'moved by the keys' });
    clear(await layout());

    // A reload: the same places, not arranging; Done gave the clicks back.
    await page.reload();
    await page.locator('.bc-tile[data-tile="room:t1"]').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('.bc-wrap.arranging').count(), 0);
    const s = (await page.locator('.bc-wrap').boundingBox()).width / B.W;
    const after = await box(page, 'room:t1');
    const kept = await layout();
    assert.ok(Math.abs(after.width - kept['room:t1'][2] * s) < 2, 'drawn at its size');
    await page.locator('.cf-room').click({ position: { x: 30, y: 60 } });
    await page.locator('.cf-panel h2', { hasText: 'Growth' }).waitFor({ timeout: 10000 });
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-after.png') });

    // A phone: the same canvas, as wide as the window.
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })).newPage();
    phone.on('pageerror', (e) => errors.push(e.message));
    await phone.goto(`${srv.base}/#company`);
    await phone.locator('.bc-tile[data-tile="todo"]').waitFor({ timeout: 20000 });
    const w = (await phone.locator('.bc-wrap').boundingBox()).width;
    assert.ok(w <= 390 && w > 300, `fits the phone: ${w}`);
    await phone.waitForTimeout(800); // the page slides in on a phone
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll');
    if (shots) await phone.screenshot({ path: path.join(shots, 'phone.png'), fullPage: true });

    assert.deepEqual(errors, []);
    console.log('project-layout: ok');
  } finally {
    if (browser) await browser.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
