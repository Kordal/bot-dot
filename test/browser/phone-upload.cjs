// Optional browser check of Upload from phone (ADR 165): node test/browser/phone-upload.cjs [shots dir]
// The paperclip offers Files and From phone; From phone puts the QR code over the message box, and a file the phone
// sends shows under it and in the message box, ready to send; × closes it. Files offers From phone beside Upload, in a
// corner, and the folder shows the file. The phone's page sends a file with its progress. The address is a name
// (botdot.test) mapped to this machine, as a phone reaches a public one. Scratch data only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot } = require('../helpers');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'News Monitor', color: '#8b7cf6' });
    fs.mkdirSync(path.join(srv.data, 'workspaces', bot.id, 'scans'), { recursive: true });
    browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP botdot.test 127.0.0.1'], ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const base = `http://botdot.test:${srv.port}`;
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}/#bot/${bot.id}`);
    const form = page.locator('form.composer:has(textarea[data-placeholder="Message News Monitor"])');
    await form.locator('.attach-btn').waitFor();
    await form.locator('.attach-btn').click();
    const menu = page.locator('.pd-menu');
    assert.deepEqual(await menu.locator('.fx-mi').allInnerTexts(), ['Files', 'From phone']);
    if (shots) await page.screenshot({ path: path.join(shots, 'menu.png') });
    await menu.locator('.fx-mi', { hasText: 'From phone' }).click();
    const card = form.locator('.pd-card');
    await card.locator('.pd-qr svg').waitFor();
    const url = await card.locator('.pd-qr').getAttribute('title');
    assert.match(url, new RegExp(`^${base}/drop/${srv.account}/[\\w-]{32}$`));

    // The phone: its page, and a file sent from it.
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true })).newPage();
    phone.on('pageerror', (e) => errors.push(e.message));
    await phone.goto(url);
    assert.equal(await phone.locator('h1').innerText(), 'News Monitor');
    if (shots) await phone.screenshot({ path: path.join(shots, 'phone.png') });
    await phone.locator('#files').setInputFiles({ name: 'IMG_4812.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('a photo') });
    await phone.locator('li .ok').waitFor();
    assert.equal(await phone.locator('#pick').innerText(), 'Send more');
    if (shots) await phone.screenshot({ path: path.join(shots, 'phone-sent.png') });

    await card.locator('.pd-row .pd-ok').waitFor();
    await form.locator('.attach-list .file-chip', { hasText: 'IMG_4812.jpg' }).waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, 'chat.png') });
    await card.locator('[data-pd-close]').click();
    assert.equal(await form.locator('.pd-card').count(), 0);
    await phone.reload();
    assert.match(await phone.locator('h1').innerText(), /expired/, 'closed: the code is spent');

    // Files: into the folder shown.
    await page.locator('#bot-files').click();
    await page.locator('#files .fx-row[data-path="scans"]').dblclick();
    await page.locator('#files [data-fx="from-phone"]').click();
    const corner = page.locator('.pd-card.pd-float');
    await corner.locator('.pd-qr svg').waitFor();
    const url2 = await corner.locator('.pd-qr').getAttribute('title');
    const r = await fetch(`${url2.replace(base, srv.base)}/files`, { method: 'POST', headers: { 'X-Bot-Dot': '1', 'X-File-Name': 'receipt.pdf' }, body: '%PDF' });
    assert.equal(r.status, 201);
    await page.locator('#files .fx-row[data-path="scans/receipt.pdf"]').waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, 'files.png') });
    assert.deepEqual(errors, []);
    console.log('ok: upload from phone');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
