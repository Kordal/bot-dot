// Optional browser check of the checkup on the web page, at phone width:
//   NODE_PATH=<directory containing playwright> node test/browser/checkup.cjs
// The Chief's settings have no switch for the checkup or its web search (it always runs and always may search),
// and an older app's switch is refused with the reason. Then a real checkup's message: its answer buttons and no
// 👍 and 👎. Scratch data and fake Claude only.
//   CHECKUP_SHOTS=<folder>  save the settings and the message there
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, seedRuns, waitFor } = require('../helpers');

const SHOTS = process.env.CHECKUP_SHOTS;
const ENV = { BOT_DOT_LOOK_ON_DEMAND: '1' };

(async () => {
  let srv = await startServer({ env: ENV });
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    await srv.api('/settings/quiet-hours', { method: 'PUT', body: { start: 0, end: 0 } }); // a checkup at any hour
    const surfer = await makeBot(srv, { name: 'Web Surfer', description: 'Looks things up on the web' });
    // What the checkup reads: written as botdot keeps runs, found when it starts again.
    await srv.stop();
    seedRuns(srv, surfer, [
      { prompt: 'What changed in the Grok subscription?', result: 'Should I log in with the saved X login?' },
      { prompt: 'Yes, use the X account', result: 'Done: the price went up.' },
    ]);
    srv = await startServer({ dir: srv.dir, env: ENV });
    const stored = async () => (await srv.api('/settings/checkup')).data.checkup;
    const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); } };

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#chiefsettings`);
    // The Chief's settings have no switch for the checkup or its web search: it always runs and always may search.
    await page.locator('#chief-form').waitFor();
    await page.locator('#chief-chats-row').waitFor();
    assert.equal(await page.locator('#chief-checkup').count(), 0, 'no card for the checkup');
    assert.equal(await page.getByRole('checkbox', { name: 'Checkup' }).count() + await page.getByRole('checkbox', { name: 'Web search' }).count(), 0, 'no switch for either');
    assert.doesNotMatch(await page.locator('#view-chiefsettings').innerText(), /Weekdays at 08:00|Web search/);
    const fits = await page.locator('#chief-form').evaluate((el) => el.scrollWidth <= el.clientWidth);
    assert.ok(fits, 'nothing runs out of the form at phone width');
    await shot(page, 'checkup-settings');
    // The days and the time are the Chief's to change: the setting is as the server has it, always on and with web search.
    let now = await stored();
    assert.deepEqual([now.on, now.webSearch, now.when], [true, true, 'Weekdays at 08:00']);
    // An older app's switch is refused with the reason and changes nothing.
    const refused = await srv.api('/settings/checkup', { method: 'PUT', body: { on: false } });
    assert.equal(refused.status, 400);
    assert.match(refused.data.error, /always runs and always may search the web/);
    now = await stored();
    assert.deepEqual([now.on, now.webSearch], [true, true]);

    // A real checkup: its message opens a new chat, with its answer buttons and no thumbs.
    srv.reply(JSON.stringify({ proposals: [{ kind: 'rule', bot: 'Web Surfer', change: 'Use the saved X login straight away for read-only lookups.', day: new Date().toISOString().slice(0, 10), evidence: 'you answered "Yes, use the X account"' }] }));
    const ran = (await srv.api('/chief/checkup/now', { method: 'POST' })).data;
    assert.deepEqual([ran.ran, ran.posted], [true, true]);
    await page.goto(`${srv.base}/#chief/${ran.chatId}`);
    await page.reload(); // the page reads its address when it loads
    const message = page.locator('#chat-thread [data-msg="0"]');
    await message.locator('.choices').waitFor();
    assert.deepEqual(await message.locator('.choices button').allInnerTexts(), ['Do it', 'Not now']);
    assert.equal(await page.locator('#chat-thread .rate').count(), 0, 'a checkup is not rated');
    assert.match(await message.locator('.bubble').innerText(), /Rule, Web Surfer: Use the saved X login straight away/);
    await shot(page, 'checkup-message');
    // An answer is sent as the owner's message, and the buttons go.
    srv.reply('Done: Web Surfer has the rule.');
    await message.getByRole('button', { name: 'Not now' }).click();
    await waitFor(async () => (await srv.api(`/chief/chats/${ran.chatId}`)).data.messages[1]?.text === 'Not now', { what: 'the answer sent' });
    await waitFor(async () => (await message.locator('.choices').count()) === 0, { what: 'the buttons gone' });

    assert.deepEqual(errors, []);
    console.log('PASS: the Chief\'s settings at phone width have no checkup or web search switch, and an older app\'s switch is refused with the reason; a real checkup\'s message has its answer buttons and no thumbs.');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
