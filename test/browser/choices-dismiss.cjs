// Optional browser check of the small × after a reply's quick answers, against the real page and server:
//   NODE_PATH=<directory containing playwright> node test/browser/choices-dismiss.cjs
// The × hides the whole row at once and "Answers hidden · Undo" stands in its place; the choice is kept on the server
// with the reply (a reload keeps it), Undo brings the row back and clears the flag, and the line goes by itself
// after a few seconds. Nothing is sent to the bot. The same in a Chief chat. Scratch data and fake Claude only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, seedRuns } = require('../helpers');

(async () => {
  let srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Quotz' });
    await srv.stop();
    const [runId] = seedRuns(srv, bot, [{ prompt: 'Merge?', result: 'Merge #241 into staging?', choices: ['Yes, merge', 'No'], yes: 0 }]);
    const CHAT = 'c-dismiss';
    const at = new Date(Date.now() - 60_000).toISOString();
    fs.mkdirSync(path.join(srv.data, 'chief'), { recursive: true });
    fs.writeFileSync(path.join(srv.data, 'chief', `${CHAT}.json`), JSON.stringify({ id: CHAT, title: 'Backups', sessionId: null, createdAt: at, updatedAt: at, costUsd: 0, messages: [
      { role: 'user', text: 'Backups?', at },
      { role: 'chief', text: 'Shall I start the backup now?', at, choices: ['Yes', 'No'], yes: 0 },
    ] }));
    srv = await startServer({ dir: srv.dir });
    const runs = async () => (await srv.api(`/runs?botId=${bot.id}`)).data;
    const stored = async () => (await srv.api(`/runs/${runId}?events=0`)).data.choicesDismissed ?? false;
    const chiefStored = async () => (await srv.api(`/chief/chats/${CHAT}`)).data.messages[1].choicesDismissed ?? false;

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    for (const where of [
      { name: 'a bot chat', url: `${srv.base}/#bot/${bot.id}`, thread: '#bot-thread', get: stored },
      { name: 'a Chief chat', url: `${srv.base}/#chief/${CHAT}`, thread: '#chat-thread', get: chiefStored },
    ]) {
      await page.goto(where.url);
      await page.reload();
      const row = page.locator(`${where.thread} .choices`);
      const x = page.locator(`${where.thread} .choices .choices-x`);
      const undo = page.locator(`${where.thread} .choices-undo`);
      await row.first().waitFor();
      assert.equal(await x.count(), 1, `${where.name}: one ×`);
      assert.equal(await x.getAttribute('aria-label'), 'Dismiss suggested answers');
      assert.equal(await page.locator(`${where.thread} .choices > *:last-child`).evaluate((e) => e.classList.contains('choices-x')), true, `${where.name}: after the last answer`);
      assert.equal(await page.locator(`${where.thread} .choices [data-choice]`).count(), 2, 'the answers are still there');
      assert.equal(await where.get(), false);

      const before = (await runs()).length;
      await x.click();
      assert.equal(await row.first().isVisible(), false, `${where.name}: the row goes at once`);
      assert.match(await undo.innerText(), /Answers hidden · Undo/);
      for (let i = 0; i < 20 && !(await where.get()); i++) await page.waitForTimeout(100);
      assert.equal(await where.get(), true, `${where.name}: kept on the server`);
      assert.equal((await runs()).length, before, 'nothing was sent to the bot');

      // A reload: still put away, and no line.
      await page.reload();
      await page.locator(`${where.thread} .bubble`).first().waitFor();
      await page.waitForTimeout(500);
      assert.equal(await page.locator(`${where.thread} .choices`).count(), 0, `${where.name}: stays away after a reload`);
      assert.equal(await undo.count(), 0);

      // Undo, in a new dismissal: the row is back and the flag cleared.
      const flag = async (v) => { for (let i = 0; i < 30 && (await where.get()) !== v; i++) await page.waitForTimeout(100); return where.get(); };
      await page.evaluate(async ([url, dismissed]) => { await fetch(`/api${url}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1' }, body: JSON.stringify({ dismissed }) }); }, [where.name === 'a bot chat' ? `/runs/${runId}/choices-dismissed` : `/chief/chats/${CHAT}/messages/1/choices-dismissed`, false]);
      await page.reload();
      await row.first().waitFor();
      await x.click();
      await undo.waitFor();
      await undo.locator('[data-putback]').click();
      await row.first().waitFor({ state: 'visible' });
      assert.equal(await undo.count(), 0, 'the line goes with Undo');
      assert.equal(await flag(false), false, `${where.name}: Undo clears the flag`);

      // An Undo that is not saved leaves the answers away, with the line again; tried once more it goes through.
      await x.click();
      await undo.waitFor();
      assert.equal(await flag(true), true);
      await page.route('**/choices-dismissed', (r) => r.abort('connectionrefused'));
      await undo.locator('[data-putback]').click();
      await undo.waitFor();
      assert.equal(await row.first().isVisible(), false, `${where.name}: a failed Undo keeps the answers away`);
      await page.unroute('**/choices-dismissed');
      await undo.locator('[data-putback]').click();
      await row.first().waitFor({ state: 'visible' });
      assert.equal(await flag(false), false, `${where.name}: Undo tried again clears the flag`);

      // The line goes by itself after a few seconds, and the answers stay away.
      await x.click();
      await undo.waitFor();
      await undo.waitFor({ state: 'detached', timeout: 8000 });
      assert.equal(await page.locator(`${where.thread} .choices:visible`).count(), 0);
      assert.equal(await flag(true), true);
      // Put them back for the next walk.
      await page.evaluate(async ([url]) => { await fetch(`/api${url}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1' }, body: JSON.stringify({ dismissed: false }) }); }, [where.name === 'a bot chat' ? `/runs/${runId}/choices-dismissed` : `/chief/chats/${CHAT}/messages/1/choices-dismissed`]);
    }
    assert.deepEqual(errors, []);
    console.log('choices-dismiss: ok');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
