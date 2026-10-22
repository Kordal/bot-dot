// Optional browser check of a bot's plan above the message box (docs/api.md, "The plan"), wide and at phone width:
//   NODE_PATH=<directory containing playwright> node test/browser/plan.cjs [screenshot folder]
// The plan shows live as the bot writes it, open on a wide screen and folded on a phone, the fold button opens and
// folds it; once the run is done it is folded under the reply; a stopped run shows "Stopped at step N of M" until
// Dismiss. Scratch data and fake Claude only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, heldRun, waitFor } = require('../helpers');

const shots = process.argv[2] || null;
const use = (name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `t${Math.random()}`, name, input }] } });
const todos = (...steps) => use('TodoWrite', { todos: steps.map(([content, status, activeForm]) => ({ content, status, activeForm: activeForm || content })) });
const STEPS = ['Read last week\'s prices from prices-w42.csv', 'List the 6 supplier pages to check', 'Fetch each supplier\'s price page', 'Compare the prices and mark changes over 5%', 'Write the short report'];
const at = (n) => STEPS.map((s, i) => [s, i < n ? 'completed' : i === n ? 'in_progress' : 'pending', i === n ? 'Fetching the supplier pages · 4 of 6' : s]);

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'News Monitor' });
    srv.reply('Two of six suppliers changed prices by more than 5%.');
    const { run, rec } = await heldRun(srv, bot, 'Compare this week\'s supplier prices with last week\'s and write me a short report.');
    const play = (...evs) => fs.writeFileSync(path.join(srv.out, `events-${rec.n}.json`), JSON.stringify(evs));
    play(todos(...at(2)));
    await waitFor(async () => (await srv.api(`/runs/${run.id}?events=0`)).data.plan, { what: 'the plan' });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const errors = [];
    const open = async (width, height) => {
      const page = await (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 })).newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${srv.base}/#bot/${bot.id}`);
      await page.locator('#view-bot .plan-card').waitFor();
      return page;
    };
    const wide = await open(1440, 860);
    const card = wide.locator('#view-bot .plan-card');
    assert.equal(await card.getAttribute('aria-label'), 'News Monitor\'s plan');
    assert.match(await card.innerText(), /Plan\s*2 of 5 done/);
    assert.equal(await wide.locator('#view-bot .plan-step.done').count(), 2);
    assert.match(await wide.locator('#view-bot .plan-step.doing').innerText(), /Fetch each supplier's price page\s*Fetching the supplier pages/);
    // Above the message box.
    const [cardBox, boxBox] = [await card.boundingBox(), await wide.locator('#view-bot .composer-box').boundingBox()];
    assert.ok(cardBox.y + cardBox.height <= boxBox.y, 'the card stands above the message box');
    if (shots) await wide.screenshot({ path: path.join(shots, 'plan-wide.png') });

    // Live: the next step, without a reload.
    play(todos(...at(2)), todos(...at(3)));
    await waitFor(async () => /3 of 5 done/.test(await card.innerText()), { what: 'the plan moved on' });

    // Phone width: folded to one line, opened and folded again with the button.
    const phone = await open(390, 844);
    const head = phone.locator('#view-bot .plan-head');
    assert.equal(await head.getAttribute('aria-expanded'), 'false');
    assert.match(await head.innerText(), /Plan\s*step 4 of 5/);
    assert.ok((await head.boundingBox()).height >= 44, 'a touch target of 44px');
    if (shots) await phone.screenshot({ path: path.join(shots, 'plan-phone-folded.png') });
    await head.click();
    assert.equal(await phone.locator('#view-bot .plan-head').getAttribute('aria-expanded'), 'true');
    if (shots) await phone.screenshot({ path: path.join(shots, 'plan-phone-open.png') });
    await phone.locator('#view-bot .plan-head').click();
    assert.equal(await phone.locator('#view-bot .plan-head').getAttribute('aria-expanded'), 'false');

    // Done: the card goes, and the reply carries the plan folded.
    play(todos(...at(2)), todos(...at(3)), todos(...at(5)));
    await waitFor(async () => (await srv.api(`/runs/${run.id}?events=0`)).data.plan.steps.every((s) => s.status === 'done'), { what: 'every step done' });
    srv.release(rec);
    await srv.finished(run.id);
    await wide.locator('#view-bot .plan-fold').waitFor();
    assert.equal(await wide.locator('#view-bot .plan-card').count(), 0, 'no card once the run is done');
    assert.match(await wide.locator('#view-bot .plan-fold summary').innerText(), /Plan · 5 of 5 done/);
    await wide.locator('#view-bot .plan-fold summary').click();
    if (shots) await wide.screenshot({ path: path.join(shots, 'plan-done.png') });

    // Stopped: "Stopped at step 2 of 5", until Dismiss.
    srv.unhold();
    const second = await heldRun(srv, bot, 'Sort my whole inbox from September.');
    fs.writeFileSync(path.join(srv.out, `events-${second.rec.n}.json`), JSON.stringify([todos(...at(1))]));
    await waitFor(async () => (await srv.api(`/runs/${second.run.id}?events=0`)).data.plan, { what: 'the second plan' });
    await srv.api(`/runs/${second.run.id}/stop`, { method: 'POST' });
    await srv.finished(second.run.id);
    const stopped = wide.locator('#view-bot .plan-card.stopped');
    await stopped.waitFor();
    assert.match(await stopped.innerText(), /Stopped at step 2 of 5[\s\S]*1 step done[\s\S]*List the 6 supplier pages to check[\s\S]*3 steps not started[\s\S]*Dismiss/);
    assert.doesNotMatch(await stopped.innerText(), /Carry on/);
    if (shots) await wide.screenshot({ path: path.join(shots, 'plan-stopped.png') });
    await stopped.getByRole('button', { name: 'Dismiss' }).click();
    assert.equal(await wide.locator('#view-bot .plan-card').count(), 0);
    await wide.reload();
    await wide.locator('#view-bot .plan-fold').first().waitFor();
    assert.equal(await wide.locator('#view-bot .plan-card').count(), 0, 'a dismissed plan stays dismissed');
    assert.deepEqual(errors, []);
    console.log('ok: plan above the message box');
  } finally {
    srv.unhold();
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
