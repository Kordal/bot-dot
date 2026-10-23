// Optional browser check of the motion system (#497): NODE_PATH=<directory containing playwright> node test/browser/motion.cjs
// A bot and a Board of two tiles. At 1440px the Board grows out of its key with its tiles one after another and,
// left, stays drawn over the chat untouchable until it has shrunk away; the settings panel slides in; a dialog grows
// in and fades out; a fold grows and shrinks (both without the newest CSS, so as in Firefox); the toast rises. On a phone (390px) a key pushes its chat in over the list and Back pulls it out.
// With reduced motion only fades are left. The page is told it is no test browser (navigator.webdriver), which
// would skip the exits. SHOTS=<folder> keeps a picture mid-movement. Scratch data and the stand-in Claude only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot } = require('../helpers');

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'News Monitor' });
    await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { pinned: 1 } });
    for (const title of ['Living room', 'Unread mail']) await srv.api('/dashboard/tiles', { method: 'POST', body: { kind: 'value', title, section: 'Home', bot: bot.id, value: '3' } });
    await srv.api('/dashboard/refresh', { method: 'POST' });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const shot = async (name, p = page) => { if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`) }); };
    const anim = (sel, p = page) => p.evaluate((s) => getComputedStyle(document.querySelector(s)).animationName, sel);
    const has = (sel, cls, p = page) => p.evaluate(([s, c]) => document.querySelector(s).classList.contains(c), [sel, cls]);
    await page.goto(srv.base);
    await page.waitForFunction(() => typeof setView === 'function' && state.dash?.tiles?.length === 2);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('m-exits-off')), false);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--t2').trim()), '200ms');

    // 1. The Board grows out of its key, its tiles after it.
    await page.locator('#kp-board [data-board]').click();
    assert.ok(await has('#view-dashboard', 'm-board-in'));
    assert.equal(await anim('#view-dashboard'), 'm-grow');
    await page.locator('#view-dashboard .tile').first().waitFor();
    const origin = await page.evaluate(() => document.querySelector('#view-dashboard').style.getPropertyValue('--m-origin'));
    assert.match(origin, /^-?\d+(\.\d+)?px -?\d+(\.\d+)?px$/, 'from where its key is');
    await shot('board-in');
    await page.waitForTimeout(500);
    assert.equal(await has('#view-dashboard', 'm-board-in'), false, 'the class goes once it has played');

    // Left: it shrinks away over the chat, which takes clicks at once.
    await page.evaluate(() => setView('chief'));
    assert.ok(await has('#view-dashboard', 'm-leaving'), 'still drawn while it leaves');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#view-dashboard')).pointerEvents), 'none');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#view-dashboard')).position), 'fixed', 'out of the layout');
    assert.ok(await page.locator('#view-chief textarea').isVisible());
    await page.locator('#view-chief textarea').click({ timeout: 1000 });
    await shot('board-out');
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#view-dashboard').isVisible(), false, 'then hidden');
    assert.equal(await has('#view-dashboard', 'm-leaving'), false);

    // Back at once: it is shown again, in its place.
    await page.evaluate(() => { setView('dashboard'); setView('chief'); setView('dashboard'); });
    assert.equal(await has('#view-dashboard', 'm-leaving'), false, 'shown again before its exit ended');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#view-dashboard')).position), 'static');
    await page.evaluate(() => setView('chief'));
    await page.waitForTimeout(400);

    // 3. The panel slides in.
    await page.evaluate((id) => setView('botsettings', id), bot.id);
    assert.equal(await anim('#panel'), 'm-slide-in');

    // 4. A dialog grows in; closed, it is closed at once and a picture of it fades away over a page that takes clicks.
    const modal = () => page.evaluate(() => { const m = document.querySelector('#modal'); m.innerHTML = '<p style="padding:40px">Hi</p>'; m.showModal(); });
    await modal();
    assert.equal(await anim('#modal'), 'm-dialog-in');
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('#modal').close());
    assert.equal(await page.evaluate(() => document.querySelector('#modal').open), false, 'closed at once');
    assert.equal(await page.locator('dialog.m-dialog-out').count(), 1, 'its picture fades away');
    assert.equal(await anim('dialog.m-dialog-out'), 'm-dialog-out');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('dialog.m-dialog-out')).pointerEvents), 'none');
    assert.equal(await page.evaluate(() => document.querySelector('dialog.m-dialog-out [name]')), null);
    assert.equal(await page.evaluate(() => !!document.elementFromPoint(innerWidth / 2, innerHeight / 2).closest('.m-dialog-out, .m-backdrop-out')), false, 'a click goes to the page under it');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('dialog.m-dialog-out, .m-backdrop-out').count(), 0, 'then gone');
    await modal();
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.locator('dialog.m-dialog-out').waitFor({ state: 'attached', timeout: 150 }); // Esc too
    await page.waitForTimeout(300);

    // 6. A fold opens at once and grows; closed, it shrinks and only then is closed; a second click turns it round.
    await page.evaluate(() => document.querySelector('#view-botsettings').insertAdjacentHTML('beforeend', '<details class="tool" id="m-fold"><summary>Ran 3 commands</summary><pre>a\nb\nc\nd\ne\nf</pre></details>'));
    const fold = () => page.evaluate(() => { const d = document.querySelector('#m-fold'); return { open: d.open, h: d.getBoundingClientRect().height, moving: d.getAnimations().length }; });
    const shut = (await fold()).h;
    await page.locator('#m-fold summary').click();
    let f = await fold();
    assert.ok(f.open && f.moving === 1, 'open at once, growing');
    await page.waitForTimeout(300);
    f = await fold();
    assert.ok(f.open && !f.moving && f.h > shut + 40, 'grown to its content');
    await page.locator('#m-fold summary').click();
    assert.equal((await fold()).open, true, 'still open while it shrinks');
    await page.waitForTimeout(300);
    f = await fold();
    assert.ok(!f.open && Math.abs(f.h - shut) < 1, 'then closed');
    await page.locator('#m-fold summary').click();
    await page.locator('#m-fold summary').click();
    await page.waitForTimeout(300);
    assert.equal((await fold()).open, false, 'opened and closed again: closed');

    // 7. The toast rises, and sinks away.
    await page.evaluate(() => toast('Copied'));
    assert.equal(await anim('#toast'), 'm-rise');
    await page.waitForTimeout(3300);
    assert.ok(await has('#toast', 'leaving'));
    await page.waitForTimeout(200);
    assert.ok(await has('#toast', 'hidden'));

    // 2. A phone: the chat comes in over the list, and Back pulls it out.
    const phone = await context.newPage();
    phone.on('pageerror', (e) => errors.push(e.message));
    await phone.setViewportSize({ width: 390, height: 844 });
    await phone.goto(srv.base);
    await phone.waitForFunction(() => typeof setView === 'function' && state.bots?.length === 1);
    await phone.evaluate(() => showList());
    await phone.waitForTimeout(400);
    await phone.locator('#kp-sections .key').filter({ hasText: 'News Monitor' }).click();
    assert.ok(await has('.main', 'm-push', phone));
    assert.ok(await has('.sidebar', 'm-leaving', phone), 'the list recedes under it');
    assert.equal(await phone.evaluate(() => getComputedStyle(document.querySelector('.sidebar')).zIndex), '0');
    await shot('phone-push', phone);
    await phone.waitForTimeout(400);
    assert.equal(await phone.locator('.sidebar').isVisible(), false);
    await phone.evaluate(() => showList());
    assert.ok(await has('.main', 'm-leaving', phone), 'the chat goes off to the right');
    assert.ok(await has('.sidebar', 'm-return', phone));
    await shot('phone-back', phone);
    await phone.waitForTimeout(400);
    assert.equal(await phone.locator('.main').isVisible(), false);

    // Reduced motion: fades only.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => setView('dashboard'));
    assert.equal(await anim('#view-dashboard'), 'm-fade-in');
    assert.equal(await anim('#view-dashboard .tile'), 'none', 'no tile after another');
    await page.evaluate(() => setView('chief'));
    assert.equal(await anim('#view-dashboard'), 'm-fade-out');

    assert.deepEqual(errors, []);
    console.log('PASS: the Board grows out of its key, its tiles after it, and shrinks away untouchable over the chat; shown again at once it stands in place; the panel slides in; a dialog grows in, closes at once and its picture fades out, also on Esc; a fold grows and shrinks and turns round; the toast rises and sinks; a phone pushes the chat in over the list and Back pulls it out; reduced motion fades only; no browser errors.');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
