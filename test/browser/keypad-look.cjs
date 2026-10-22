// Optional browser check of the keypad's new look (#397): NODE_PATH=<directory containing playwright> node test/browser/keypad-look.cjs
// Six bots (two pinned, three categories) and a Board of four tiles. At 1440px the strip over the keys is one kpi card
// per tile, Needs you one card with what waits and Review, and each key has its status pill and its time: Working with
// its line, Needs you, unread, Done, Idle; the pinned keys are larger. On a phone (390px) the strip scrolls sideways
// over Needs you, Pinned is one key a row and the other pages two. SHOTS=<folder> keeps a picture of each. Scratch
// data and the stand-in Claude only; the states a run would give are set on the page.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot } = require('../helpers');

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = async (name, more) => { const b = await makeBot(srv, { name }); await srv.api(`/bots/${b.id}`, { method: 'PUT', body: more }); return b; };
    const news = await bot('News Monitor', { pinned: 1 });
    const home = await bot('Home Helper', { pinned: 2 });
    const inbox = await bot('Inbox Triage', { group: 'Daily' });
    const plan = await bot('Weekly Planner', { group: 'Daily' });
    await bot('Recipe Finder', { group: 'Home' });
    await bot('Server Watch', { group: 'Tech' });
    const add = async (body) => { const r = await srv.api('/dashboard/tiles', { method: 'POST', body }); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data; };
    const temp = await add({ kind: 'value', title: 'Living room', section: 'Home', bot: home.id, unit: '°C' });
    for (const v of [20.7, 20.8, 21, 21.2, 21.1, 21.4, 21.5]) await srv.asChief(`/dashboard/tiles/${temp.id}/value`, { method: 'PUT', body: { value: v } });
    await add({ kind: 'value', title: 'Heating', section: 'Home', bot: home.id, value: 'Eco until 17:00' });
    await add({ kind: 'custom', title: 'Disk', section: 'Server', bot: home.id, value: { used: 62 }, face: [{ type: 'kpi', bind: 'value.used', unit: '%', max: 100, spark: false, change: false }] });
    const mail = await add({ kind: 'value', title: 'Unread mail', section: 'Today', bot: home.id });
    for (const v of [9, 11, 10, 12, 14]) await srv.asChief(`/dashboard/tiles/${mail.id}/value`, { method: 'PUT', body: { value: v } });
    await srv.api('/dashboard/refresh', { method: 'POST' });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const shot = async (name) => { if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`), fullPage: false }); };
    await page.goto(srv.base);
    await page.waitForFunction(() => typeof setView === 'function' && state.bots?.length === 6 && state.dash);
    // What runs and cards would give: News Monitor at work for two minutes, Home Helper asking for an OK, two unread
    // replies for Inbox Triage, Weekly Planner done.
    const set = () => page.evaluate(({ news, home, inbox, plan }) => {
      const b = (id) => state.bots.find((x) => x.id === id);
      Object.assign(b(news), { running: true, state: 'working' });
      Object.assign(b(inbox), { unread: 2 });
      const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
      state.runs = [{ id: 'r1', botId: news, status: 'running', startedAt: ago(2) }, { id: 'r2', botId: plan, status: 'success', result: 'Week planned, page kept up to date', startedAt: ago(30) }, { id: 'r3', botId: inbox, status: 'success', result: '14 new emails: 2 need an answer', startedAt: ago(90) }];
      state.asks = [{ id: 'a1', kind: 'permission', permission: 'reboot', what: { label: 'reboot the router', hint: 'restart the router' }, botId: home, bot: { id: home, name: 'Home Helper', color: b(home).color } }];
      renderContacts();
      showNeeds();
    }, { news: news.id, home: home.id, inbox: inbox.id, plan: plan.id });
    await set();

    assert.equal(await page.locator('#kp-board .kp-card').count(), 4, 'one card per tile');
    assert.deepEqual((await page.locator('#kp-board .kp-card .kit-label').allInnerTexts()), ['Living room', 'Heating', 'Disk', 'Unread mail']);
    assert.equal(await page.locator('#kp-board .kp-card .kit-spark').count(), 2, 'the values with their recent values have a sparkline');
    assert.equal(await page.locator('#kp-board .kp-card .kit-bar').count(), 1, 'the disk its bar');
    assert.match(await page.locator('#kp-needs').innerText(), /^1 needs you\nLet it reboot the router\nReview$/);
    const pill = (name) => page.locator(`#kp-keys .key[title="${name}"] .kit-pill`).innerText();
    assert.equal(await pill('News Monitor'), 'Working');
    assert.equal(await pill('Home Helper'), 'Needs you');
    assert.equal(await pill('Inbox Triage'), '2 unread');
    assert.equal(await pill('Weekly Planner'), 'Done');
    assert.equal(await pill('Recipe Finder'), 'Idle');
    assert.match(await page.locator('#kp-keys .key[title="News Monitor"] .key-time').innerText(), /^2 min$/);
    assert.equal(await page.locator('#kp-keys .key-run').count(), 1, 'the working key has its line');
    const h = async (name) => (await page.locator(`#kp-keys .key[title="${name}"]`).boundingBox()).height;
    assert.ok(await h('News Monitor') > await h('Recipe Finder'), 'a pinned key is larger');
    await shot('keypad-wide');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await set();
    assert.equal(await page.locator('#kp-phone-board .kp-card').count(), 4);
    const strip = await page.locator('#kp-phone-board .kp-board-line').evaluate((el) => [el.scrollWidth, el.clientWidth]);
    assert.ok(strip[0] > strip[1], 'the strip scrolls sideways');
    assert.match(await page.locator('#kp-phone-needs').innerText(), /1 needs you/);
    const width = (sel) => page.locator(sel).first().evaluate((el) => el.getBoundingClientRect().width);
    assert.ok((await width('.kp-sec-pinned .key')) > 2 * (await width('.kp-section:not(.kp-sec-pinned) .key')), 'Pinned one a row, the rest two');
    await shot('keypad-phone');
    assert.deepEqual(errors, []);
    console.log('ok: the keypad\'s strip, Needs you and key statuses, wide and on a phone');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
