// Optional browser check of 👍 and 👎 under an unasked Chief message (CHF-002), at phone width:
//   NODE_PATH=<directory containing playwright> node test/browser/ratings.cjs
// Only the unasked message has them; a tap fills one and stores it, a second tap clears it, the other one moves
// it, the keyboard works too; a rating made elsewhere shows without a reload; a refused tap rolls back with a
// toast; against a server without `ratings` none show. Scratch data and fake Claude only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, waitFor } = require('../helpers');

const CHAT = 'rated';
const at = '2026-10-03T09:00:00.000Z';

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    fs.mkdirSync(path.join(srv.data, 'chief'), { recursive: true });
    fs.writeFileSync(path.join(srv.data, 'chief', `${CHAT}.json`), JSON.stringify({ id: CHAT, title: 'Backups', sessionId: null, createdAt: at, updatedAt: at, costUsd: 0, messages: [
      { role: 'user', text: 'How are the backups?', at },
      { role: 'chief', text: 'All fine.', at },
      { role: 'chief', text: 'Your backup bot has not run since Monday. Want me to start it?', at, unasked: true },
    ] }));
    const stored = async () => (await srv.api(`/chief/chats/${CHAT}`)).data.messages[2].rating ?? null;

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#chief/${CHAT}`);
    const rate = page.locator('#chat-thread [data-msg="2"] .rate');
    await rate.waitFor();
    assert.equal(await page.locator('#chat-thread .rate').count(), 1, 'only the unasked message has thumbs');
    const up = rate.getByRole('button', { name: 'More like this' });
    const down = rate.getByRole('button', { name: 'Less like this' });
    const pressed = async () => [await up.getAttribute('aria-pressed'), await down.getAttribute('aria-pressed')];

    // On the time's line, after Copy, not wrapped.
    const line = await page.locator('#chat-thread [data-msg="2"] .bubble-meta').evaluate((el) => {
      const tops = [...el.querySelectorAll('.copy-btn, .rate-btn')].map((b) => Math.round(b.getBoundingClientRect().top));
      return { tops, order: [...el.querySelectorAll('button')].map((b) => b.className) };
    });
    assert.equal(new Set(line.tops).size, 1, `one line: ${line.tops}`);
    assert.deepEqual(line.order.map((c) => c.split(' ')[0]), ['copy-btn', 'rate-btn', 'rate-btn']);

    await up.click();
    assert.deepEqual(await pressed(), ['true', 'false']);
    await waitFor(async () => (await stored()) === 'up', { what: '👍 stored' });
    const fill = await up.locator('svg').evaluate((s) => getComputedStyle(s).fill);
    assert.equal(fill, 'rgb(216, 90, 48)', "filled in the Chief's colour");
    await up.click();
    await waitFor(async () => (await stored()) === null, { what: 'cleared' });
    assert.deepEqual(await pressed(), ['false', 'false']);
    await down.focus();
    await page.keyboard.press('Space');
    await waitFor(async () => (await stored()) === 'down', { what: '👎 from the keyboard' });
    await up.focus();
    await page.keyboard.press('Enter');
    await waitFor(async () => (await stored()) === 'up', { what: 'moved to 👍' });
    assert.deepEqual(await pressed(), ['true', 'false']);

    // Rated in another app: shows within a moment, without a reload.
    await srv.api(`/chief/chats/${CHAT}/messages/2/rating`, { method: 'PUT', body: { rating: 'down' } });
    await waitFor(async () => (await pressed())[1] === 'true', { what: 'the feed\'s rating' });

    // Refused: back as it was, and a toast.
    await page.route('**/messages/2/rating', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"no"}' }));
    await up.click();
    await waitFor(async () => (await pressed()).join() === 'false,true', { what: 'the rollback' });
    assert.match(await page.locator('#toast').innerText(), /Couldn't save your rating/);
    assert.equal(await stored(), 'down');
    await page.unroute('**/messages/2/rating');

    // A server without ratings: no icons.
    await page.route('**/api/version', async (r) => {
      const res = await r.fetch();
      const v = await res.json();
      await r.fulfill({ response: res, json: { ...v, features: v.features.filter((f) => f !== 'ratings') } });
    });
    await page.reload();
    await page.locator('#chat-thread [data-msg="2"] .bubble-meta').waitFor();
    assert.equal(await page.locator('#chat-thread .rate').count(), 0, 'no thumbs against an older server');

    assert.deepEqual(errors, []);
    console.log('PASS: 👍 and 👎 under the unasked message only, on the time\'s line at phone width; tap, clear, move, keyboard, the feed, the rollback and the older server.');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
