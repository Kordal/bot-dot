// Optional browser check that the chat that is open already stays where it is when it is opened again:
// node test/browser/chat-open-again.cjs (WEBKIT=1: in WebKit, as the Mac app draws it)
// A team's chat with many new replies opens at its "New" line, far up; the owner reads down to the end. Its key
// clicked again, or a notification about it tapped, leaves the chat at its end, not up at that line, which stays
// drawn while the chat is open. A bot's chat the same. Another chat and back opens the chat at its end, read.
// Scratch data and fake Claude only.
const assert = require('node:assert/strict');
const pw = require('playwright');
const { startServer, makeBot, seedRuns, waitFor, sleep } = require('../helpers');

(async () => {
  let srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const unseen = (await srv.api('/whats-new')).data.entries;
    if (unseen.length) await srv.api('/whats-new/seen', { method: 'POST', body: { id: unseen[0].id } });
    const coder = await makeBot(srv, { name: 'Coder' });
    const tester = await makeBot(srv, { name: 'Tester' });
    const group = (await srv.api('/group-chats', { method: 'POST', body: { name: 'Dev Team', members: [coder.id, tester.id] } })).data;
    await srv.stop();
    seedRuns(srv, tester, [{ prompt: 'q', result: 'Some text here. '.repeat(60), times: 12 }]);
    srv = await startServer({ dir: srv.dir });
    srv.reply(Array.from({ length: 40 }, (_, i) => `Line ${i} of a long reply.`).join('\n\n'));
    for (let i = 0; i < 12; i++) {
      await srv.api(`/group-chats/${group.id}/messages`, { method: 'POST', body: { text: `@Coder task ${i}`, key: `open-again-${i}` } });
      await waitFor(async () => !(await srv.api(`/group-chats/${group.id}`)).data.working?.length, { timeout: 30000, what: 'the turn over' });
    }
    const engine = process.env.WEBKIT ? pw.webkit : pw.chromium;
    browser = await engine.launch({ headless: true, ...(process.env.CHROME_PATH && !process.env.WEBKIT ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const gap = (t) => page.locator(t).evaluate((el) => Math.round(el.scrollHeight - el.scrollTop - el.clientHeight));
    const toEnd = (t) => page.locator(t).evaluate((el) => { el.scrollTop = el.scrollHeight; });

    for (const [kind, id, thread] of [['group', group.id, '#group-thread'], ['bot', tester.id, '#bot-thread']]) {
      await page.goto('about:blank');
      await page.goto(`${srv.base}/#${kind}/${id}`);
      await page.locator(`${thread} .new-line`).waitFor();
      await page.waitForFunction((t) => { const el = document.querySelector(t); return el.scrollHeight - el.scrollTop - el.clientHeight > 2000; }, thread);
      await toEnd(thread); // read down to the end
      await sleep(1500);
      assert.equal(await page.locator(`${thread} .new-line`).count(), 1, `${kind}: the line stays while the chat is open`);

      await page.evaluate(([k, i]) => setView(k, i), [kind, id]); // its key, clicked again
      await sleep(500);
      assert.ok(await gap(thread) < 2, `${kind}: opened again, at its end (${await gap(thread)})`);
      await page.evaluate((t) => postMessage({ type: 'open', target: t }, location.origin), `${kind}:${id}`); // the desktop app's notification
      await sleep(500);
      assert.ok(await gap(thread) < 2, `${kind}: a notification about it, at its end (${await gap(thread)})`);

      await page.evaluate(() => setView('chief'));
      await sleep(300);
      await page.evaluate(([k, i]) => setView(k, i), [kind, id]);
      await sleep(800);
      assert.equal(await page.locator(`${thread} .new-line`).count(), 0, `${kind}: read, no line`);
      assert.ok(await gap(thread) < 2, `${kind}: back from another chat, at its end`);
    }
    assert.deepEqual(errors, []);
    console.log('ok: the open chat opened again stays where it is');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
