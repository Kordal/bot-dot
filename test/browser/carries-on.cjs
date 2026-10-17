// Optional browser check of who carries on after an OK (OK-004), at phone width and at desktop width:
//   NODE_PATH=<directory containing playwright> node test/browser/carries-on.cjs
// It runs in no gate: the repository does not carry Playwright. The acceptance task runs it by hand.
// A change to a bot that the Chief asked for stands at the end of the Chief's chat under its bot's head, with the
// server's title, what changes, and the line that says who carries on: "in this chat" in the chat that asked,
// the chat's name on the Needs you page. Approved there, it leaves a faded line that says so, and the card is
// gone from the other places. A connected-app action shows its rows and that the bot waits for the answer, and
// nothing reaches past the card. A closed card of five rows shows three of them and hides the others whole, and
// an action too long to show in full says so and has no "Allow once" (OK-008). A run that waits for the owner
// shows "Waiting for your OK" with a still dot,
// no dots after the words and Stop; when the wait ends the line is the run's own again. A run that carries on
// shows no second message of the owner.
// The asks and the runs are stood in for on the page's own requests (/api/asks, /api/runs), so the walk needs
// neither a connected app nor a waiting run: the server's side is test/ask-carries-on*.test.js and the tests of
// OK-002 and OK-003. Scratch data and fake Claude only.
//   CARRIES_ON_SHOTS=<folder>  also save screenshots there
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, waitFor } = require('../helpers');

const SHOTS = process.env.CARRIES_ON_SHOTS;
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const news = await makeBot(srv, { name: 'News Watcher', color: '#e0703a', description: 'Reads the tech news', allowedTools: ['Read'] });
    const mail = await makeBot(srv, { name: 'Mail Writer', color: '#9b59d0', description: 'Writes your email' });
    const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
    const other = (await srv.api('/chief/chats', { method: 'POST' })).data;
    const botOf = (b) => ({ id: b.id, name: b.name, color: b.color });
    const HERE = 'The Chief carries on in this chat when you allow it.';
    const NAMED = 'The Chief carries on in “Morning tech news” when you allow it.';
    // As "The contract" of OK-002 and OK-003 words them.
    const CHANGE = { id: 'change1', kind: 'bot-change', botId: news.id, bot: botOf(news), by: 'chief', chatId: chat.id, at: new Date().toISOString(),
      title: 'Change News Watcher: web access, new main assignment?', reason: 'The Chief set it up for you',
      parts: [{ label: 'Web access', now: 'allowed' }, { label: 'Main assignment', was: 'Read the tech news every morning.', now: 'Read the tech news every morning and send the three best stories. <b>Never</b> post or comment anywhere.' }],
      details: 'Tools\nNow: Read\nProposed: Read, WebSearch, WebFetch', then: { who: 'chief', chatId: chat.id, text: NAMED, here: HERE } };
    const EMAIL = { id: 'mail1', kind: 'connector-action', botId: mail.id, bot: botOf(mail), at: new Date().toISOString(), title: 'Send email with Gmail?', held: true,
      rows: [{ label: 'To', value: 'anna.kowalska.with-a-very-long-address-that-must-wrap@mail.example.com' }, { label: 'Subject', value: 'Running 20 minutes late' }, { label: 'Text', value: 'Hi Anna, I\'ll be about 20 minutes late for our 14:00 call. Sorry for the short notice. Bart' }],
      details: 'Allow once applies only while this run is active.\n\n{ "recipient_email": "anna.kowalska@example.com" }' };

    // What waits and which runs the page is told of; what was answered.
    let waiting = [CHANGE, EMAIL];
    let runs = [];
    const answers = [];

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });
    await context.route((url) => url.pathname === '/api/asks', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: waiting }) : r.fallback()));
    await context.route((url) => url.pathname.startsWith('/api/asks/'), (r) => {
      const id = decodeURIComponent(new URL(r.request().url()).pathname.split('/').pop());
      const body = r.request().postDataJSON();
      answers.push({ id, body });
      waiting = waiting.filter((a) => a.id !== id);
      return r.fulfill({ json: body.yes === true ? { ok: true, carriesOn: { who: 'chief', text: 'the Chief carries on' } } : { ok: true, declined: true } });
    });
    await context.route((url) => url.pathname === '/api/runs', (r) => r.fulfill({ json: runs }));
    await context.route((url) => /^\/api\/runs\/[^/]+\/stream$/.test(url.pathname), (r) => r.fulfill({ status: 204 })); // a stood-in run has no stream
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); } };
    // A chat, with what waits drawn in it: the asks arrive just after the first refresh, so the page refreshes once more.
    const open = async (hash, thread) => {
      await page.goto(`${srv.base}/#${hash}`);
      await page.reload();
      await page.locator(thread).waitFor({ state: 'attached' });
      await page.evaluate(() => refresh());
      await page.evaluate(() => refresh());
    };
    // Nothing of the card reaches past its edge, nothing in it scrolls sideways, and neither does the page.
    const fits = async (card, where) => {
      const s = await card.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const blocks = [el, ...el.querySelectorAll('.need-who, .need-title, .need-meta, .need-body, .nb, dt, dd, .need-actions')];
        return {
          past: blocks.filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.right > box.right + 0.5 || r.left < box.left - 0.5); }).map((b) => b.className || b.tagName),
          scrolling: blocks.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.className || b.tagName),
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth, card: [Math.round(box.left), Math.round(box.right)], viewport: window.innerWidth,
        };
      });
      assert.deepEqual(s.past, [], `${where}: nothing reaches past the card: ${JSON.stringify(s)}`);
      assert.deepEqual(s.scrolling, [], `${where}: nothing scrolls sideways in the card`);
      assert.ok(s.page <= 0 && s.card[0] >= 0 && s.card[1] <= s.viewport, `${where}: the card is inside the window: ${JSON.stringify(s)}`);
    };

    // The Chief's chat that asked: the card is the last thing in it, under the head of the bot it changes.
    await open(`chief/${chat.id}`, '#chat-thread');
    const inChief = page.locator('#chat-thread .chat-needs .need-card[data-need="ask:change1"]');
    await inChief.waitFor();
    assert.equal(await page.locator('#chat-thread > :last-child').getAttribute('class'), 'chat-needs', 'the cards end the chat');
    assert.match(await inChief.locator('.need-who').innerText(), /News Watcher/);
    assert.equal(await inChief.locator('.need-who').isVisible(), true);
    assert.equal(await inChief.locator('.need-title').innerText(), 'Change News Watcher: web access, new main assignment?');
    assert.equal(await inChief.locator('.need-then').innerText(), HERE, 'in the chat that asked: "in this chat"');
    assert.deepEqual(await inChief.locator('.need-actions button').allInnerTexts(), ['Decline', 'Approve']);
    assert.equal(await page.locator('#chat-thread .chat-needs .need-card[data-need="ask:mail1"]').count(), 0, 'a bot\'s own ask is not the Chief\'s');
    // Who carries on is whole on the closed card, in the text's colour, not the muted one of the lines under a title.
    const colours = await inChief.evaluate((el) => ({ then: getComputedStyle(el.querySelector('.need-then')).color, meta: getComputedStyle(el.querySelector('.need-meta:not(.need-then)')).color, text: getComputedStyle(document.body).color, wraps: getComputedStyle(el.querySelector('.need-then')).whiteSpace }));
    assert.equal(colours.then, colours.text);
    assert.notEqual(colours.then, colours.meta);
    assert.equal(colours.wraps, 'normal');
    await fits(inChief, 'the Chief\'s chat, closed, at phone width');
    await shot('carries-on-chief-phone-closed');
    // Opened: the row of what is allowed, then the old text struck above the new, and markup in a text is text.
    await inChief.locator('.need-title').click();
    assert.deepEqual(await inChief.locator('.need-facts dt').allInnerTexts(), ['Web access']);
    assert.deepEqual(await inChief.locator('.need-facts dd').allInnerTexts(), ['allowed']);
    assert.equal(await inChief.locator('.need-body').count(), 2, 'the row, and one block for the changed text');
    const texts = await inChief.evaluate((el) => [...el.querySelectorAll('.need-change .nb')].map((b) => ({ text: b.innerText.trim(), struck: getComputedStyle(b).textDecorationLine.includes('line-through'), top: b.getBoundingClientRect().top })));
    assert.deepEqual(texts.map((t) => t.struck), [true, false], 'the old text struck, the new text');
    assert.equal(texts[0].text, 'Read the tech news every morning.');
    assert.match(texts[1].text, /<b>Never<\/b> post or comment anywhere\.$/);
    assert.ok(texts[0].top < texts[1].top, 'the old text above the new');
    assert.equal(await inChief.locator('.need-body b').count(), 0);
    assert.equal(await inChief.locator('.need-part').count(), 0, 'one changed text: the title names it');
    await fits(inChief, 'the Chief\'s chat, open, at phone width');
    await shot('carries-on-chief-phone-open');
    await page.setViewportSize(DESKTOP);
    await fits(inChief, 'the Chief\'s chat, open, at desktop width');
    assert.ok((await inChief.evaluate((el) => el.getBoundingClientRect().width)) <= 560.5, 'a card in a chat is 560 px wide at most');
    await shot('carries-on-chief-desktop');
    await page.setViewportSize(PHONE);

    // Another of the Chief's chats shows the same card, and names the chat that carries on.
    await open(`chief/${other.id}`, '#chat-thread');
    await page.locator('#chat-thread .need-card[data-need="ask:change1"] .need-then').waitFor();
    assert.equal(await page.locator('#chat-thread .need-card[data-need="ask:change1"] .need-then').innerText(), NAMED);
    // So does the chat of the bot it changes, without the head. Its first block there is the row, and the changed
    // text waits behind the click.
    await open(`bot/${news.id}`, '#bot-thread');
    const inBot = page.locator('#bot-thread .chat-needs .need-card[data-need="ask:change1"]');
    await inBot.waitFor();
    assert.equal(await inBot.locator('.need-then').innerText(), NAMED);
    assert.equal(await inBot.locator('.need-who').isVisible(), false);
    assert.equal(await inBot.locator('.need-facts').isVisible(), true);
    assert.equal(await inBot.locator('.need-change').isVisible(), false);
    // And the Needs you page, among everything that waits.
    await page.locator('#needs-open').click();
    const onPage = page.locator('#view-needs .need-card[data-need="ask:change1"]');
    await onPage.waitFor();
    assert.equal(await page.locator('#view-needs .need-card').count(), 2, 'both things that wait');
    assert.equal(await onPage.locator('.need-then').innerText(), NAMED);
    assert.match(await onPage.locator('.need-who').innerText(), /News Watcher/);
    await fits(onPage, 'Needs you, closed, at phone width');
    await shot('carries-on-needs-phone');
    await page.setViewportSize(DESKTOP);
    await fits(onPage, 'Needs you, closed, at desktop width');
    await shot('carries-on-needs-desktop');
    await page.setViewportSize(PHONE);
    // A card whose first block is a changed text shows, closed, the start of the old text and of the new.
    waiting = [{ ...CHANGE, parts: [CHANGE.parts[1]] }];
    await open(`chief/${chat.id}`, '#chat-thread');
    await inChief.waitFor();
    assert.doesNotMatch(await inChief.getAttribute('class'), /\bopen\b/);
    assert.deepEqual(await inChief.evaluate((el) => [...el.querySelectorAll('.need-change .nb')].map((b) => b.getClientRects().length > 0)), [true, true], 'closed: what goes and what comes both show');
    await shot('carries-on-change-closed-phone');
    waiting = [CHANGE, EMAIL];

    // A connected-app action in its bot's chat: the rows, that the bot waits, and nothing sideways.
    await open(`bot/${mail.id}`, '#bot-thread');
    const email = page.locator('#bot-thread .chat-needs .need-card[data-need="ask:mail1"]');
    await email.waitFor();
    assert.equal(await email.locator('.need-title').innerText(), 'Send email with Gmail?');
    assert.equal(await email.locator('.need-meta').first().innerText(), 'Mail Writer waits for your answer');
    assert.deepEqual(await email.locator('.need-facts dt').allInnerTexts(), ['To', 'Subject', 'Text']);
    assert.equal(await email.locator('pre').count(), 0, 'no policy text and no JSON');
    assert.deepEqual(await email.locator('.need-actions button').allInnerTexts(), ['Decline', 'Always allow this action', 'Allow once']);
    assert.equal(await email.locator('.need-then').count(), 0, 'its run still waits: nothing is started');
    await fits(email, 'a connected-app action, closed, at phone width');
    await email.locator('.need-title').click();
    await fits(email, 'a connected-app action, open, at phone width');
    await shot('carries-on-rows-phone');
    await page.setViewportSize(DESKTOP);
    await fits(email, 'a connected-app action, open, at desktop width');
    await shot('carries-on-rows-desktop');
    await page.setViewportSize(PHONE);

    // A card of five rows (OK-008). Closed, it shows its first three rows and hides the fourth and the fifth whole,
    // label and value: a value that showed without its label would read as another row's. Opened, all five show.
    const FIVE = { ...EMAIL, id: 'mail5', rows: [...EMAIL.rows, { label: 'Reply to', value: 'bart@example.com' }, { label: 'Is html', value: 'no' }] };
    // An action too long to show in full: its rows, the line that says so, and no "Allow once".
    const LONG = { ...EMAIL, id: 'mail-long', more: true, rows: Array.from({ length: 200 }, (_, i) => ({ label: `Field ${i}`, value: `value ${i}` })) };
    // The asks arrive just after a refresh, so the page refreshes once more, as when a chat is opened.
    const refreshed = async () => { await page.evaluate(() => refresh()); await page.evaluate(() => refresh()); };
    waiting = [CHANGE, EMAIL, FIVE, LONG];
    await refreshed();
    const five = page.locator('#bot-thread .chat-needs .need-card[data-need="ask:mail5"]');
    await five.waitFor();
    const drawn = (card) => card.evaluate((el) => [...el.querySelectorAll('.need-facts > *')].map((cell) => [cell.tagName, cell.getClientRects().length > 0]));
    const cells = (shown, hidden) => [...Array(shown).fill(true), ...Array(hidden).fill(false)].flatMap((on) => [['DT', on], ['DD', on]]);
    assert.deepEqual(await drawn(five), cells(3, 2), 'closed: three rows, and of the others neither the label nor the value');
    await fits(five, 'a card of five rows, closed, at phone width');
    await shot('carries-on-five-rows-closed-phone');
    await five.locator('.need-title').click();
    assert.deepEqual(await drawn(five), cells(5, 0), 'opened: every row');
    await fits(five, 'a card of five rows, open, at phone width');
    const long = page.locator('#bot-thread .chat-needs .need-card[data-need="ask:mail-long"]');
    assert.deepEqual(await drawn(long), cells(3, 197), 'a long card is as small as any other while it is closed');
    assert.deepEqual(await long.locator('.need-actions button').allInnerTexts(), ['Decline', 'Always allow this action']);
    assert.deepEqual(await long.locator('.need-meta').allInnerTexts(), ['Mail Writer waits for your answer', 'Too long to show in full.']);
    assert.equal(await long.locator('pre').count(), 0, 'its details are not drawn');
    await fits(long, 'an action too long to show in full, closed, at phone width');
    await shot('carries-on-too-long-closed-phone');
    await long.locator('.need-title').click();
    assert.deepEqual(await drawn(long), cells(200, 0));
    await fits(long, 'an action too long to show in full, open, at phone width');
    waiting = [CHANGE, EMAIL];
    await refreshed();
    await waitFor(async () => (await page.locator('#bot-thread .chat-needs .need-card').count()) === 1, { what: 'the two extra cards to go' });

    // Its run waits for the owner: the line under the chat says so, with a still dot, no dots after the words, and Stop.
    const run = { id: 'run-waits', botId: mail.id, botName: mail.name, status: 'running', trigger: 'manual', prompt: 'Tell Anna I\'ll be 20 minutes late for the 14:00 call.', customPrompt: true, startedAt: new Date().toISOString(), openingLine: 'Writing to Anna' };
    runs = [{ ...run, waitingFor: 'ok' }];
    await page.evaluate(() => refresh());
    const line = page.locator('#bot-thread .status-line');
    await page.locator('#bot-thread .status-line.held').waitFor();
    const look = () => line.evaluate((el) => ({ text: el.querySelector('span').textContent, after: getComputedStyle(el.querySelector('span'), '::after').content, animation: getComputedStyle(el.querySelector('i')).animationName, stop: el.querySelector('button')?.textContent, held: el.classList.contains('held') }));
    const held = await look();
    assert.equal(held.text, 'Waiting for your OK');
    assert.ok(held.after === '""' || held.after === 'none', `no dots after the words: ${held.after}`);
    assert.equal(held.animation, 'none', 'the dot stands still');
    assert.equal(held.stop, 'Stop');
    assert.equal(await page.locator('#bot-thread .status-line + .chat-needs').count(), 1, 'the line stands above the card that waits');
    await shot('carries-on-waiting-phone');
    await page.setViewportSize(DESKTOP);
    assert.equal(await line.isVisible(), true);
    await shot('carries-on-waiting-desktop');
    await page.setViewportSize(PHONE);
    // The wait ended: the run's own line is back, working.
    runs = [run];
    await page.evaluate(() => refresh());
    await waitFor(async () => !(await look()).held, { what: 'the line to leave "Waiting for your OK"' });
    const working = await look();
    assert.equal(working.text, 'Writing to Anna');
    assert.equal(working.animation, 'status-pulse');
    assert.equal(working.stop, 'Stop');

    // A run that carried on: the request once, the first reply, the new reply.
    const stopped = { ...run, id: 'run-stopped', status: 'success', result: 'Not sent yet: I may not use Gmail.', endedAt: new Date().toISOString(), openingLine: undefined };
    runs = [{ ...stopped, id: 'run-carries', continues: 'run-stopped', customPrompt: false, result: 'Sent. Anna knows you\'ll be 20 minutes late.' }, stopped]; // newest first, as the server lists them
    await page.evaluate(() => refresh());
    await waitFor(async () => (await page.locator('#bot-thread .bubble.from-bot').count()) === 2, { what: 'both replies' });
    assert.equal(await page.locator('#bot-thread .bubble.from-me').count(), 1, 'the owner\'s request shows once');
    assert.equal(await page.locator('#bot-thread .chip').count(), 0, 'and no "Ran its main assignment" in its place');
    assert.deepEqual(await page.locator('#bot-thread .bubble.from-bot .md').allInnerTexts(), ['Not sent yet: I may not use Gmail.', 'Sent. Anna knows you\'ll be 20 minutes late.']);
    await shot('carries-on-continues-phone');
    runs = [];

    // Approve in the Chief's chat: one answer, a faded line that says who carries on, and the card is gone elsewhere.
    await open(`chief/${chat.id}`, '#chat-thread');
    await inChief.waitFor();
    await inChief.getByRole('button', { name: 'Approve' }).click();
    await page.locator('#chat-thread .chat-needs .chat-decided').waitFor();
    assert.deepEqual(answers, [{ id: 'change1', body: { yes: true, always: false } }]);
    assert.equal(await page.locator('#chat-thread .chat-needs .chat-decided').innerText(), 'Change News Watcher: web access, new main assignment? · Allowed · the Chief carries on');
    await waitFor(async () => (await page.locator('#chat-thread .chat-needs .need-card').count()) === 0, { what: 'the answered card to leave the chat' });
    await shot('carries-on-answered-phone');
    await open(`bot/${news.id}`, '#bot-thread');
    assert.equal(await page.locator('#bot-thread .need-card[data-need="ask:change1"]').count(), 0, 'answered in one place, gone from the other');

    assert.deepEqual(errors, []);
    console.log('PASS: who carries on, at phone and desktop width: the Chief\'s bot change at the end of its chat with its title, what changes and "in this chat", the chat\'s name elsewhere, the rows of a connected-app action and that its bot waits, a closed card of five rows that hides the last two whole, an action too long to show in full without "Allow once", nothing sideways, "Waiting for your OK" with a still dot and Stop and the run\'s own line after it, a run that carries on without a second message of the owner, and Approve with who carries on.');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
