// Optional browser check of the button to the newest message (#1120): node test/browser/to-latest.cjs
// A bot's chat is read back up when its reply comes: the chat stays where it was, and one round button with the bot's
// head stands above the message box. A tap goes to the end and the button goes; at the end, the next reply shows no
// button. Scratch data and fake Claude only. The rule itself is tested in test/to-latest-web.test.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, seedRuns, sleep } = require('../helpers');

(async () => {
  let srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Quotz' });
    await srv.stop();
    seedRuns(srv, bot, [{ prompt: 'q', result: 'Some text here. '.repeat(40), times: 8 }]);
    srv = await startServer({ dir: srv.dir });
    fs.writeFileSync(path.join(srv.dir, 'fake', 'result.txt'), 'The servers are fine.');
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const gap = () => page.locator('#bot-thread').evaluate((t) => Math.round(t.scrollHeight - t.scrollTop - t.clientHeight));
    const button = page.locator('#view-bot .to-latest');
    const reply = async () => {
      srv.hold();
      await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Check the servers' } });
      const rec = await srv.nextRun(() => true, 'a run');
      srv.unhold();
      srv.release(rec);
    };

    await page.goto(`${srv.base}/#bot/${bot.id}`);
    await page.locator('#bot-thread .bubble').first().waitFor();
    await sleep(1500);
    await page.locator('#bot-thread').evaluate((t) => { t.scrollTop = t.scrollHeight; });
    await sleep(300);
    assert.equal(await button.isVisible(), false, 'at the end: no button');

    // Read back up; the reply comes below.
    await page.locator('#bot-thread').evaluate((t) => { t.scrollTop = 0; });
    await sleep(300);
    await reply();
    await page.waitForFunction(() => [...document.querySelectorAll('#bot-thread .bubble')].some((b) => b.textContent.includes('The servers are fine.')), null, { timeout: 15000 });
    await button.waitFor({ state: 'visible', timeout: 5000 });
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
    assert.ok(await gap() > 300, 'the chat stays where it was read');
    assert.equal(await page.locator('#view-bot .to-latest .to-latest-head .avatar').count(), 1, "the bot's head");
    assert.equal((await button.innerText()).trim(), '', 'no words');

    // A tap: the end, and no button.
    await button.click();
    await page.waitForFunction(() => { const t = document.querySelector('#bot-thread'); return t.scrollHeight - t.scrollTop - t.clientHeight < 2; }, null, { timeout: 5000 });
    await sleep(300);
    assert.equal(await button.isVisible(), false, 'gone at the end');

    // At the end, the next reply: it shows, with no button.
    await reply();
    await page.waitForFunction(() => [...document.querySelectorAll('#bot-thread .bubble')].filter((b) => b.textContent.includes('The servers are fine.')).length >= 2, null, { timeout: 15000 });
    await sleep(500);
    assert.equal(await button.isVisible(), false, 'no button at the end');
    assert.ok(await gap() < 200, `the reply shows (${await gap()})`);
    assert.deepEqual(errors, []);
    console.log('to-latest: ok');
  } finally {
    await browser?.close();
    srv.unhold?.();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
