// Optional browser check that a bot's chat keeps its end when the window comes back: node test/browser/chat-stays-at-end.cjs
// The chat is open at its end while another window is in front (the desktop app beside another app). A long reply with
// answer buttons comes: the chat stays at its end. The window comes back (the click that brings it back is often on an
// answer): the "New" line is drawn above the reply, and the chat stays at its end, where it was, not up at the line.
// The next reply follows into view. A chat opened with new replies still opens at its line. Scratch data and fake Claude only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, seedRuns, sleep } = require('../helpers');

const LONG = '```\n' + 'line\n'.repeat(80) + '```\n\nWhich one?\n\n[[choices: First | Second]]';

(async () => {
  let srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Quotz' });
    await srv.stop();
    seedRuns(srv, bot, [{ prompt: 'q', result: 'Some text here. '.repeat(40), times: 8 }]);
    srv = await startServer({ dir: srv.dir });
    fs.writeFileSync(path.join(srv.dir, 'fake', 'result.txt'), LONG);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // Which window is in front, set by the check: headless Chromium is always in front.
    await page.addInitScript(() => { window.front = true; document.hasFocus = () => window.front; });
    const front = (on) => page.evaluate((v) => { window.front = v; dispatchEvent(new Event(v ? 'focus' : 'blur')); }, on);
    const gap = () => page.locator('#bot-thread').evaluate((t) => Math.round(t.scrollHeight - t.scrollTop - t.clientHeight));
    const line = () => page.locator('#bot-thread .new-line').count();
    const reply = async () => {
      srv.hold();
      await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Check the servers' } });
      const rec = await srv.nextRun(() => true, 'a run');
      srv.unhold();
      srv.release(rec);
    };

    // Opened with new replies: at its line.
    await page.goto(`${srv.base}/#bot/${bot.id}`);
    await page.locator('#bot-thread .new-line').waitFor();
    await page.waitForFunction(() => { const t = document.querySelector('#bot-thread'); return t.scrollHeight - t.scrollTop - t.clientHeight > 300; });
    await sleep(1500); // read
    await page.reload();
    await page.locator('#bot-thread .bubble').first().waitFor();
    await sleep(1000);
    assert.equal(await line(), 0, 'read: no line');
    assert.ok(await gap() < 2, 'at its end');

    // Another window in front; a long reply with answers comes, the chat in sight.
    await front(false);
    await reply();
    await page.locator('#bot-thread .choices [data-choice]').first().waitFor();
    await sleep(500);
    assert.ok(await gap() < 2, `it follows the reply (${await gap()})`);

    // The window comes back: the line, and the chat where it was.
    await front(true);
    await page.locator('#bot-thread .new-line').waitFor();
    await sleep(500);
    assert.ok(await gap() < 2, `the chat keeps its end (${await gap()})`);

    // The answer tapped, and the next reply follows into view.
    await page.locator('#bot-thread .choices [data-choice]').first().click();
    await page.waitForFunction(() => document.querySelectorAll('#bot-thread .choices [data-choice]').length === 2 && [...document.querySelectorAll('#bot-thread .bubble.from-me')].some((b) => b.textContent.includes('First')), null, { timeout: 15000 });
    await sleep(500);
    assert.ok(await gap() < 2, `the next reply shows (${await gap()})`);
    assert.deepEqual(errors, []);
    console.log('chat-stays-at-end: ok');
  } finally {
    await browser?.close();
    srv.unhold?.();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
