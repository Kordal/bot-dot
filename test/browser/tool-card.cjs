// Optional browser check of the tool install card (TOOL-003), at phone width and at desktop width:
//   NODE_PATH=<directory containing playwright> node test/browser/tool-card.cjs
// Three tool asks wait: one from the registry that the Chief asked for, one a bot asked the Chief for, and one
// from a link with its warning, a long address, a file's name and a whole checksum. Each has a head in the
// banner and a card in Needs you under its bot's head; a closed card shows a few lines, and the warning of the
// tool from a link shows even then; opened, the warning stands between the body and the facts, in amber, and
// nothing scrolls sideways; what a link wrote is text, never markup. Install and Decline send the answer and
// the card fades; a refused answer and a server that is away leave the card and say why. The card is also in
// its bot's chat and in the Chief's, and in no other bot's. Last, the card of a tool from a link as the botdot
// server writes it (lib/asks.js) at 375 px, the narrowest phone: all of its warning shows, closed and open, on
// two lines at most; and what a closed card shows is whole lines, at phone and at desktop width (TOOL-010).
// The asks are stood in for on the page's own requests (/api/asks): the server's side is test/tools.test.js.
// Scratch data and fake Claude only.
//   TOOL_CARD_SHOTS=<folder>  also save screenshots there
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, waitFor } = require('../helpers');
const { proposalView } = require('../../lib/asks');

const SHOTS = process.env.TOOL_CARD_SHOTS;
const PHONE = { width: 390, height: 844 };
const NARROW = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 800 };
const AMBER = 'rgb(239, 159, 39)';
const SHA = '3f9a0c5d1e7b4a6f8c2d9e0b1a3c5d7f9e1b3a5c7d9f0e2b4a6c8d0e2f4a6c2e';
const REGISTRY = "botdot's registry (conda-forge), checksum verified";
const WARNING = 'Not from the approved list. Make sure you trust the source.';

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const coder = await makeBot(srv, { name: 'Coder', color: '#7f77dd', description: 'Writes and fixes code', allowedTools: ['Read', 'Bash'] });
    const reader = await makeBot(srv, { name: 'Reader', color: '#378add', description: 'Reads the morning news' });
    const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
    const bot = { id: coder.id, name: coder.name, color: coder.color };
    const ask = (id, fields) => ({ id, kind: 'tool', botId: coder.id, bot, at: '2026-10-03T09:00:00.000Z', forBots: [], ...fields });
    const GH = ask('gh1', { title: 'Install gh for Coder?', meta: 'asked by the Chief', body: 'GitHub CLI.\n\nWhy: Coder needs it to read issue 158 and open the pull request.',
      facts: [{ label: 'Version', value: '2.101.0' }, { label: 'Source', value: REGISTRY }, { label: 'Size', value: '14 MB' }, { label: 'Runs as', value: 'Coder only' }, { label: 'Stays', value: 'across botdot updates' }] });
    const MAKE = ask('make1', { title: 'Install make for Coder?', meta: 'Coder asked the Chief', body: 'GNU Make. <b>Runs</b> the build steps of a Makefile.\n\nWhy: "make: command not found" when Coder ran the checks.',
      facts: [{ label: 'Version', value: '4.4.1' }, { label: 'Source', value: REGISTRY }, { label: 'Size', value: '1 MB' }, { label: 'Runs as', value: 'Coder only' }, { label: 'Stays', value: 'across botdot updates' }] });
    const STRIPE = ask('stripe1', { title: 'Install stripe for Coder?', meta: 'from a link you gave · asked by the Chief', body: 'Stripe CLI, as described on its page.\n\nWhy: Coder needs it to replay test payments.',
      warning: `${WARNING} <img src=x onerror="document.title='markup'">`,
      facts: [{ label: 'Version', value: '1.31.0' }, { label: 'Source', value: 'https://github.com/stripe/stripe-cli/releases/download/v1.31.0/stripe_1.31.0_linux_arm64.tar.gz' }, { label: 'File', value: 'stripe_1.31.0_linux_arm64.tar.gz' },
        { label: 'Checksum', value: `sha256 ${SHA}` }, { label: 'Size', value: '12 MB' }, { label: 'Runs as', value: 'Coder only' }] });

    // What waits, what was answered, and how the next answer goes: 'ok', 'refused' or 'away'.
    let waiting = [GH, MAKE, STRIPE];
    const answers = [];
    let next = 'ok';

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });
    await context.route('**/api/asks', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: waiting }) : r.fallback()));
    await context.route('**/api/asks/*', (r) => {
      const id = decodeURIComponent(new URL(r.request().url()).pathname.split('/').pop());
      const body = r.request().postDataJSON();
      answers.push({ id, body });
      if (next === 'away') return r.abort();
      if (next === 'refused') return r.fulfill({ status: 404, json: { error: 'That request was already answered.' } });
      waiting = waiting.filter((a) => a.id !== id);
      return r.fulfill({ json: body.yes === true ? { ok: true, installing: true } : { ok: true, declined: true } });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); } };
    const card = (a, root = '#view-needs') => page.locator(`${root} .need-card.need-tool[data-need="ask:${a.id}"]`);
    const toastText = () => page.locator('#toast').innerText();
    // Nothing of the open card reaches past its edge, nothing in it scrolls sideways, and neither does the page.
    const sideways = (a) => card(a).evaluate((el) => {
      const box = el.getBoundingClientRect();
      const blocks = [el, ...el.querySelectorAll('.need-who, .need-title, .need-meta, .need-body, .nb, dt, dd, .need-actions')];
      return {
        past: blocks.filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.right > box.right + 0.5 || r.left < box.left - 0.5); }).map((b) => b.className || b.tagName),
        scrolling: blocks.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.className || b.tagName),
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        view: document.querySelector('#view-needs').scrollWidth - document.querySelector('#view-needs').clientWidth,
        card: [Math.round(box.left), Math.round(box.right)], viewport: window.innerWidth,
      };
    });
    const fits = async (a, where) => {
      const s = await sideways(a);
      assert.deepEqual(s.past, [], `${where}: nothing reaches past the card: ${JSON.stringify(s)}`);
      assert.deepEqual(s.scrolling, [], `${where}: nothing scrolls sideways in the card`);
      assert.ok(s.page <= 0 && s.view <= 0, `${where}: the page does not scroll sideways: ${JSON.stringify(s)}`);
      assert.ok(s.card[0] >= 0 && s.card[1] <= s.viewport, `${where}: the card is inside the window: ${JSON.stringify(s)}`);
    };

    // What a closed card shows of its blocks. Each is limited by a count of lines and by no height, so no line of
    // text and no row of facts is cut through by its block's lower edge; `hidden` is what waits behind the click.
    const closedBlocks = (a) => page.locator(`#view-needs .need-card[data-need="ask:${a.id}"]`).evaluate((el) => [...el.querySelectorAll('.nb')].filter((nb) => nb.getClientRects().length).map((nb) => {
      const box = nb.getBoundingClientRect(), style = getComputedStyle(nb), range = document.createRange();
      range.selectNodeContents(nb);
      const parts = [...range.getClientRects(), ...[...nb.querySelectorAll('dt, dd')].map((d) => d.getBoundingClientRect())].filter((r) => r.width > 0);
      return { tag: nb.tagName, maxHeight: style.maxHeight, lines: box.height / parseFloat(style.lineHeight), hidden: nb.scrollHeight - nb.clientHeight,
        cut: parts.filter((r) => r.top < box.bottom - 0.5 && r.bottom > box.bottom + 0.5).length };
    }));
    const wholeLines = async (a, where) => {
      const blocks = await closedBlocks(a);
      assert.ok(blocks.length > 0, `${where}: the closed card shows a block`);
      for (const b of blocks) {
        assert.equal(b.maxHeight, 'none', `${where}: no height is set on a closed block: ${JSON.stringify(b)}`);
        assert.equal(b.cut, 0, `${where}: no line is cut through: ${JSON.stringify(b)}`);
        if (b.tag !== 'DL') assert.ok(Math.abs(b.lines - Math.round(b.lines)) < 0.05 && Math.round(b.lines) <= 3, `${where}: one to three whole lines: ${JSON.stringify(b)}`);
      }
      return blocks;
    };

    // The banner: one head per ask. Review opens the page with the cards.
    await page.goto(`${srv.base}/#chief`);
    await page.locator('#needs-banner .needs-figs > i').nth(2).waitFor();
    assert.equal(await page.locator('#needs-banner .needs-figs > i').count(), 3, 'one head per tool ask');
    assert.equal(await page.locator('#needs-banner .needs-figs svg.fig-small').count(), 3);
    await page.locator('#needs-open').click();
    await card(GH).waitFor();
    assert.equal(await page.locator('#view-needs .need-card').count(), 3, 'one card per tool');

    // A card: under its bot's head, the title, the meta line, the body; closed, the facts are folded away.
    assert.match(await card(GH).locator('.need-who').innerText(), /Coder/);
    assert.equal(await card(GH).locator('.need-who svg.fig-small').count(), 1, "the bot's head");
    assert.equal(await card(GH).locator('.need-title').innerText(), 'Install gh for Coder?');
    assert.equal(await card(GH).locator('.need-meta').innerText(), 'asked by the Chief');
    assert.equal(await card(MAKE).locator('.need-meta').innerText(), 'Coder asked the Chief');
    assert.match(await card(GH).locator('.need-body').first().innerText(), /^GitHub CLI\./);
    assert.deepEqual(await card(GH).locator('.need-actions button').allInnerTexts(), ['Decline', 'Install']);
    assert.equal(await card(GH).locator('.need-facts').isVisible(), false, 'closed: no facts yet');
    assert.equal(await card(GH).locator('.need-warn').count(), 0, 'a tool from the registry has no warning');

    // The tool from a link, closed: its warning is not behind the fold. At most two lines of it show.
    const warn = card(STRIPE).locator('.need-warn');
    assert.equal(await warn.isVisible(), true, 'the warning shows on the closed card');
    assert.equal(await card(STRIPE).locator('.need-facts').isVisible(), false);
    const closed = await warn.evaluate((el) => ({ height: el.getBoundingClientRect().height, border: getComputedStyle(el).borderTopColor, line: parseFloat(getComputedStyle(el.querySelector('.nb')).lineHeight) }));
    assert.equal(closed.border, AMBER, 'set apart in amber');
    assert.ok(closed.height <= 2 * closed.line + 20, `closed, the warning is two lines at most: ${JSON.stringify(closed)}`);
    await fits(STRIPE, 'closed, at phone width');
    for (const a of [GH, MAKE, STRIPE]) await wholeLines(a, `${a.id}, closed, at phone width`);
    await shot('tool-card-phone-closed');

    // Opened by a click: the body, then the warning, then the facts, each row a label and its value.
    await card(STRIPE).locator('.need-title').click();
    await card(STRIPE).locator('.need-facts').waitFor();
    assert.match(await card(STRIPE).getAttribute('class'), /\bopen\b/);
    const open = await card(STRIPE).evaluate((el) => {
      const top = (sel) => el.querySelector(sel).getBoundingClientRect();
      const row = [...el.querySelectorAll('.need-facts dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent, Math.round(dt.nextElementSibling.getBoundingClientRect().height), parseFloat(getComputedStyle(dt.nextElementSibling).lineHeight)]);
      return { body: top('.need-body').bottom, warnTop: top('.need-warn').top, warnBottom: top('.need-warn').bottom, facts: top('.need-facts').top, actions: top('.need-actions').top, warnText: el.querySelector('.need-warn').textContent, row };
    });
    assert.ok(open.body <= open.warnTop && open.warnBottom <= open.facts && open.facts < open.actions, `the body, the warning, the facts, the buttons: ${JSON.stringify(open)}`);
    assert.equal(open.warnText, `⚠️ ${WARNING} <img src=x onerror="document.title='markup'">`, 'opened, the warning is whole, and what a link wrote is text');
    assert.deepEqual(open.row.map((r) => r[0]), ['Version', 'Source', 'File', 'Checksum', 'Size', 'Runs as']);
    assert.equal(open.row[3][1], `sha256 ${SHA}`, 'the whole checksum');
    assert.ok(open.row[3][2] > open.row[3][3] * 1.5, `the checksum wraps onto a second line at phone width: ${JSON.stringify(open.row[3])}`);
    assert.ok(open.row[1][2] > open.row[1][3] * 1.5, 'so does the address');
    assert.equal(await card(STRIPE).locator('img').count(), 0, 'no markup from the warning');
    assert.equal(await page.title() === 'markup', false);
    await fits(STRIPE, 'open, at phone width');
    await shot('tool-card-phone-open');

    // Markup in a body is text too.
    await card(MAKE).locator('.need-title').click();
    assert.equal(await card(MAKE).locator('.need-body b').count(), 0);
    assert.match(await card(MAKE).locator('.need-body').first().innerText(), /GNU Make\. <b>Runs<\/b> the build steps/);
    await fits(MAKE, 'open, at phone width');

    // The same cards at desktop width.
    await page.setViewportSize(DESKTOP);
    await fits(STRIPE, 'open, at desktop width');
    await fits(GH, 'closed, at desktop width');
    await shot('tool-card-desktop');
    await page.setViewportSize(PHONE);

    // A refused answer, and a server that is away: the card stays with its buttons, and a toast says why.
    next = 'refused';
    await card(STRIPE).getByRole('button', { name: 'Install' }).click();
    await waitFor(async () => /That request was already answered\./.test(await toastText()), { what: 'the refusal as a toast' });
    assert.deepEqual(answers.pop(), { id: 'stripe1', body: { yes: true, always: false } });
    assert.doesNotMatch(await card(STRIPE).getAttribute('class'), /\bdone\b/);
    assert.deepEqual(await card(STRIPE).locator('.need-actions button').allInnerTexts(), ['Decline', 'Install']);
    next = 'away';
    await card(STRIPE).getByRole('button', { name: 'Decline' }).click();
    await waitFor(() => answers.length === 1, { what: 'the answer that does not arrive' });
    assert.deepEqual(answers.pop(), { id: 'stripe1', body: { yes: false, always: false } });
    await waitFor(async () => !/already answered/.test(await toastText()) && (await toastText()).trim().length > 0, { what: 'the failed request as a toast' });
    assert.doesNotMatch(await card(STRIPE).getAttribute('class'), /\bdone\b/);
    assert.equal(await card(STRIPE).locator('.need-actions button').count(), 2);
    next = 'ok';

    // Install: the answer is sent, and the card fades and says the install is on its way.
    await card(GH).getByRole('button', { name: 'Install' }).click();
    await waitFor(async () => /\bdone\b/.test(await card(GH).getAttribute('class')), { what: 'the card to fade' });
    assert.deepEqual(answers.pop(), { id: 'gh1', body: { yes: true, always: false } });
    assert.equal(await card(GH).locator('.need-actions').innerText(), 'Installing');
    assert.equal(await card(GH).locator('.need-actions button').count(), 0);
    // Decline: the same, with its own word.
    await card(MAKE).getByRole('button', { name: 'Decline' }).click();
    await waitFor(async () => /\bdone\b/.test(await card(MAKE).getAttribute('class')), { what: 'the declined card to fade' });
    assert.deepEqual(answers.pop(), { id: 'make1', body: { yes: false, always: false } });
    assert.equal(await card(MAKE).locator('.need-actions').innerText(), 'Declined');
    assert.equal(await card(STRIPE).locator('.need-actions button').count(), 2, 'the one that was not answered still waits');
    await shot('tool-card-phone-done');

    // The chats. The card is in the chat of the bot it is for, without the head (it is that bot's chat)…
    waiting = [GH];
    const inChat = async (hash, thread) => {
      await page.goto(`${srv.base}/#${hash}`);
      await page.reload();
      await page.locator(thread).waitFor({ state: 'attached' });
      await page.locator('#needs-banner .needs-figs > i').first().waitFor(); // the asks have arrived
      // A chat draws its cards when the page refreshes, and the asks arrive just after the first refresh: in real
      // use the feed's next event brings them into the chat, here the page is told to refresh once more.
      await page.evaluate(() => refresh());
      return page.locator(`${thread} .chat-needs .need-card.need-tool`);
    };
    let cards = await inChat(`bot/${coder.id}`, '#bot-thread');
    await cards.first().waitFor();
    assert.equal(await cards.count(), 1, "in its bot's chat");
    assert.equal(await cards.first().locator('.need-who').isVisible(), false);
    assert.equal(await cards.first().locator('.need-title').innerText(), 'Install gh for Coder?');
    // … not in another bot's …
    cards = await inChat(`bot/${reader.id}`, '#bot-thread');
    assert.equal(await cards.count(), 0, "not in another bot's chat");
    // … and in the Chief's, under the head of the bot it is for. Answered there, it leaves a faded line.
    cards = await inChat(`chief/${chat.id}`, '#chat-thread');
    await cards.first().waitFor();
    assert.equal(await cards.count(), 1, "in the Chief's chat");
    assert.match(await cards.first().locator('.need-who').innerText(), /Coder/);
    await cards.first().getByRole('button', { name: 'Install' }).click();
    await page.locator('#chat-thread .chat-needs .chat-decided').waitFor();
    assert.deepEqual(answers.pop(), { id: 'gh1', body: { yes: true, always: false } });
    assert.equal(await page.locator('#chat-thread .chat-needs .chat-decided').innerText(), 'Install gh for Coder? · Installing');
    await waitFor(async () => (await page.locator('#chat-thread .chat-needs .need-card').count()) === 0, { what: 'the answered card to leave the chat' });

    // The card of a tool from a link as the botdot server writes it, at the narrowest phone width: all of its
    // warning shows, closed and open, on two lines at most (the owner's wording, TOOL-010), and the body still
    // says that botdot has not checked the program. Closed, the body is three whole lines; so are the rows of a
    // card that has only facts. Both hold at desktop width too.
    const LINK = ask('stripe2', proposalView({ kind: 'tool', botName: 'Coder', askedBy: 'chief', reason: 'Coder needs it to replay test payments against the shop, to listen for the events the shop sends back, and to check that an order is marked as paid only once when the same event arrives twice.',
      tool: { name: 'stripe', version: '1.31.0', summary: 'Stripe CLI', size: 12_000_000, source: { type: 'link', url: 'https://github.com/stripe/stripe-cli/releases/download/v1.31.0/stripe_1.31.0_linux_arm64.tar.gz', sha256: SHA, command: 'stripe', from: 'owner' } } }));
    assert.equal(LINK.warning, WARNING);
    const BARE = ask('bare1', { title: 'Install kubectl for Coder?', meta: 'asked by the Chief', facts: STRIPE.facts });
    // A card of another kind whose body is a block of lines as they were written (a changed bot's details).
    const CHANGE = { id: 'change1', kind: 'bot-change', botId: coder.id, bot, at: '2026-10-03T09:00:00.000Z', forBots: [], title: 'Change Coder?', reason: 'To run the checks.', details: 'allowedTools: Read, Bash\nmodel: the same as before, with a line long enough to reach past the edge of a card on a phone\nrules: three\nskills: two\ngroup: Work' };
    waiting = [LINK, BARE, CHANGE];
    await page.setViewportSize(NARROW);
    await page.goto(`${srv.base}/#chief`);
    await page.reload();
    await page.locator('#needs-banner .needs-figs > i').first().waitFor();
    await page.locator('#needs-open').click();
    await card(LINK).waitFor();
    const warning = () => card(LINK).locator('.need-warn .nb').evaluate((el) => ({ lines: el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight), hidden: el.scrollHeight - el.clientHeight, text: el.innerText.trim() }));
    const inSight = async (where) => {
      const w = await warning();
      assert.equal(w.text, `⚠️ ${WARNING}`, where);
      assert.ok(w.lines < 2.5 && w.hidden <= 1, `${where}: all of the server's warning shows, on two lines at most: ${JSON.stringify(w)}`);
    };
    const closedCards = async (where) => {
      const [body] = await wholeLines(LINK, `the server's card, closed, ${where}`);
      assert.ok(Math.round(body.lines) === 3 && body.hidden > 0, `${where}: a long body is three lines, the rest waits behind the click: ${JSON.stringify(body)}`);
      const [facts] = await wholeLines(BARE, `a card of facts alone, closed, ${where}`);
      assert.equal(facts.tag, 'DL');
      assert.deepEqual(await card(BARE).locator('.need-facts dt').evaluateAll((dts) => dts.filter((dt) => dt.getClientRects().length).map((dt) => dt.textContent)), ['Version', 'Source', 'File'], `${where}: its first three rows`);
      const [pre] = await wholeLines(CHANGE, `a card of written lines, closed, ${where}`);
      assert.ok(pre.tag === 'PRE' && Math.round(pre.lines) === 3 && pre.hidden > 0, `${where}: three of its five lines: ${JSON.stringify(pre)}`);
      await inSight(`closed, ${where}`);
      await fits(LINK, `the server's card, closed, ${where}`);
      await fits(BARE, `a card of facts alone, closed, ${where}`);
    };
    await closedCards('at 375 px');
    await shot('tool-card-narrow-closed');
    await page.setViewportSize(DESKTOP);
    await closedCards('at desktop width');
    await shot('tool-card-desktop-closed');
    await page.setViewportSize(NARROW);
    await card(LINK).locator('.need-title').click();
    await card(LINK).locator('.need-facts').waitFor();
    await inSight('open, at 375 px');
    assert.equal((await card(LINK).locator('.need-warn').innerText()).trim(), `⚠️ ${WARNING}`);
    assert.match(await card(LINK).locator('.need-body').first().innerText(), /^Stripe CLI, as described on its page\. botdot has not checked what this program does\./);
    await fits(LINK, 'the server\'s card, open, at 375 px');
    await shot('tool-card-narrow-open');

    assert.deepEqual(errors, []);
    console.log('PASS: the tool install card at phone and desktop width: a head per ask, the card under its bot\'s head, the warning of a tool from a link in sight when closed and between the body and the facts when open, nothing sideways, text never markup, Install, Decline, a refusal, a server that is away, the card in its bot\'s chat and the Chief\'s, all of the server\'s own warning in sight at 375 px, and whole lines on a closed card.');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
