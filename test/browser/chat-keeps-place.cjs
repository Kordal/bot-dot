// Optional browser check that a bot's chat keeps its place when something in it opens or closes: node test/browser/chat-keeps-place.cjs
// A chat at its end opens a run's steps: a short list opens and the chat stays at its end; a long one grows upwards no
// further than its line, which stays in sight. Closed again, the chat is at its end. A chat scrolled up keeps the
// opened line where it was. The message box growing with what is typed keeps the chat at its end. The Mac app's
// WebKit has no scroll anchoring of its own. Scratch data and fake Claude only. CHROME_PATH picks the browser.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer, makeBot, seedRuns, sleep } = require('../helpers');

const at = (m) => new Date(Date.UTC(2026, 10, 6, 7, m)).toISOString();
const steps = (n) => ({ count: n, rows: Array.from({ length: n }, (_, i) => ({ at: at(i), text: `Running a command ${i}` })) });

(async () => {
  let srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Quotz' });
    await srv.stop();
    seedRuns(srv, bot, [{ result: 'Some text here. '.repeat(40), steps: steps(12), times: 6 }, { result: 'Done.', steps: steps(2) }]);
    srv = await startServer({ dir: srv.dir });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const thread = page.locator('#bot-thread');
    const gap = () => thread.evaluate((t) => Math.round(t.scrollHeight - t.scrollTop - t.clientHeight));
    const line = (i) => thread.locator('details.run-steps summary').nth(i);
    const top = async (i) => Math.round((await line(i).boundingBox()).y - (await thread.boundingBox()).y);
    const toEnd = () => thread.evaluate((t) => { t.scrollTop = t.scrollHeight; });

    await page.goto(`${srv.base}/#bot/${bot.id}`);
    await thread.locator('.run-block').nth(6).waitFor();
    await sleep(1500); // read
    await page.reload();
    await thread.locator('.run-block').nth(6).waitFor();
    await sleep(500);
    await toEnd();
    await sleep(200);

    // At its end, a short list of steps opens: the chat stays at its end.
    await line(6).click();
    await sleep(300);
    assert.ok(await gap() < 2, `a short list keeps the end (${await gap()})`);
    await line(6).click();
    await sleep(300);
    assert.ok(await gap() < 2, `closed: at its end (${await gap()})`);

    // At its end, a long list opens: it grows upwards, its line stays in sight at the top.
    await toEnd();
    await sleep(200);
    const before = await top(5);
    await line(5).click();
    await sleep(300);
    const after = await top(5);
    assert.ok(after < before && after >= 0 && after < 40, `the line goes up and stays in sight (${before} -> ${after})`);
    await line(5).click();
    await sleep(300);
    assert.ok(await gap() < 2, `closed: at its end (${await gap()})`);

    // Scrolled up: the opened line stays where it was.
    await line(2).scrollIntoViewIfNeeded();
    await thread.evaluate((t) => { t.scrollTop -= 200; });
    await sleep(200);
    const up = await top(2);
    await line(2).click();
    await sleep(300);
    assert.equal(await top(2), up, 'scrolled up: the line stays');
    await line(2).click();
    await sleep(300);

    // The message box grows with what is typed: the chat stays at its end.
    await toEnd();
    await sleep(200);
    await page.locator('#view-bot form textarea').fill('one\ntwo\nthree\nfour\nfive\nsix');
    await sleep(300);
    assert.ok(await gap() < 2, `the box grows, the chat keeps its end (${await gap()})`);
    assert.deepEqual(errors, []);
    console.log('chat-keeps-place: ok');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
