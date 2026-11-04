// Optional browser check of the web page on an iPhone (public/ios.js, #963): node test/browser/ios-keyboard.cjs
// With the keyboard open (the visual viewport 500 px of 844), a bot's chat keeps its header and its field on screen,
// and the keyboard's closing gives the page back. From the Home Screen, "Open as document" opens over the page, signed
// in, and Close brings back the chat. In WebKit where Playwright has it (BROWSER=webkit), else Chromium; the keyboard
// is a stand-in visual viewport, as no headless browser has one. Scratch data only.
const assert = require('node:assert/strict');
const playwright = require('playwright');
const { startServer, makeBot } = require('../helpers');

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const b = await makeBot(srv, { name: 'Demo' });
    for (let i = 0; i < 3; i++) await srv.finished((await srv.api(`/bots/${b.id}/run`, { method: 'POST', body: { prompt: `Step ${i}` } })).data.id);
    const engine = playwright[process.env.BROWSER || 'chromium'];
    browser = await engine.launch({ headless: true, ...(process.env.CHROME_PATH && engine === playwright.chromium ? { executablePath: process.env.CHROME_PATH } : {}) });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: IPHONE, hasTouch: true, isMobile: engine === playwright.chromium });
    // The keyboard: a visual viewport the test sizes, before the page's scripts read it.
    await context.addInitScript(() => {
      const vv = new EventTarget();
      Object.assign(vv, { height: innerHeight, width: innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1 });
      Object.defineProperty(window, 'visualViewport', { get: () => vv });
      Object.defineProperty(navigator, 'standalone', { get: () => true });
      window.keyboard = (height) => { vv.height = height ?? innerHeight; vv.dispatchEvent(new Event('resize')); };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#bot/${b.id}`);
    await page.locator('#view-bot .composer textarea').waitFor();
    const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const box = (sel) => page.locator(sel).evaluate((el) => el.getBoundingClientRect().toJSON());

    await page.locator('#view-bot .composer textarea').focus();
    await page.evaluate(() => window.keyboard(500));
    await frame();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('kb')), true);
    const head = await box('#view-bot .chat-head'), composer = await box('#view-bot .composer');
    assert.ok(head.top >= 0 && head.bottom <= 500, `the header is on screen (${head.top}-${head.bottom})`);
    assert.ok(composer.top >= head.bottom && composer.bottom <= 500, `the field is above the keyboard (${composer.top}-${composer.bottom})`);
    assert.ok(500 - composer.bottom <= 24, `and at its edge (${composer.bottom})`);

    await page.evaluate(() => window.keyboard());
    await frame();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('kb')), false);
    assert.ok((await box('#view-bot .composer')).bottom > 500, 'the page has its full height again');

    // A new window of this botdot, from the Home Screen: a sheet over the chat, with the page's own cookies.
    await page.evaluate(() => {
      const a = Object.assign(document.createElement('a'), { href: '/doc?x=1', target: '_blank', textContent: 'Open as document' });
      document.querySelector('#view-bot .chat-head').append(a);
      a.click();
    });
    await page.locator('dialog.page-sheet iframe').waitFor();
    assert.equal(await page.locator('dialog.page-sheet iframe').getAttribute('src'), `${srv.base}/doc?x=1`);
    assert.equal(page.url(), `${srv.base}/#bot/${b.id}`, 'the chat stays under it');
    await page.locator('dialog.page-sheet [aria-label="Close"]').click();
    await page.locator('dialog.page-sheet').waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
    console.log(`ios-keyboard: ok (${engine.name()})`);
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
