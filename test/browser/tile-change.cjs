// Optional browser check of asking the Chief to change a Board tile (#430): NODE_PATH=<directory containing playwright> node test/browser/tile-change.cjs
// At 1440px the pencil shows on hover, opens the ask under the tile, Enter sends it (a Chief chat names the tile) and
// the tile says "Sent to …"; a right-click opens it too, Esc closes it, and the trash asks before it removes. On a
// phone (390px) a long press opens it as a sheet with the tile's title. SHOTS=<folder> keeps a picture of each.
// Scratch data and the stand-in Claude only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, waitFor } = require('../helpers');

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const home = await makeBot(srv, { name: 'Home Helper' });
    const add = async (body) => (await srv.api('/dashboard/tiles', { method: 'POST', body })).data;
    await add({ kind: 'switch', title: 'LED strip', bot: home.id, read: { type: 'script', script: 'echo on' }, turnOn: { type: 'script', script: 'true' }, turnOff: { type: 'script', script: 'true' } });
    const mail = await add({ kind: 'value', title: 'Mailbox last opened', section: 'Home', bot: home.id, size: 'wide' });
    await srv.asChief(`/dashboard/tiles/${mail.id}/value`, { method: 'PUT', body: { value: '13 hours ago' } });
    const spare = await add({ kind: 'note', title: 'Spare', section: 'Home', bot: home.id });
    await srv.api('/dashboard/refresh', { method: 'POST' });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const shot = async (name) => { if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`) }); };
    await page.goto(srv.base);
    await page.waitForFunction(() => typeof setView === 'function' && state.bots?.length === 1);
    await page.locator('[data-board]:visible').first().click();
    await page.waitForSelector('#view-dashboard .dash-grid');
    const tile = page.locator(`#view-dashboard [data-tile="${mail.id}"]`);
    const pen = tile.locator('[data-tile-edit]');
    assert.equal(await pen.evaluate((el) => getComputedStyle(el).opacity), '0', 'the pencil hides until hover');
    await tile.hover();
    await waitFor(async () => (await pen.evaluate((el) => getComputedStyle(el).opacity)) === '1', { what: 'the pencil on hover' });
    assert.equal(await page.locator('.ctl-row [data-tile-edit]').count(), 1, 'a switch row has one too');
    await pen.click();
    const pop = page.locator('.ask-pop');
    await pop.waitFor();
    assert.ok(await tile.evaluate((el) => el.classList.contains('asking')));
    const [tb, pb] = [await tile.boundingBox(), await pop.boundingBox()];
    assert.ok(pb.y >= tb.y + tb.height && Math.abs(pb.x - tb.x) < 2, 'under the tile');
    assert.equal(await pop.locator('textarea').evaluate((el) => el === document.activeElement), true);
    assert.equal(await pop.locator('h2').count(), 0, 'no title: the tile is right above');
    await page.keyboard.type('Show the date too');
    await shot('wide-ask');
    srv.reply('On it.');
    await page.keyboard.press('Enter');
    await pop.waitFor({ state: 'detached' });
    await waitFor(async () => (await tile.innerText()).includes('Sent to Chief of Staff'), { what: '"Sent to" on the tile' });
    const turn = await srv.nextRun((x) => !!x.botdot, "the Chief's turn");
    assert.ok(JSON.stringify(turn).includes(`Board tile “Mailbox last opened” · id ${mail.id} · heading Home · bot Home Helper`));

    // A right-click opens it too; Esc closes it; the trash asks first.
    await tile.click({ button: 'right' });
    await pop.waitFor();
    await page.keyboard.press('Escape');
    await pop.waitFor({ state: 'detached' });
    const spareTile = page.locator(`#view-dashboard [data-tile="${spare.id}"]`);
    await spareTile.click({ button: 'right' });
    page.once('dialog', (d) => d.accept());
    await page.locator('.ask-pop [data-ask-rm]').click();
    await waitFor(async () => (await spareTile.count()) === 0, { what: 'the tile removed' });

    // A phone: a long press opens a sheet with the tile's title.
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    phone.on('pageerror', (e) => errors.push(e.message));
    await phone.goto(srv.base);
    await phone.waitForFunction(() => typeof setView === 'function' && state.bots?.length === 1);
    await phone.locator('[data-board]:visible').first().click();
    await phone.waitForSelector('#view-dashboard .dash-grid');
    const ptile = phone.locator(`#view-dashboard [data-tile="${mail.id}"]`);
    assert.equal(await ptile.locator('[data-tile-edit]').evaluate((el) => getComputedStyle(el).display), 'none', 'no pencil on touch');
    const b = await ptile.boundingBox();
    await ptile.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: b.x + 20, clientY: b.y + 20, isPrimary: true });
    await phone.waitForTimeout(700);
    await ptile.dispatchEvent('pointerup', { pointerType: 'touch' });
    const sheet = phone.locator('.ask-pop.ask-sheet');
    await sheet.waitFor();
    assert.equal(await sheet.locator('h2').innerText(), 'Mailbox last opened');
    assert.ok(Math.abs((await sheet.boundingBox()).y + (await sheet.boundingBox()).height - 844) < 2, 'at the bottom');
    if (process.env.SHOTS) await phone.screenshot({ path: path.join(process.env.SHOTS, 'phone-ask.png') });
    await phone.locator('.ask-dim').click({ position: { x: 20, y: 20 } });
    await sheet.waitFor({ state: 'detached' });

    assert.deepEqual(errors, []);
    console.log('ok: tile change ask');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
