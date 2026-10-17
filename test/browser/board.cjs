// Optional browser check of the Board in the web list (BOARD-001): NODE_PATH=<directory containing playwright> node test/browser/board.cjs
// On a fresh botdot server the list shows the strip "Board · Nothing on it yet ›" above the Chief of Staff,
// whole on one line at 1440px, at the list's narrowest width (200px, in a 600px window) and on a phone (390px).
// A tap opens the page headed "Board" with its two lines. A tile added through the API takes the text's place,
// and removing it brings the text back; a tile whose script waits for the OK leaves the text; a bot's
// suggestion shows under the two lines; typing in Search hides the strip; the strip is no contact row.
// SHOTS=<folder> keeps a picture of each. Scratch data and the stand-in Claude only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, heldRun, self, waitFor } = require('../helpers');

const EMPTY = 'Board · Nothing on it yet';
const LINES = [
  'Tiles for the things you use most: a light switch, the temperature, a shopping list, a morning summary.',
  'Nothing is on it yet. Tell the Chief or any bot, for example: “Put a shopping list on my board.”',
];

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    const shot = async (name) => { if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`) }); };
    const hash = () => new URL(page.url()).hash;
    const box = (sel) => page.locator(sel).boundingBox();
    const count = (sel) => page.locator(sel).count();
    const strip = page.locator('#contacts .dash-strip');
    const stripText = () => page.locator('#contacts .dash-strip .tiles').innerText();
    // The Board as the page knows it: how many tiles and suggestions it has loaded.
    const loaded = (tiles, suggestions = 0) => page.waitForFunction(([t, s]) => state.dash?.tiles.length === t && (state.dash.suggestions || []).length === s, [tiles, suggestions]);
    // The empty strip as it is drawn: its text and `›`, how much of the text the strip cuts off, how high
    // the text is, and the colours of its two parts beside the page's text and muted colours.
    const drawn = () => page.evaluate(() => {
      const button = document.querySelector('#contacts .dash-strip');
      const row = button.querySelector('.tiles');
      const text = row.querySelector('.none');
      const more = button.querySelector('.more');
      const [b, r, t, m] = [button, row, text, more].map((el) => el.getBoundingClientRect());
      const colour = (name) => { const el = document.createElement('i'); el.style.color = `var(${name})`; document.body.append(el); const c = getComputedStyle(el).color; el.remove(); return c; };
      return {
        text: row.innerText, more: more.innerText, title: button.title, tag: button.tagName, contact: button.dataset.contact, classes: [...button.classList],
        first: document.querySelector('#contacts').firstElementChild === button,
        next: button.nextElementSibling?.dataset.contact,
        width: t.width, room: r.width, cut: Math.max(0, t.right - r.right, row.scrollWidth - row.clientWidth), height: t.height,
        moreInside: m.right <= b.right + 0.5 && m.width > 0,
        name: getComputedStyle(text.querySelector('b')).color, rest: getComputedStyle(text).color, textColour: colour('--text'), muted: colour('--muted'),
      };
    });
    const measured = {};
    const wholeOnOneLine = async (at) => {
      const d = await drawn();
      assert.equal(d.text, EMPTY, at);
      assert.equal(d.more, '›', at);
      assert.equal(d.cut, 0, `${at}: the text is ${d.width}px wide in ${d.room}px`);
      assert.ok(d.height < 30, `${at}: one line, not ${d.height}px high`);
      assert.ok(d.moreInside, `${at}: › is in the strip`);
      assert.equal(d.name, d.textColour, `${at}: "Board" in the text colour`);
      assert.equal(d.rest, d.muted, `${at}: the rest muted`);
      assert.notEqual(d.textColour, d.muted);
      measured[at] = `${Math.round(d.width)} of ${Math.round(d.room)}px`;
      return d;
    };

    // ---- zero tiles: the strip above the Chief of Staff, at three widths ----
    await page.goto(srv.base);
    await strip.waitFor();
    let d = await wholeOnOneLine('1440px');
    assert.equal(d.tag, 'BUTTON');
    assert.equal(d.contact, 'dashboard', 'the same strip button');
    assert.ok(!d.classes.includes('contact'), 'never a contact row');
    assert.equal(d.title, 'Board');
    assert.ok(d.first, 'at the top of the list');
    assert.equal(d.next, 'chief', 'above the Chief of Staff');
    assert.equal(Math.round((await box('.sidebar')).width), 300);
    await shot('1440-empty-strip');

    await page.setViewportSize({ width: 600, height: 800 });
    assert.equal(Math.round((await box('.sidebar')).width), 200, 'the list at its narrowest');
    await wholeOnOneLine('200px');
    await shot('600-empty-strip');

    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(Math.round((await box('.sidebar')).width), 390, 'a phone shows the list first');
    await wholeOnOneLine('390px');
    await shot('390-empty-strip');
    await page.setViewportSize({ width: 1440, height: 900 });

    // ---- the strip is no contact row, and typing in Search hides it ----
    const rows = await count('#contacts .contact');
    assert.equal(rows, 1, 'a fresh botdot server: the Chief of Staff alone');
    await page.locator('#contact-search').fill('chief');
    await strip.waitFor({ state: 'detached' });
    assert.equal(await count('#contacts .contact'), rows, 'as many rows without the strip as with it');
    await page.locator('#contact-search').fill('');
    await strip.waitFor();
    assert.equal(await stripText(), EMPTY);
    assert.equal(await count('#contacts .contact'), rows);

    // ---- a tap opens the Board: its heading and two lines ----
    await strip.click();
    await page.locator('#view-dashboard .dash-empty').waitFor();
    assert.equal(hash(), '#dashboard');
    assert.equal(await page.locator('#view-dashboard h1').innerText(), 'Board');
    assert.deepEqual(await page.locator('#view-dashboard .dash-empty p').allInnerTexts(), LINES);
    assert.equal(await count('#view-dashboard [data-tile]'), 0);
    const colours = await page.evaluate(() => {
      const colour = (name) => { const el = document.createElement('i'); el.style.color = `var(${name})`; document.body.append(el); const c = getComputedStyle(el).color; el.remove(); return c; };
      const empty = document.querySelector('#view-dashboard .dash-empty');
      return { example: getComputedStyle(empty.querySelector('i')).color, exampleText: empty.querySelector('i').innerText, line: getComputedStyle(empty.querySelector('p')).color, text: colour('--text'), muted: colour('--muted') };
    });
    assert.equal(colours.exampleText, '“Put a shopping list on my board.”');
    assert.equal(colours.example, colours.text, 'the example in the text colour');
    assert.equal(colours.line, colours.muted);
    assert.ok((await strip.getAttribute('class')).split(' ').includes('active'), 'the strip is marked while the Board is open');
    await shot('1440-empty-board');

    // ---- a tile added through the API takes the text's place; removing it brings the text back ----
    const tile = await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'note', title: 'Shopping', value: 'Milk\nEggs' } });
    assert.equal(tile.status, 201, JSON.stringify(tile.data));
    await page.locator('#contacts .dash-strip .t', { hasText: 'Shopping' }).waitFor();
    assert.equal(await count('#contacts .dash-strip .none'), 0);
    assert.equal(await stripText(), 'Shopping');
    assert.equal(await strip.getAttribute('title'), 'Board', 'with tiles, its hover title');
    await page.locator(`#view-dashboard [data-tile="${tile.data.id}"]`).waitFor();
    assert.equal(await count('#view-dashboard .dash-empty'), 0);
    assert.equal(await page.locator('#view-dashboard h1').innerText(), 'Board');
    await shot('1440-one-tile');
    assert.equal((await srv.api(`/dashboard/tiles/${tile.data.id}`, { method: 'DELETE' })).data.ok, true);
    await page.locator('#contacts .dash-strip .none').waitFor();
    assert.equal(await stripText(), EMPTY);
    await page.locator('#view-dashboard .dash-empty').waitFor();
    assert.deepEqual(await page.locator('#view-dashboard .dash-empty p').allInnerTexts(), LINES);

    // ---- a tile whose script waits for the OK is no tile to show: the text stays ----
    const bot = await makeBot(srv, { name: 'Disk Watcher' });
    const waiting = await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'value', title: 'Disk', bot: bot.id, unit: '%', read: { type: 'script', script: 'echo 91' } } });
    assert.equal(waiting.data.approved, false, JSON.stringify(waiting.data));
    await loaded(1);
    await page.locator(`#view-dashboard [data-tile="${waiting.data.id}"]`).waitFor();
    assert.equal(await stripText(), EMPTY, 'it waits for the OK');
    assert.equal(await count('#contacts .dash-strip .t'), 0);
    assert.equal(await count('#view-dashboard .tile.waiting'), 1, 'the page shows it waiting');
    await page.locator(`#contacts .contact[data-contact="${bot.id}"]`).waitFor();
    assert.equal(await count('#contacts .contact'), rows + 1, 'the new bot is the one new row');
    assert.equal((await srv.api(`/dashboard/tiles/${waiting.data.id}/approve`, { method: 'POST', body: { approve: false } })).data.ok, true);
    await loaded(0);

    // ---- a bot's suggestion waits under the two lines, and is no tile either ----
    const { rec, token } = await heldRun(srv, bot);
    const suggested = await self(srv, token, 'suggest', { tile: { kind: 'note', title: 'Shopping list' }, reason: 'You asked me for a shopping list.' });
    assert.equal(suggested.data.ok, true, JSON.stringify(suggested.data));
    await loaded(0, 1);
    await page.locator('#view-dashboard .tile.suggested').waitFor();
    assert.deepEqual(await page.locator('#view-dashboard .dash-empty p').allInnerTexts(), LINES);
    assert.deepEqual(await page.locator('#view-dashboard h3.dash-sec').allInnerTexts(), ['Suggested']);
    assert.ok((await box('#view-dashboard .tile.suggested')).y > (await box('#view-dashboard .dash-empty')).y, 'under the two lines');
    assert.equal(await stripText(), EMPTY);
    await shot('1440-empty-board-with-a-suggestion');
    srv.unhold();
    srv.release(rec);

    assert.deepEqual(errors, []);
    console.log(`PASS: the Board's strip at zero tiles reads "${EMPTY} ›", whole on one line (the text takes ${Object.entries(measured).map(([at, px]) => `${px} at ${at}`).join(', ')}), above the Chief of Staff and no contact row; Search hides it; a tap opens the page headed "Board" with its two lines; a tile takes the text's place and its removal brings the text back; a tile waiting for the OK and a bot's suggestion leave the text; no browser errors.`);
  } finally {
    srv.unhold();
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
