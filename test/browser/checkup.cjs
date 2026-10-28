// Optional browser check of the checkup on the web page, at phone width:
//   NODE_PATH=<directory containing playwright> node test/browser/checkup.cjs
// In the Chief's settings: the "Checkup" switch with the server's line under it and "Web search" under that;
// a tap is stored; Web search is greyed out and can't be tapped while Checkup is off; a change made elsewhere
// shows without a reload; a refused tap goes back with a toast; against a server without `checkup` neither
// shows. Then a real checkup's message: its answer buttons and no 👍 and 👎. Scratch data and fake Claude only.
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
    const card = page.locator('#chief-checkup');
    await card.waitFor();
    const on = card.getByRole('checkbox', { name: 'Checkup' });
    const web = card.getByRole('checkbox', { name: 'Web search' });
    const rows = card.locator('.bs-row');
    const state = async () => [await on.isChecked(), await web.isChecked(), await web.isDisabled()];

    // As the server starts: on, weekdays at 08:00, no web search.
    assert.deepEqual(await state(), [true, false, false]);
    assert.deepEqual((await rows.nth(0).innerText()).split('\n').map((l) => l.trim()).filter(Boolean), ['Checkup', 'Weekdays at 08:00']);
    assert.deepEqual((await rows.nth(1).innerText()).split('\n').map((l) => l.trim()).filter(Boolean), ['Web search']);
    assert.equal(await rows.nth(1).getAttribute('title'), 'Lets a checkup search the web to check a proposal. It never opens a page.', 'what it does is its tooltip');
    assert.equal(await card.locator('input, select, button, textarea').count(), 2, 'no control for the days or the time');
    // In the panel between the Chief's rules and its previous chats, and inside the card's width.
    const order = await page.evaluate(() => ['[name=chiefRules]', '#chief-checkup .bs-row', '#chief-chats-row'].map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top)));
    assert.ok(order[0] < order[1] && order[1] < order[2], `rules, checkup, chats: ${order}`);
    const fits = await card.evaluate((el) => el.scrollWidth <= el.clientWidth);
    assert.ok(fits, 'nothing runs out of the card at phone width');
    await shot(page, 'checkup-settings');

    // A tap is stored; no "Saved" for the Chief's model and rules: the switches are not in that form.
    await web.locator('xpath=..').click();
    await waitFor(async () => (await stored()).webSearch === true, { what: 'Web search stored' });
    assert.deepEqual(await state(), [true, true, false]);
    await on.locator('xpath=..').click();
    await waitFor(async () => (await stored()).on === false, { what: 'Checkup off, stored' });
    await waitFor(async () => (await state()).join() === 'false,true,true', { what: 'Web search shown but not usable' });
    assert.equal(await page.locator('#toast').innerText(), '', 'nothing said for a change that went');
    // Greyed out, and a tap changes nothing.
    assert.equal(await web.locator('xpath=..').evaluate((el) => getComputedStyle(el).opacity), '0.45');
    await web.locator('xpath=..').click({ force: true });
    assert.equal((await stored()).webSearch, true);
    await shot(page, 'checkup-off');
    // The keyboard works too.
    await on.focus();
    await page.keyboard.press('Space');
    await waitFor(async () => (await stored()).on === true, { what: 'Checkup on from the keyboard' });
    await waitFor(async () => (await state()).join() === 'true,true,false', { what: 'Web search usable again' });

    // Changed elsewhere (another app, or the Chief in a chat): shows within a moment, without a reload.
    await srv.api('/settings/checkup', { method: 'PUT', body: { days: ['Monday', 'Thursday'], time: '07:30', webSearch: false } });
    await waitFor(async () => (await rows.nth(0).innerText()).includes('Mondays and Thursdays at 07:30'), { what: "the feed's line" });
    assert.deepEqual(await state(), [true, false, false]);

    // Refused: back as it was, with the server's sentence.
    await page.route('**/api/settings/checkup', (r) => (r.request().method() === 'PUT' ? r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"The checkup can\'t be changed right now."}' }) : r.continue()));
    await on.locator('xpath=..').click();
    await waitFor(async () => /can't be changed right now/.test(await page.locator('#toast').innerText()), { what: 'the toast' });
    assert.deepEqual(await state(), [true, false, false], 'the switch is back on');
    assert.equal((await stored()).on, true);
    await page.unroute('**/api/settings/checkup');

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

    // A server without checkup: neither switch.
    await page.route('**/api/version', async (r) => {
      const res = await r.fetch();
      const v = await res.json();
      await r.fulfill({ response: res, json: { ...v, features: v.features.filter((f) => f !== 'checkup') } });
    });
    await page.goto(`${srv.base}/#chiefsettings`);
    await page.reload();
    await page.locator('#chief-form').waitFor();
    await page.locator('#chief-chats .settings-link, #chief-chats *').first().waitFor({ state: 'attached' });
    assert.equal(await card.isVisible(), false, 'no switches against an older server');

    assert.deepEqual(errors, []);
    console.log('PASS: the Checkup and Web search switches in the Chief\'s settings at phone width: the server\'s line, a tap, the keyboard, greyed out while off, the feed, the refusal and the older server; a real checkup\'s message with its buttons and no thumbs.');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
