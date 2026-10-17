// Optional browser regression: NODE_PATH=<directory containing playwright> node test/browser/chief-screen.cjs
// Uses only scratch data and fake Claude; no Docker, model calls or production server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, waitFor } = require('../helpers');

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Web Surfer' });
    const plain = await makeBot(srv, { name: 'Writer' });
    const run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Demo' } })).data;
    await srv.finished(run.id);
    await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { computer: 'linux' } });
    const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
    const events = [
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool', name: 'mcp__botdot__run_bot', input: { id: bot.id } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool', content: JSON.stringify({ id: run.id, bot: bot.name }) }] } },
    ];
    fs.writeFileSync(path.join(srv.out, 'events.json'), JSON.stringify(events));
    srv.hold();
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${srv.base}/#chief/${chat.id}`);
    await page.locator('#view-chief textarea').fill('Open the website');
    await page.locator('#view-chief .send-btn').click();
    const chip = page.locator('#chat-thread .action-chip', { hasText: 'View live screen' });
    await chip.waitFor();
    await chip.click();
    await page.locator('#screen-frame').waitFor();
    assert.equal(new URL(page.url()).hash, `#bot/${bot.id}`);
    assert.match(await page.locator('#screen-frame').innerText(), /computer is off/i);
    await page.locator('[data-dismiss]').click();
    // A persisted pending reply has the same working link after a reload.
    await page.goto(`${srv.base}/#chief/${chat.id}`);
    await page.reload();
    await chip.click();
    await page.locator('#screen-frame').waitFor();
    await page.locator('[data-dismiss]').click();
    srv.unhold();
    await waitFor(async () => !(await srv.api(`/chief/chats/${chat.id}`)).data.busy);
    await page.goto(`${srv.base}/#chief/${chat.id}`);
    await page.reload();
    await chip.click();
    await page.locator('#screen-frame').waitFor();
    await page.locator('[data-dismiss]').click();
    // Historical chips without botId resolve through the run endpoint, even outside recent runs.
    await page.evaluate(({ bot, plain, run }) => {
      state.runs = [];
      const thread = document.querySelector('#chat-thread');
      thread.innerHTML = [
        { kind: 'run', text: 'Legacy run', runId: run.id },
        { kind: 'run', text: 'Plain run', botId: plain.id },
        { kind: 'updated', text: 'Updated bot', botId: bot.id },
      ].map(actionChip).join('');
      wireActions(thread);
      setView('chief');
    }, { bot, plain, run });
    await page.getByRole('button', { name: '→ Legacy run', exact: true }).click();
    await page.locator('#screen-frame').waitFor();
    await page.locator('[data-dismiss]').click();
    await page.evaluate(() => setView('chief'));
    await page.getByRole('button', { name: '→ Plain run', exact: true }).click();
    assert.equal(new URL(page.url()).hash, `#bot/${plain.id}`);
    assert.equal(await page.locator('#screen-frame').isVisible(), false);
    await page.evaluate(() => setView('chief'));
    await page.getByRole('button', { name: '✏️ Updated bot', exact: true }).click();
    assert.equal(new URL(page.url()).hash, `#bot/${bot.id}`);
    assert.equal(await page.locator('#screen-frame').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log('PASS: live and reloaded run chips, stopped computer, legacy run lookup, plain bot and non-run navigation; no browser errors.');
  } finally {
    srv.unhold();
    await browser?.close();
    await srv.stop();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
