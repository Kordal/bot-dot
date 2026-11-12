// Optional browser check of Tidy up (board-tidy): node test/browser/board-tidy.cjs [shots dir]
// The button beside a running project's gear sends the board as seen (the flow measured) and opens the project's
// Chief chat with the owner's "Tidy up the board.". Scratch data only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, writeData, waitFor } = require('../helpers');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const unseen = (await srv.api('/whats-new')).data.entries;
    if (unseen.length) await srv.api('/whats-new/seen', { method: 'POST', body: { id: unseen[0].id } });
    const a = await makeBot(srv, { name: 'Ops Watchkeeper', color: '#1d9e75' });
    assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'quotz.it' } })).status, 201);
    await srv.api('/company', { method: 'PATCH', body: { name: 'Quotz IT' } });
    await srv.api('/company/teams', { method: 'POST', body: { name: 'Quotz IT team', bots: [a.id], lead: a.id } });
    const c = { ...(await srv.api('/company')).data.company, board: undefined };
    writeData(path.join(srv.data, 'company.json'), { ...c, phase: 'running', startedAt: new Date(Date.now() - 86_400_000).toISOString(), objectives: [{ id: 'o1', name: 'Reach 100 users', target: 100, current: 7 }], todos: [] });

    browser = await chromium.launch({ headless: true });
    const page = await (await browser.newContext({ viewport: { width: 1512, height: 900 }, colorScheme: 'dark' })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#company`);
    const b = page.locator('[data-project-tidy]');
    await b.waitFor({ timeout: 20000 });
    if (shots) await page.screenshot({ path: path.join(shots, 'tidy-wide.png') });
    assert.equal(await b.getAttribute('aria-label'), 'Tidy up the board');
    assert.equal('layout' in (await srv.api('/company')).data.company, false, 'never arranged');
    await b.click();
    const co = await waitFor(async () => { const x = (await srv.api('/company')).data.company; return x.layout && x.chiefChat && x; });
    assert.ok(Object.keys(co.layout).some((k) => k.startsWith('goal:')), 'the flow was measured: ' + Object.keys(co.layout));
    const chat = await waitFor(async () => { const x = (await srv.api(`/chief/chats/${co.chiefChat}`)).data; return x.messages?.some((m) => m.role === 'user' && m.text === 'Tidy up the board.') && x; });
    assert.ok(chat);
    await page.waitForTimeout(800);
    if (shots) await page.screenshot({ path: path.join(shots, 'tidy-chat.png') });
    assert.deepEqual(errors, []);
    console.log('ok board-tidy');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
