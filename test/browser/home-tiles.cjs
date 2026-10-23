// Optional browser check of choosing the Board tiles on home (#447): NODE_PATH=<directory containing playwright> node test/browser/home-tiles.cjs
// At 1440px the strip over the keys shows every tile until one is chosen; the pencil beside it shows on hover and
// opens the list of the Board's tiles: unchecking one takes it off at once, checking puts it last, dragging a grip
// reorders, and it is saved. On a phone (390px) a long press on the strip opens the same list as a sheet.
// SHOTS=<folder> keeps a picture of each. Scratch data and the stand-in Claude only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, waitFor } = require('../helpers');

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Home Helper' });
    const add = async (body) => (await srv.api('/dashboard/tiles', { method: 'POST', body: { bot: bot.id, ...body } })).data;
    const led = await add({ kind: 'value', title: 'Living room LED strip', value: 'on' });
    const bed = await add({ kind: 'value', title: 'Bedroom lights', value: 'off' });
    const mail = await add({ kind: 'value', title: 'Mailbox last opened', value: '13 hours ago' });
    const g = await add({ kind: 'group', title: 'Servers' });
    const cpu = await add({ kind: 'value', title: 'Proxmox CPU', parent: g.id, value: '12%' });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const shot = async (p, name) => { if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`) }); };
    await page.goto(srv.base);
    await page.waitForFunction(() => typeof setView === 'function' && state.bots?.length === 1 && state.dash);
    const titles = () => page.locator('#kp-board .kp-card .kit-label').allInnerTexts();
    assert.deepEqual(await titles(), ['Living room LED strip', 'Bedroom lights', 'Mailbox last opened', 'Servers'], 'automatic: every tile without a group');
    const pen = page.locator('#kp-board [data-home-edit]');
    assert.equal(await pen.evaluate((el) => getComputedStyle(el).opacity), '0', 'the pencil hides until hover');
    await page.locator('#kp-board').hover();
    await waitFor(async () => (await pen.evaluate((el) => getComputedStyle(el).opacity)) === '1', { what: 'the pencil on hover' });
    await pen.click();
    const pop = page.locator('.home-pop');
    await pop.waitFor();
    const row = (id) => pop.locator(`[data-home-row="${id}"]`);
    assert.equal(await row(cpu.id).getAttribute('aria-checked'), 'false', 'a tile inside a group is listed, off');

    await row(g.id).click();
    await waitFor(async () => (await titles()).join() === 'Living room LED strip,Bedroom lights,Mailbox last opened', { what: 'Servers off home' });
    await row(cpu.id).click();
    await waitFor(async () => (await titles()).at(-1) === 'Proxmox CPU', { what: 'Proxmox CPU last on home' });
    await waitFor(async () => (await srv.api('/dashboard')).data.home.join() === [led.id, bed.id, mail.id, cpu.id].join(), { what: 'saved' });

    // Drag Mailbox above Bedroom lights.
    await page.waitForTimeout(500); // the Board's own reload after the save
    const grip = row(mail.id).locator('[data-home-grip]');
    const gb = await grip.boundingBox(), bb = await row(bed.id).boundingBox();
    await page.mouse.move(gb.x + 8, gb.y + 8);
    await page.mouse.down();
    await page.mouse.move(gb.x + 8, bb.y + 4, { steps: 6 });
    await shot(page, 'wide-drag');
    await page.mouse.up();
    await waitFor(async () => (await srv.api('/dashboard')).data.home.join() === [led.id, mail.id, bed.id, cpu.id].join(), { what: 'the new order saved' });
    assert.deepEqual(await titles(), ['Living room LED strip', 'Mailbox last opened', 'Bedroom lights', 'Proxmox CPU']);
    await shot(page, 'wide-pick');
    await page.keyboard.press('Escape');
    await pop.waitFor({ state: 'detached' });

    // A phone: a long press on the strip opens the same list as a sheet.
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    phone.on('pageerror', (e) => errors.push(e.message));
    await phone.goto(srv.base);
    await phone.waitForFunction(() => typeof setView === 'function' && state.dash);
    const line = phone.locator('#kp-phone-board [data-board]');
    await line.waitFor();
    assert.equal(await phone.locator('#kp-phone-board [data-home-edit]').evaluate((el) => getComputedStyle(el).display), 'none', 'no pencil on touch');
    const b = await line.boundingBox();
    await line.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: b.x + 20, clientY: b.y + 20, isPrimary: true });
    await phone.waitForTimeout(700);
    await line.dispatchEvent('pointerup', { pointerType: 'touch' });
    const sheet = phone.locator('.home-pop.ask-sheet');
    await sheet.waitFor();
    assert.equal(await sheet.locator('[aria-checked="true"]').count(), 4);
    await shot(phone, 'phone-sheet');
    await phone.locator('.ask-dim').click({ position: { x: 20, y: 20 } });
    await sheet.waitFor({ state: 'detached' });

    assert.deepEqual(errors, []);
    console.log('ok: tiles on home');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
