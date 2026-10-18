// Optional browser check that a bot's computer fits the window (#43):
//   NODE_PATH=<directory containing playwright> node test/browser/computer-fit.cjs
// The computer dialog, with its computer off and on, in a large, a laptop's, a short and a phone's window and
// after the window is resized, and with the note of a newer desktop under it: the whole dialog is in the window with no scrollbar of its own, and the screen
// keeps the desktop's 4:3 and is as large as the window lets it be. The live screen is a stand-in page.
// Scratch data only.
//   FIT_SHOTS=<folder>  save a screenshot of each
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, waitFor } = require('../helpers');

const SHOTS = process.env.FIT_SHOTS;
const WINDOWS = [{ width: 2000, height: 1255 }, { width: 1333, height: 837 }, { width: 1280, height: 640 }, { width: 1024, height: 560 }, { width: 390, height: 844 }];

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'VPS Agent', computer: 'linux' });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const errors = [];
    // With the computer on, it also says a newer desktop is available: one more line under the screen.
    let outdated = false;
    const context = await browser.newContext({ viewport: WINDOWS[0], colorScheme: 'dark' });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/computer/**', (r) => r.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#235;color:#fff">desktop</body>' }));
    await page.route(`**/api/bots/${bot.id}/computer`, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ state: 'running', outdated }) }));
    await page.goto(srv.base);
    await page.waitForFunction((id) => state.bots?.some((b) => b.id === id), bot.id);
    // What is drawn: the dialog's box and whether it scrolls, and the screen's box.
    const measure = () => page.evaluate(() => {
      const m = document.querySelector('#modal');
      const d = m.getBoundingClientRect(), s = document.querySelector('#screen-frame').getBoundingClientRect();
      return { top: d.top, bottom: d.bottom, left: d.left, right: d.right, scrolls: m.scrollHeight > m.clientHeight + 1, w: s.width, h: s.height, winW: innerWidth, winH: innerHeight };
    });
    const check = async (what) => {
      // As large as it can be: across the dialog (less its padding and border, 50) or the dialog as tall as the
      // window lets it be (its less 40), in a dialog as wide as a wide dialog gets (1080, or the window's width
      // less the browser's own margin of 6px and 2em).
      const large = (r) => (r.w >= r.right - r.left - 50 - 1 || r.bottom - r.top >= r.winH - 42) && r.right - r.left >= Math.min(1080, r.winW - 34) - 1;
      let r;
      // Asked again while a resize is still being answered.
      await waitFor(async () => { r = await measure(); return r.bottom <= r.winH && !r.scrolls && large(r); }, { what: `${what} to fit` }).catch(() => {});
      assert.ok(r.top >= 0 && r.bottom <= r.winH, `${what}: the dialog is in the window from top to bottom: ${JSON.stringify(r)}`);
      assert.ok(r.left >= 0 && r.right <= r.winW, `${what}: the dialog is in the window from side to side: ${JSON.stringify(r)}`);
      assert.ok(!r.scrolls, `${what}: the dialog has no scrollbar of its own: ${JSON.stringify(r)}`);
      assert.ok(Math.abs(r.w / r.h - 4 / 3) < 0.01, `${what}: the screen keeps 4:3: ${JSON.stringify(r)}`);
      assert.ok(large(r), `${what}: the screen is as large as the window lets it be: ${JSON.stringify(r)}`);
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${what.replace(/\W+/g, '-')}.png`) }); }
    };
    for (const on of [false, true]) {
      for (const win of WINDOWS) {
        const at = `${on ? 'on' : 'off'} ${win.width}x${win.height}`;
        outdated = on;
        await page.setViewportSize(win);
        await page.evaluate(([id, running]) => { state.computers = { ...state.computers, [id]: running ? 'running' : 'stopped' }; openScreen(id); }, [bot.id, on]);
        await check(at);
        // Resized while it is open: it fits the new window, and grows back with it.
        await page.setViewportSize({ width: Math.round(win.width * 0.8), height: Math.round(win.height * 0.8) });
        await check(`${at} made smaller`);
        await page.setViewportSize(win);
        await check(`${at} made larger again`);
        // Its close event comes a moment later: the next dialog opens after it, as one a person opens would.
        await page.evaluate(() => new Promise((done) => { const m = document.querySelector('#modal'); m.addEventListener('close', done, { once: true }); m.close(); }));
      }
    }
    await context.close();
    assert.deepEqual(errors, []);
    console.log(`PASS: the computer dialog fits ${WINDOWS.length} windows and their resizes, off and on, with the screen at 4:3; no browser errors.`);
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
